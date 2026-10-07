import type { CommitSession, PullRequestSession, ReleaseDraft } from 'gityo'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import { useEffect, useState } from 'react'
import { BranchPicker } from './branch-picker'
import { Dialog } from './dialog'
import { findRepos } from './find-repos'
import { getFixes, type Fix } from './fixes'
import { errorMessage, repoName } from './format'
import {
  getDetails,
  getOtherBranches,
  getSummary,
  runAction,
  withGityo,
  type RepoAction,
  type RepoDetails,
  type RepoSummary,
} from './git'
import { Overview } from './overview'
import { RepoDetailsPane } from './repo-details'
import { Sidebar } from './sidebar'
import {
  loadSelection,
  loadSortMode,
  saveSelection,
  saveSortMode,
} from './state'
import { WizardDialog, type WizardEntry, type WizardOption } from './wizard'

export type Activity = 'loading' | RepoAction['kind']

export type RepoState = {
  summary: RepoSummary | null
  activity: Activity | null
  error: string | null
}

export type SortMode = 'name' | 'last-commit' | 'last-change'

type Mode =
  | { kind: 'browse' }
  | {
      kind: 'confirm'
      message: string
      onConfirm: () => void
      choice: 'yes' | 'no'
      danger?: boolean
      list?: string[]
    }
  | { kind: 'checkout'; cursor: number }
  | { kind: 'help'; cursor: number }
  | { kind: 'release-pick'; cursor: number }
  | {
      kind: 'input'
      purpose:
        | 'new-branch'
        | 'bulk-new-branch'
        | 'bulk-checkout'
        | 'release-tag'
      value: string
    }

const SORT_MODES: SortMode[] = ['name', 'last-commit', 'last-change']

const RELEASE_CHOICES = [
  { label: 'Patch', bump: 'patch' },
  { label: 'Minor', bump: 'minor' },
  { label: 'Major', bump: 'major' },
  { label: 'Custom tag…', bump: null },
] as const

const COMMANDS = [
  { key: 'enter', command: 'enter', label: 'Commit with a gityo message' },
  { key: 'f', command: 'f', label: 'Fetch from the remote' },
  { key: 'p', command: 'p', label: 'Pull, fast-forward only' },
  { key: 'P', command: 'P', label: 'Push, setting upstream if missing' },
  { key: 'c', command: 'c', label: 'Checkout a branch' },
  { key: 'C', command: 'C', label: 'Create and checkout a new branch' },
  { key: 'X', command: 'X', label: 'Delete every branch except the current' },
  { key: 'o', command: 'o', label: 'Open or merge a pull request with gityo' },
  { key: 'R', command: 'R', label: 'Publish a GitHub release with gityo' },
  { key: 'w', command: 'w', label: 'Open origin in the browser' },
  { key: 'r', command: 'r', label: 'Refresh status' },
  { key: 's', command: 's', label: 'Change sort order' },
  { key: 'space', command: ' ', label: 'Select or unselect the repo' },
]

