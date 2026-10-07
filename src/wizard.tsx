import type { CommitSession, PullRequestSession, ReleaseDraft } from 'gityo'
import { Box, Text, type Key } from 'ink'
import pLimit from 'p-limit'
import { useState } from 'react'
import { Dialog } from './components/dialogs'
import { Spinner } from './components/sidebar'
import { errorMessage, repoName } from './lib/format'
import { getSummary, type RepoAction, type RepoState } from './lib/git'

const generateLimit = pLimit(4)

export type WizardOption = { label: string; danger: boolean; run: () => void }

export type WizardEntry = {
  repoPath: string
  state: 'working' | 'review' | 'done' | 'failed' | 'idle'
  text: string
  review: {
    heading: string
    lines: string[]
    body: string
    options: WizardOption[]
  } | null
  choice: number
}

export type ReleaseVersion =
  | { bump: 'major' | 'minor' | 'patch' }
  | { tag: string }

export function useWizard(options: {
  repos: Record<string, RepoState>
  patchRepo: (repoPath: string, patch: Partial<RepoState>) => void
  run: (repoPath: string, action: RepoAction | null) => Promise<string | null>
}) {
  const [wizard, setWizard] = useState<{
    id: number
    title: string
    entries: WizardEntry[]
  } | null>(null)

  function patchEntry(
    id: number,
    repoPath: string,
    patch: Partial<WizardEntry>
  ) {
    setWizard((previous) =>
      previous?.id === id
        ? {
            ...previous,
            entries: previous.entries.map((entry) =>
              entry.repoPath === repoPath ? { ...entry, ...patch } : entry
            ),
          }
        : previous
    )
  }

  function setWorking(id: number, repoPath: string, text: string) {
    patchEntry(id, repoPath, { state: 'working', text, review: null })
  }

  function setReview(
    id: number,
    repoPath: string,
    review: NonNullable<WizardEntry['review']>,
    choice: number
  ) {
    patchEntry(id, repoPath, {
      state: 'review',
      text: 'ready for review',
      review,
      choice,
    })
  }

  function skipOption(id: number, repoPath: string): WizardOption {
    return {
      label: 'Skip',
      danger: false,
      run: () =>
        patchEntry(id, repoPath, {
          state: 'idle',
          text: 'skipped',
          review: null,
        }),
    }
  }

  async function step(id: number, repoPath: string, task: () => Promise<void>) {
    try {
      await task()
    } catch (error) {
      patchEntry(id, repoPath, {
        state: 'failed',
        text: errorMessage(error),
        review: null,
      })
    }
  }

  function openWizard(
    title: string,
    targets: string[],
    start: (id: number, repoPath: string) => void
  ) {
    const id = Date.now()
    setWizard({
      id,
      title,
      entries: targets.map((repoPath) => ({
        repoPath,
        state: 'working',
        text: 'starting…',
        review: null,
        choice: 0,
      })),
    })
    for (const repoPath of targets) start(id, repoPath)
  }

  function startCommit(id: number, repoPath: string) {
    if ((options.repos[repoPath]?.summary?.changes ?? 0) === 0) {
      patchEntry(id, repoPath, { state: 'idle', text: 'no changes' })
      return
    }
    void generateCommit(id, repoPath, null)
  }

  function generateCommit(
    id: number,
    repoPath: string,
    session: CommitSession | null
  ) {
    return step(id, repoPath, async () => {
      setWorking(id, repoPath, 'writing commit message…')
      const result = await withGityo(async (gityo) => {
        const current =
          session ?? (await gityo.createCommitSession({ cwd: repoPath }))
        return { session: current, message: await current.generateMessage() }
      })
      const files = result.session.files
      setReview(
        id,
        repoPath,
        {
          heading: `${files.length} ${result.session.scope === 'staged' ? 'staged' : 'changed'} ${files.length === 1 ? 'file' : 'files'}`,
          lines: files,
          body: result.message,
          options: [
            {
              label: 'Commit',
              danger: false,
              run: () =>
                void commitChanges(
                  id,
                  repoPath,
                  result.session,
                  result.message,
                  null
                ),
            },
            {
              label:
                result.session.postCommand === 'push-and-pull'
                  ? 'Commit, push and pull'
                  : 'Commit and push',
              danger: false,
              run: () =>
                void commitChanges(
                  id,
                  repoPath,
                  result.session,
                  result.message,
                  result.session.postCommand ?? 'push'
                ),
            },
            {
              label: 'Regenerate',
              danger: false,
              run: () => void generateCommit(id, repoPath, result.session),
            },
            skipOption(id, repoPath),
          ],
        },
        result.session.postCommand === null ? 0 : 1
      )
    })
  }

  function commitChanges(
    id: number,
    repoPath: string,
    session: CommitSession,
    message: string,
    postCommand: 'push' | 'push-and-pull' | null
  ) {
    return step(id, repoPath, async () => {
      setWorking(id, repoPath, 'committing…')
      await session.commit(message)
      const summary = await getSummary(repoPath)
      options.patchRepo(repoPath, { summary })
      if (postCommand === null) {
        patchEntry(id, repoPath, { state: 'done', text: 'committed' })
        return
      }
      if (summary.isDetached || !summary.branch) {
        throw new Error('Committed, but cannot push a detached HEAD')
      }
      setWorking(id, repoPath, 'pushing…')
      const pushError = await options.run(repoPath, {
        kind: 'push',
        branch: summary.branch,
        setUpstream: !summary.tracking,
      })
      if (pushError !== null) {
        throw new Error(`Committed, but push failed: ${pushError}`)
      }
      if (postCommand === 'push') {
        patchEntry(id, repoPath, {
          state: 'done',
          text: 'committed and pushed',
        })
        return
      }
      setWorking(id, repoPath, 'pulling…')
      const pullError = await options.run(repoPath, { kind: 'pull' })
      if (pullError !== null) {
        throw new Error(`Committed and pushed, but pull failed: ${pullError}`)
      }
      patchEntry(id, repoPath, {
        state: 'done',
        text: 'committed, pushed and pulled',
      })
    })
  }

  function startPullRequest(id: number, repoPath: string) {
    return step(id, repoPath, async () => {
      const summary = options.repos[repoPath]?.summary
      if (!summary) throw new Error('Status not loaded yet')
      if (summary.isDetached || !summary.branch) {
        throw new Error('Not on a branch')
      }
      const branch = summary.branch
      if (!summary.tracking || summary.ahead > 0) {
        setReview(
          id,
          repoPath,
          {
            heading: summary.tracking
              ? `${branch} has ${summary.ahead} unpushed commits`
              : `${branch} is not pushed yet`,
            lines: [],
            body: '',
            options: [
              {
                label: 'Push, then continue',
                danger: false,
                run: () =>
                  void step(id, repoPath, async () => {
                    setWorking(id, repoPath, 'pushing…')
                    const pushError = await options.run(repoPath, {
                      kind: 'push',
                      branch,
                      setUpstream: !summary.tracking,
                    })
                    if (pushError !== null) throw new Error(pushError)
                    await loadPullRequest(id, repoPath)
                  }),
              },
              skipOption(id, repoPath),
            ],
          },
          0
        )
        return
      }
      await loadPullRequest(id, repoPath)
    })
  }

  async function loadPullRequest(id: number, repoPath: string) {
    setWorking(id, repoPath, 'loading pull request…')
    const session = await withGityo((gityo) =>
      gityo.createPullRequestSession({ cwd: repoPath })
    )
    const existing = session.existing
    if (existing === null) {
      await generatePullRequest(id, repoPath, session)
      return
    }
    setReview(
      id,
      repoPath,
      {
        heading: `PR #${existing.number} is open: ${existing.base} ← ${existing.head}`,
        lines: [existing.url],
        body: '',
        options: [
          {
            label: `Merge (${session.mergeMethod})`,
            danger: true,
            run: () =>
              void mergePullRequest(
                id,
                repoPath,
                session,
                existing.number,
                'merged'
              ),
          },
          skipOption(id, repoPath),
        ],
      },
      1
    )
  }

  function generatePullRequest(
    id: number,
    repoPath: string,
    session: PullRequestSession
  ) {
    return step(id, repoPath, async () => {
      setWorking(id, repoPath, 'writing pull request…')
      const content = await withGityo(() => session.generate())
      setReview(
        id,
        repoPath,
        {
          heading: `${session.base} ← ${session.head}`,
          lines: [],
          body: `${content.title}\n\n${content.body}`,
          options: [
            {
              label: 'Create PR',
              danger: false,
              run: () =>
                void step(id, repoPath, async () => {
                  setWorking(id, repoPath, 'creating pull request…')
                  const created = await session.create(content)
                  patchEntry(id, repoPath, {
                    state: 'done',
                    text: `created PR #${created.number} ${created.url}`,
                  })
                }),
            },
            {
              label: `Create and merge (${session.mergeMethod})`,
              danger: true,
              run: () =>
                void step(id, repoPath, async () => {
                  setWorking(id, repoPath, 'creating pull request…')
                  const created = await session.create(content)
                  await mergePullRequest(
                    id,
                    repoPath,
                    session,
                    created.number,
                    'created and merged'
                  )
                }),
            },
            {
              label: 'Regenerate',
              danger: false,
              run: () => void generatePullRequest(id, repoPath, session),
            },
            skipOption(id, repoPath),
          ],
        },
        0
      )
    })
  }

  function mergePullRequest(
    id: number,
    repoPath: string,
    session: PullRequestSession,
    number: number,
    doneText: string
  ) {
    return step(id, repoPath, async () => {
      setWorking(id, repoPath, `merging PR #${number}…`)
      await session.merge()
      patchEntry(id, repoPath, {
        state: 'done',
        text: `${doneText} PR #${number}`,
      })
      void options.run(repoPath, null)
    })
  }

  function startRelease(id: number, repoPath: string, version: ReleaseVersion) {
    return step(id, repoPath, async () => {
      setWorking(id, repoPath, 'loading releases…')
      const draft = await withGityo(async (gityo) => {
        const session = await gityo.createReleaseSession({ cwd: repoPath })
        return session.prepare(
          'bump' in version ? session.bumpTag(version.bump) : version.tag
        )
      })
      await generateRelease(id, repoPath, draft)
    })
  }

  function generateRelease(id: number, repoPath: string, draft: ReleaseDraft) {
    return step(id, repoPath, async () => {
      setWorking(id, repoPath, `writing release notes for ${draft.tag}…`)
      const notes = await withGityo(() => draft.generateNotes())
      setReview(
        id,
        repoPath,
        {
          heading: draft.exists
            ? `${draft.tag} already exists and will be replaced`
            : `${draft.tag} (previous: ${draft.previousTag ?? 'none'})`,
          lines: [],
          body: notes,
          options: [
            {
              label: draft.exists
                ? `Replace release ${draft.tag}`
                : `Create release ${draft.tag}`,
              danger: draft.exists,
              run: () =>
                void step(id, repoPath, async () => {
                  setWorking(id, repoPath, `releasing ${draft.tag}…`)
                  await draft.create(notes, { replace: draft.exists })
                  patchEntry(id, repoPath, {
                    state: 'done',
                    text: `released ${draft.tag}`,
                  })
                }),
            },
            {
              label: 'Regenerate',
              danger: false,
              run: () => void generateRelease(id, repoPath, draft),
            },
            skipOption(id, repoPath),
          ],
        },
        draft.exists ? 2 : 0
      )
    })
  }

  function handleKey(input: string, key: Key) {
    if (!wizard) return
    if (key.escape) setWizard(null)
    const review = wizard.entries.find((entry) => entry.state === 'review')
    if (!review?.review) return
    if (key.upArrow || input === 'k') {
      patchEntry(wizard.id, review.repoPath, {
        choice: Math.max(0, review.choice - 1),
      })
    }
    if (key.downArrow || input === 'j') {
      patchEntry(wizard.id, review.repoPath, {
        choice: Math.min(review.review.options.length - 1, review.choice + 1),
      })
    }
    if (key.return) review.review.options[review.choice].run()
  }

  return {
    wizard,
    handleKey,
    commit: (targets: string[]) =>
      openWizard('Commit with gityo', targets, startCommit),
    pullRequest: (targets: string[]) =>
      openWizard(
        'Pull request with gityo',
        targets,
        (id, repoPath) => void startPullRequest(id, repoPath)
      ),
    release: (targets: string[], version: ReleaseVersion) =>
      openWizard(
        'Release with gityo',
        targets,
        (id, repoPath) => void startRelease(id, repoPath, version)
      ),
  }
}