export function App(props: { root: string; storeDir: string }) {
  const app = useApp()
  const windowSize = useWindowSize()
  const [paths, setPaths] = useState<string[] | null>(null)
  const [repos, setRepos] = useState<Record<string, RepoState>>({})
  const [sortMode, setSortMode] = useState(() =>
    loadSortMode(props.storeDir, props.root)
  )
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [marked, setMarked] = useState(() =>
    loadSelection(props.storeDir, props.root)
  )
  const [issues, setIssues] = useState<
    { repoPath: string; problem: string; fixes: Fix[]; choice: number }[]
  >([])
  const [wizard, setWizard] = useState<{
    id: number
    title: string
    entries: WizardEntry[]
  } | null>(null)
  const [details, setDetails] = useState<{
    path: string
    data: RepoDetails | null
    error: string | null
  } | null>(null)

  function patchRepo(repoPath: string, patch: Partial<RepoState>) {
    setRepos((previous) => ({
      ...previous,
      [repoPath]: {
        ...(previous[repoPath] ?? {
          summary: null,
          activity: null,
          error: null,
        }),
        ...patch,
      },
    }))
  }

  async function run(repoPath: string, action: RepoAction | null) {
    patchRepo(repoPath, {
      activity: action === null ? 'loading' : action.kind,
      error: null,
    })
    try {
      if (action !== null) await runAction(repoPath, action)
      patchRepo(repoPath, {
        summary: await getSummary(repoPath),
        activity: null,
      })
      return null
    } catch (error) {
      patchRepo(repoPath, { activity: null, error: errorMessage(error) })
      if (action === null) return errorMessage(error)
      const found = getFixes(
        action,
        error instanceof Error ? error.message : String(error)
      )
      setIssues((previous) => [
        ...previous,
        ...found.map((entry) => ({
          repoPath,
          problem: entry.problem,
          fixes: entry.fixes,
          choice: entry.fixes.some((fix) => !fix.danger)
            ? entry.fixes.findIndex((fix) => !fix.danger)
            : entry.fixes.length,
        })),
      ])
      return errorMessage(error)
    }
  }

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
    if ((repos[repoPath]?.summary?.changes ?? 0) === 0) {
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
      patchRepo(repoPath, { summary })
      if (postCommand === null) {
        patchEntry(id, repoPath, { state: 'done', text: 'committed' })
        return
      }
      if (summary.isDetached || !summary.branch) {
        throw new Error('Committed, but cannot push a detached HEAD')
      }
      setWorking(id, repoPath, 'pushing…')
      const pushError = await run(repoPath, {
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
      const pullError = await run(repoPath, { kind: 'pull' })
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
      const summary = repos[repoPath]?.summary
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
                    const pushError = await run(repoPath, {
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
      void run(repoPath, null)
    })
  }

  function startRelease(
    id: number,
    repoPath: string,
    version: { bump: 'major' | 'minor' | 'patch' } | { tag: string }
  ) {
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

  useEffect(() => {
    void (async () => {
      const found = await findRepos(props.root)
      setPaths(found)
      setMarked(
        (previous) =>
          new Set([...previous].filter((repoPath) => found.includes(repoPath)))
      )
      await Promise.all(found.map((repoPath) => run(repoPath, null)))
    })()
  }, [props.root])

  useEffect(() => {
    saveSelection(props.storeDir, props.root, marked)
  }, [props.storeDir, props.root, marked])

  useEffect(() => {
    saveSortMode(props.storeDir, props.root, sortMode)
  }, [props.storeDir, props.root, sortMode])

  const selectedSummary = selectedPath ? repos[selectedPath]?.summary : null

  useEffect(() => {
    if (!selectedPath || !selectedSummary) return
    let isCancelled = false

    async function load(repoPath: string) {
      try {
        const data = await getDetails(repoPath)
        if (!isCancelled) setDetails({ path: repoPath, data, error: null })
      } catch (error) {
        if (!isCancelled) {
          setDetails({ path: repoPath, data: null, error: errorMessage(error) })
        }
      }
    }

    const timer = setTimeout(() => void load(selectedPath), 120)
    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [selectedPath, selectedSummary])

  const sortedPaths = sortRepos(paths ?? [], repos, sortMode, props.root)
  const cursor = selectedPath === null ? -1 : sortedPaths.indexOf(selectedPath)
  const selectedDetails = details?.path === selectedPath ? details : null
  const branches = selectedDetails?.data?.branches ?? []
  const markedPaths = sortedPaths.filter((repoPath) => marked.has(repoPath))
  const bulkTargets = markedPaths.length > 0 ? markedPaths : sortedPaths
  const commandTargets =
    markedPaths.length > 0 || selectedPath === null
      ? bulkTargets
      : [selectedPath]
  const bulkLabel =
    markedPaths.length > 0
      ? `${markedPaths.length} selected repos`
      : `all ${sortedPaths.length} repos`
  const mainHeight = windowSize.rows - 1
  const pageSize = Math.max(1, mainHeight - 3)

  function moveTo(index: number) {
    setSelectedPath(
      sortedPaths[Math.max(0, Math.min(sortedPaths.length - 1, index))]
    )
  }

  function runMany(
    targets: string[],
    getAction: (repoPath: string) => RepoAction | null
  ) {
    void Promise.all(
      targets.map((repoPath) => run(repoPath, getAction(repoPath)))
    )
  }

  async function confirmDeleteBranches(targets: string[]) {
    const found = await Promise.all(
      targets.map(async (repoPath) => {
        try {
          return { repoPath, branches: await getOtherBranches(repoPath) }
        } catch (error) {
          patchRepo(repoPath, { error: errorMessage(error) })
          return { repoPath, branches: null }
        }
      })
    )
    const deletable = found.flatMap((entry) =>
      entry.branches !== null && entry.branches.length > 0
        ? [{ repoPath: entry.repoPath, branches: entry.branches }]
        : []
    )
    if (deletable.length === 0) {
      for (const entry of found) {
        if (entry.branches !== null) {
          patchRepo(entry.repoPath, {
            error: 'No other local branches to delete',
          })
        }
      }
      return
    }
    const count = deletable.reduce(
      (total, entry) => total + entry.branches.length,
      0
    )
    setMode({
      kind: 'confirm',
      choice: 'no',
      danger: true,
      message:
        targets.length === 1
          ? `Force delete ${count} local branches in ${repoName(props.root, targets[0])}? Unmerged work on them is lost.`
          : `Force delete ${count} local branches in ${deletable.length} repos? Unmerged work on them is lost.`,
      list: deletable.flatMap((entry) =>
        targets.length === 1
          ? entry.branches.map((branch) => `  ${branch}`)
          : [
              repoName(props.root, entry.repoPath),
              ...entry.branches.map((branch) => `  ${branch}`),
            ]
      ),
      onConfirm: () => {
        for (const entry of deletable) {
          void run(entry.repoPath, {
            kind: 'delete-branches',
            branches: entry.branches,
          })
        }
      },
    })
  }

  function handleBulkKey(input: string) {
    if (input === 'r') runMany(bulkTargets, () => null)
    if (input === 'X') void confirmDeleteBranches(bulkTargets)
    if (input === 'w') {
      setMode({
        kind: 'confirm',
        choice: 'yes',
        message: `Open ${bulkLabel} in the browser?`,
        onConfirm: () => runMany(bulkTargets, () => ({ kind: 'open-remote' })),
      })
    }
    if (input === 'c') {
      setMode({ kind: 'input', purpose: 'bulk-checkout', value: '' })
    }
    if (input === 'C') {
      setMode({ kind: 'input', purpose: 'bulk-new-branch', value: '' })
    }

    if (input === 'f') {
      setMode({
        kind: 'confirm',
        choice: 'yes',
        message: `Fetch ${bulkLabel}?`,
        onConfirm: () => runMany(bulkTargets, () => ({ kind: 'fetch' })),
      })
    }

    if (input === 'p') {
      setMode({
        kind: 'confirm',
        choice: 'no',
        message: `Pull ${bulkLabel} (fast-forward only)?`,
        onConfirm: () => runMany(bulkTargets, () => ({ kind: 'pull' })),
      })
    }

    if (input === 'P') {
      setMode({
        kind: 'confirm',
        choice: 'no',
        message: `Push ${bulkLabel}? Branches without an upstream go to origin.`,
        onConfirm: () => {
          for (const repoPath of bulkTargets) {
            const summary = repos[repoPath]?.summary
            if (!summary) {
              patchRepo(repoPath, { error: 'Status not loaded yet' })
            } else if (summary.isDetached || !summary.branch) {
              patchRepo(repoPath, { error: 'Cannot push a detached HEAD' })
            } else {
              void run(repoPath, {
                kind: 'push',
                branch: summary.branch,
                setUpstream: !summary.tracking,
              })
            }
          }
        },
      })
    }
  }

  function handleRepoKey(repoPath: string, input: string) {
    const summary = repos[repoPath]?.summary

    if (input === 'f') void run(repoPath, { kind: 'fetch' })
    if (input === 'r') void run(repoPath, null)
    if (input === 'X') void confirmDeleteBranches([repoPath])
    if (input === 'w') void run(repoPath, { kind: 'open-remote' })
    if (input === 'C') {
      setMode({ kind: 'input', purpose: 'new-branch', value: '' })
    }

    if (input === 'c' && selectedDetails?.data) {
      setMode({
        kind: 'checkout',
        cursor: Math.max(
          0,
          branches.findIndex((branch) => branch.isCurrent)
        ),
      })
    }

    if (input === 'p' && summary) {
      if (!summary.tracking) {
        patchRepo(repoPath, { error: 'No upstream branch to pull from' })
        return
      }
      setMode({
        kind: 'confirm',
        choice: 'no',
        message: `Pull ${summary.tracking} into ${summary.branch} (fast-forward only)?`,
        onConfirm: () => void run(repoPath, { kind: 'pull' }),
      })
    }

    if (input === 'P' && summary) {
      const branch = summary.branch
      if (summary.isDetached || !branch) {
        patchRepo(repoPath, { error: 'Cannot push a detached HEAD' })
        return
      }
      const setUpstream = !summary.tracking
      setMode({
        kind: 'confirm',
        choice: 'no',
        message: setUpstream
          ? `Push ${branch} to origin and set it as upstream?`
          : `Push ${branch} → ${summary.tracking}?`,
        onConfirm: () =>
          void run(repoPath, { kind: 'push', branch, setUpstream }),
      })
    }
  }

  const issue = mode.kind === 'browse' && !wizard ? issues[0] : undefined
  const review = wizard?.entries.find((entry) => entry.state === 'review')

  useInput((input, key) => {
    if (issue) {
      if (key.upArrow || input === 'k') {
        setIssues([
          { ...issue, choice: Math.max(0, issue.choice - 1) },
          ...issues.slice(1),
        ])
      }
      if (key.downArrow || input === 'j') {
        setIssues([
          { ...issue, choice: Math.min(issue.fixes.length, issue.choice + 1) },
          ...issues.slice(1),
        ])
      }
      if (key.return) {
        const fix = issue.fixes[issue.choice]
        if (fix) void run(issue.repoPath, fix.action)
        setIssues(issues.slice(1))
      }
      if (key.escape) setIssues(issues.slice(1))
      return
    }

    if (wizard) {
      if (key.escape) setWizard(null)
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
      return
    }

    if (mode.kind === 'release-pick') {
      if (key.escape) setMode({ kind: 'browse' })
      if (key.upArrow || input === 'k') {
        setMode({ kind: 'release-pick', cursor: Math.max(0, mode.cursor - 1) })
      }
      if (key.downArrow || input === 'j') {
        setMode({
          kind: 'release-pick',
          cursor: Math.min(RELEASE_CHOICES.length - 1, mode.cursor + 1),
        })
      }
      if (key.return) {
        const choice = RELEASE_CHOICES[mode.cursor]
        if (choice.bump === null) {
          setMode({ kind: 'input', purpose: 'release-tag', value: '' })
          return
        }
        const bump = choice.bump
        setMode({ kind: 'browse' })
        openWizard(
          'Release with gityo',
          commandTargets,
          (id, repoPath) => void startRelease(id, repoPath, { bump })
        )
      }
      return
    }

    if (mode.kind === 'confirm') {
      if (
        key.leftArrow ||
        key.rightArrow ||
        key.tab ||
        input === 'h' ||
        input === 'l'
      ) {
        setMode({ ...mode, choice: mode.choice === 'yes' ? 'no' : 'yes' })
      }
      if (input === 'y' || (key.return && mode.choice === 'yes')) {
        mode.onConfirm()
        setMode({ kind: 'browse' })
      }
      if (input === 'n' || key.escape || (key.return && mode.choice === 'no')) {
        setMode({ kind: 'browse' })
      }
      return
    }

    if (mode.kind === 'help') {
      if (key.escape || input === '?' || input === '/') {
        setMode({ kind: 'browse' })
      }
      if (key.upArrow || input === 'k') {
        setMode({
          kind: 'help',
          cursor: mode.cursor <= 0 ? COMMANDS.length - 1 : mode.cursor - 1,
        })
      }
      if (key.downArrow || input === 'j') {
        setMode({
          kind: 'help',
          cursor: mode.cursor >= COMMANDS.length - 1 ? 0 : mode.cursor + 1,
        })
      }
      if (key.return) {
        setMode({ kind: 'browse' })
        runCommand(COMMANDS[mode.cursor].command)
      }
      return
    }

    if (mode.kind === 'checkout') {
      if (key.escape) setMode({ kind: 'browse' })
      if (key.upArrow || input === 'k') {
        setMode({ kind: 'checkout', cursor: Math.max(0, mode.cursor - 1) })
      }
      if (key.downArrow || input === 'j') {
        setMode({
          kind: 'checkout',
          cursor: Math.min(branches.length - 1, mode.cursor + 1),
        })
      }
      if (key.return && selectedPath !== null) {
        const branch = branches[mode.cursor]
        if (branch && !branch.isCurrent) {
          void run(selectedPath, { kind: 'checkout', branch: branch.name })
        }
        setMode({ kind: 'browse' })
      }
      return
    }

    if (mode.kind === 'input') {
      if (key.escape) setMode({ kind: 'browse' })
      else if (key.return) {
        const branch = mode.value.trim()

        if (mode.purpose === 'bulk-checkout' && branch === '') {
          setMode({
            kind: 'confirm',
            choice: 'no',
            message: `Checkout the default branch in ${bulkLabel}?`,
            onConfirm: () =>
              runMany(bulkTargets, () => ({ kind: 'checkout-default' })),
          })
          return
        }

        if (branch === '') return

        if (mode.purpose === 'release-tag') {
          setMode({ kind: 'browse' })
          openWizard(
            'Release with gityo',
            commandTargets,
            (id, repoPath) => void startRelease(id, repoPath, { tag: branch })
          )
        }

        if (mode.purpose === 'new-branch' && selectedPath !== null) {
          void run(selectedPath, { kind: 'create-branch', branch })
          setMode({ kind: 'browse' })
        }

        if (mode.purpose === 'bulk-checkout') {
          setMode({
            kind: 'confirm',
            choice: 'no',
            message: `Checkout ${branch} in ${bulkLabel}?`,
            onConfirm: () =>
              runMany(bulkTargets, () => ({ kind: 'checkout', branch })),
          })
        }

        if (mode.purpose === 'bulk-new-branch') {
          setMode({
            kind: 'confirm',
            choice: 'yes',
            message: `Create branch ${branch} in ${bulkLabel}?`,
            onConfirm: () =>
              runMany(bulkTargets, () => ({ kind: 'create-branch', branch })),
          })
        }
      } else if (key.backspace || key.delete) {
        setMode({ ...mode, value: mode.value.slice(0, -1) })
      } else if (input && !key.ctrl && !key.meta) {
        setMode({ ...mode, value: mode.value + input })
      }
      return
    }

    if (input === 'q') app.exit()
    if (input === '?' || input === '/') {
      setMode({ kind: 'help', cursor: 0 })
      return
    }
    if (key.escape) {
      if (marked.size > 0) setMarked(new Set())
      else if (selectedPath === null) app.exit()
      else setSelectedPath(null)
      return
    }
    if (key.upArrow || input === 'k') {
      moveTo(cursor <= 0 ? sortedPaths.length - 1 : cursor - 1)
    }
    if (key.downArrow || input === 'j') {
      moveTo(cursor >= sortedPaths.length - 1 ? 0 : cursor + 1)
    }
    if (key.pageUp) moveTo(cursor - pageSize)
    if (key.pageDown) moveTo(cursor + pageSize)
    if (input === 'g') moveTo(0)
    if (input === 'G') moveTo(sortedPaths.length - 1)
    runCommand(key.return ? 'enter' : input)
  })

  function runCommand(command: string) {
    if (command === 's') {
      setSortMode(
        SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length]
      )
      return
    }

    if (command === ' ') {
      if (selectedPath === null) return
      const repoPath = selectedPath
      setMarked((previous) => {
        const next = new Set(previous)
        if (next.has(repoPath)) next.delete(repoPath)
        else next.add(repoPath)
        return next
      })
      return
    }

    if (commandTargets.some((repoPath) => repos[repoPath]?.activity)) return
    if (command === 'enter') {
      openWizard('Commit with gityo', commandTargets, startCommit)
    }
    if (command === 'o') {
      openWizard(
        'Pull request with gityo',
        commandTargets,
        (id, repoPath) => void startPullRequest(id, repoPath)
      )
    }
    if (command === 'R') setMode({ kind: 'release-pick', cursor: 0 })

    if (markedPaths.length > 0 || selectedPath === null) {
      handleBulkKey(command)
      return
    }
    handleRepoKey(selectedPath, command)
  }

  if (!paths) {
    return <Text dimColor>Scanning {props.root}…</Text>
  }

  if (paths.length === 0) {
    return <Text>No git repos found under {props.root}</Text>
  }

  return (
    <Box flexDirection="column" height={windowSize.rows}>
      <Box height={mainHeight}>
        <Sidebar
          root={props.root}
          paths={sortedPaths}
          repos={repos}
          cursor={cursor}
          sortMode={sortMode}
          targets={
            new Set(
              markedPaths.length === 0 && selectedPath !== null
                ? [selectedPath]
                : bulkTargets
            )
          }
          width={Math.min(
            60,
            Math.max(30, Math.floor(windowSize.columns * 0.4))
          )}
          height={mainHeight}
        />

        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          overflow="hidden"
        >
          {selectedPath === null && (
            <Overview root={props.root} paths={sortedPaths} repos={repos} />
          )}
          {selectedPath !== null && (
            <RepoDetailsPane
              repoPath={selectedPath}
              state={repos[selectedPath]}
              details={selectedDetails}
            />
          )}
        </Box>
      </Box>

      {(mode.kind !== 'browse' || issue || wizard) && <Text> </Text>}

      {(mode.kind !== 'browse' || issue || wizard) && (
        <Box
          position="absolute"
          width={windowSize.columns}
          height={windowSize.rows}
          alignItems="center"
          justifyContent="center"
        >
          {mode.kind === 'confirm' && (
            <Dialog
              title="Confirm"
              hints="Switch (←→) · Choose (enter) · Yes (y) · No (n/esc)"
              width={Math.min(64, windowSize.columns - 4)}
            >
              <Text color={mode.danger ? 'red' : undefined}>
                {mode.message}
              </Text>
              {mode.list && (
                <Box flexDirection="column" marginTop={1}>
                  {mode.list
                    .slice(0, Math.max(1, windowSize.rows - 16))
                    .map((line, index) => (
                      <Text
                        key={index}
                        color={line.startsWith('  ') ? 'yellow' : 'blue'}
                        wrap="truncate-end"
                      >
                        {line}
                      </Text>
                    ))}
                  {mode.list.length > Math.max(1, windowSize.rows - 16) && (
                    <Text dimColor>
                      …and{' '}
                      {mode.list.length - Math.max(1, windowSize.rows - 16)}{' '}
                      more lines
                    </Text>
                  )}
                </Box>
              )}
              <Box marginTop={1} gap={2}>
                <Text
                  color={mode.danger ? 'red' : undefined}
                  inverse={mode.choice === 'yes'}
                  bold={mode.choice === 'yes'}
                >
                  {' Yes '}
                </Text>
                <Text
                  inverse={mode.choice === 'no'}
                  bold={mode.choice === 'no'}
                >
                  {' No '}
                </Text>
              </Box>
            </Dialog>
          )}
          {mode.kind === 'input' && (
            <Dialog
              title={
                mode.purpose === 'bulk-checkout'
                  ? 'Checkout branch'
                  : mode.purpose === 'release-tag'
                    ? 'Release tag'
                    : 'New branch'
              }
              hints={
                mode.purpose === 'new-branch'
                  ? 'Create (enter) · Cancel (esc)'
                  : 'Continue (enter) · Cancel (esc)'
              }
              width={Math.min(64, windowSize.columns - 4)}
            >
              <Text dimColor>
                {mode.purpose === 'new-branch'
                  ? `From ${selectedSummary?.branch ?? 'HEAD'} in ${selectedPath === null ? '' : repoName(props.root, selectedPath)}`
                  : mode.purpose === 'release-tag'
                    ? `In ${commandTargets.length === 1 ? repoName(props.root, commandTargets[0]) : `${commandTargets.length} repos`}`
                    : `In ${bulkLabel}`}
              </Text>
              {mode.purpose === 'bulk-checkout' && (
                <Text dimColor>
                  Leave empty to check out each repo's default branch.
                </Text>
              )}
              <Box marginTop={1}>
                <Text>
                  <Text color="yellow">{mode.value}</Text>
                  <Text inverse> </Text>
                </Text>
              </Box>
            </Dialog>
          )}
          {issue && (
            <Dialog
              title={`Problem ${issues.length > 1 ? `1 of ${issues.length} ` : ''}in ${repoName(props.root, issue.repoPath)}`}
              hints="Choose (↑↓) · Run (enter) · Ignore (esc)"
              width={Math.min(72, windowSize.columns - 4)}
            >
              <Text color="red">{issue.problem}</Text>
              <Box flexDirection="column" marginTop={1}>
                {[
                  ...issue.fixes,
                  { label: 'Ignore', danger: false, action: null },
                ].map((fix, index) => (
                  <Box
                    key={fix.label}
                    paddingX={1}
                    backgroundColor={
                      index === issue.choice ? '#3e4451' : undefined
                    }
                  >
                    <Text
                      color={fix.danger ? 'red' : undefined}
                      bold={index === issue.choice}
                      wrap="truncate-end"
                    >
                      {fix.label}
                    </Text>
                  </Box>
                ))}
              </Box>
            </Dialog>
          )}
          {wizard && (
            <WizardDialog
              title={wizard.title}
              root={props.root}
              entries={wizard.entries}
              width={Math.min(90, windowSize.columns - 4)}
              height={windowSize.rows}
            />
          )}
          {mode.kind === 'release-pick' && (
            <Dialog
              title="Release"
              hints="Choose (↑↓) · Continue (enter) · Cancel (esc)"
              width={Math.min(64, windowSize.columns - 4)}
            >
              <Text dimColor>
                {commandTargets.length === 1
                  ? `In ${repoName(props.root, commandTargets[0])}`
                  : `In ${commandTargets.length} repos`}
                , from each repo's latest release
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {RELEASE_CHOICES.map((choice, index) => (
                  <Box
                    key={choice.label}
                    paddingX={1}
                    backgroundColor={
                      index === mode.cursor ? '#3e4451' : undefined
                    }
                  >
                    <Text bold={index === mode.cursor}>{choice.label}</Text>
                  </Box>
                ))}
              </Box>
            </Dialog>
          )}
          {mode.kind === 'help' && (
            <Dialog
              title="Commands"
              hints="Choose (↑↓) · Run (enter) · Close (esc)"
              width={Math.min(64, windowSize.columns - 4)}
            >
              {COMMANDS.map((command, index) => (
                <Box
                  key={command.key}
                  gap={2}
                  paddingX={1}
                  backgroundColor={
                    index === mode.cursor ? '#3e4451' : undefined
                  }
                >
                  <Box width={6} flexShrink={0}>
                    <Text color="yellow">{command.key}</Text>
                  </Box>
                  <Text bold={index === mode.cursor} wrap="truncate-end">
                    {command.label}
                  </Text>
                </Box>
              ))}
              <Box marginTop={1}>
                <Text dimColor>
                  Move (↑↓ j k) · First / last (g G) · Back (esc)
                </Text>
              </Box>
            </Dialog>
          )}
          {mode.kind === 'checkout' && selectedPath !== null && (
            <Dialog
              title={`Checkout branch in ${repoName(props.root, selectedPath)}`}
              hints="Choose (↑↓) · Checkout (enter) · Cancel (esc)"
              width={Math.min(64, windowSize.columns - 4)}
            >
              <BranchPicker
                branches={branches}
                cursor={mode.cursor}
                height={Math.max(3, windowSize.rows - 12)}
              />
            </Dialog>
          )}
        </Box>
      )}
      {mode.kind === 'browse' && !issue && !wizard && (
        <Box justifyContent="space-between" gap={2}>
          <Text dimColor wrap="truncate-end">
            {markedPaths.length > 0 && (
              <Text color="green">{` ${markedPaths.length} selected:`}</Text>
            )}
            {markedPaths.length === 0 && selectedPath === null && ' All repos:'}
            {markedPaths.length > 0 && ' Clear (esc)'}
            {markedPaths.length === 0 && selectedPath === null && ' Quit (esc)'}
            {markedPaths.length === 0 && selectedPath !== null && ' Back (esc)'}
            {' · Move (↑↓) · Select (space)'}
          </Text>
          <Box flexShrink={0}>
            <Text dimColor>Help (?) </Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function sortRepos(
  paths: string[],
  repos: Record<string, RepoState>,
  sortMode: SortMode,
  root: string
) {
  return [...paths].sort((a, b) => {
    const byName = repoName(root, a).localeCompare(repoName(root, b))
    if (sortMode === 'name') return byName
    if (sortMode === 'last-commit') {
      const aTime = repos[a]?.summary?.lastCommitAt ?? 0
      const bTime = repos[b]?.summary?.lastCommitAt ?? 0
      return bTime - aTime || byName
    }
    if (sortMode === 'last-change') {
      const aTime = repos[a]?.summary?.lastChangeAt ?? 0
      const bTime = repos[b]?.summary?.lastChangeAt ?? 0
      return bTime - aTime || byName
    }
    throw new Error(`Unknown sort mode: ${String(sortMode)}`)
  })
}