function withGityo<T>(task: (gityo: typeof import('gityo')) => Promise<T>) {
  return generateLimit(async () => task(await import('gityo')))
}

export function WizardDialog(props: {
  title: string
  root: string
  entries: WizardEntry[]
  width: number
  height: number
}) {
  const review = props.entries.find((entry) => entry.state === 'review')
  const listHeight = Math.max(3, props.height - 30)

  return (
    <Dialog
      title={props.title}
      hints={review ? 'Choose (↑↓) · Run (enter) · Close (esc)' : 'Close (esc)'}
      width={props.width}
    >
      {props.entries.slice(0, listHeight).map((entry) => (
        <Box key={entry.repoPath} gap={1}>
          <Box width={2} flexShrink={0}>
            {entry.state === 'working' && <Spinner />}
            {entry.state === 'review' && <Text color="cyan">●</Text>}
            {entry.state === 'done' && <Text color="green">✓</Text>}
            {entry.state === 'failed' && <Text color="red">✗</Text>}
            {entry.state === 'idle' && <Text dimColor>–</Text>}
          </Box>
          <Box flexShrink={0}>
            <Text color="blue" bold={entry.repoPath === review?.repoPath}>
              {repoName(props.root, entry.repoPath)}
            </Text>
          </Box>
          <Text
            color={entry.state === 'failed' ? 'red' : undefined}
            dimColor={entry.state !== 'failed'}
            wrap={entry.state === 'failed' ? 'wrap' : 'truncate-end'}
          >
            {entry.text}
          </Text>
        </Box>
      ))}
      {props.entries.length > listHeight && (
        <Text dimColor>…and {props.entries.length - listHeight} more</Text>
      )}

      {review?.review && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            {repoName(props.root, review.repoPath)}
            <Text dimColor> · {review.review.heading}</Text>
          </Text>
          {review.review.lines.slice(0, 5).map((line) => (
            <Text key={line} dimColor wrap="truncate-start">
              {line}
            </Text>
          ))}
          {review.review.lines.length > 5 && (
            <Text dimColor>…and {review.review.lines.length - 5} more</Text>
          )}
          {review.review.body !== '' && (
            <Box marginY={1} flexDirection="column">
              {review.review.body
                .split('\n')
                .slice(0, Math.max(3, props.height - 24))
                .map((line, index) => (
                  <Text key={index} color="cyan" wrap="truncate-end">
                    {line === '' ? ' ' : line}
                  </Text>
                ))}
              {review.review.body.split('\n').length >
                Math.max(3, props.height - 24) && <Text dimColor>…</Text>}
            </Box>
          )}
          {review.review.body === '' && <Text> </Text>}
          {review.review.options.map((option, index) => (
            <Box
              key={option.label}
              paddingX={1}
              backgroundColor={index === review.choice ? '#3e4451' : undefined}
            >
              <Text
                color={option.danger ? 'red' : undefined}
                bold={index === review.choice}
              >
                {option.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Dialog>
  )
}
