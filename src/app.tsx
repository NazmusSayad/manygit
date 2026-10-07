import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import { useEffect, useState } from 'react'
import {
  CheckoutDialog,
  COMMANDS,
  ConfirmDialog,
  HelpDialog,
  InputDialog,
  IssueDialog,
  RELEASE_CHOICES,
  ReleaseDialog,
} from './components/dialogs'
import { Overview } from './components/overview'
import { RepoDetailsPane } from './components/repo-details'
import { Sidebar } from './components/sidebar'
import { findRepos } from './lib/find-repos'
import { getFixes, type Issue } from './lib/fixes'
import { errorMessage, repoName } from './lib/format'
import {
  getDetails,
  getOtherBranches,
  getSummary,
  runAction,
  type RepoAction,
  type RepoDetails,
  type RepoState,
} from './lib/git'
import { SORT_MODES, sortRepos } from './lib/sort'
import {
  loadCursor,
  loadSelection,
  loadSortMode,
  saveCursor,
  saveSelection,
  saveSortMode,
} from './lib/state'
import { useWizard, WizardDialog } from './wizard'

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

export function App(props: { root: string; storeDir: string }) {
  const app = useApp()
  const windowSize = useWindowSize()
  const [paths, setPaths] = useState<string[] | null>(null)
  const [repos, setRepos] = useState<Record<string, RepoState>>({})
  const [sortMode, setSortMode] = useState(() =>
    loadSortMode(props.storeDir, props.root)
  )
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    loadCursor(props.storeDir, props.root)
  )
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [marked, setMarked] = useState(() =>
    loadSelection(props.storeDir, props.root)
  )
  const [issues, setIssues] = useState<Issue[]>([])
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

  const wizard = useWizard({ repos, patchRepo, run })

  useEffect(() => {
    void (async () => {
      const found = await findRepos(props.root)
      setPaths(found)
      setMarked(
        (previous) =>
          new Set([...previous].filter((repoPath) => found.includes(repoPath)))
      )
      setSelectedPath((previous) =>
        previous !== null && found.includes(previous) ? previous : null
      )
      await Promise.all(found.map((repoPath) => run(repoPath, null)))
    })()
  }, [props.root])

  useEffect(() => {
    saveSelection(props.storeDir, props.root, marked)
  }, [props.storeDir, props.root, marked])

  useEffect(() => {
    saveCursor(props.storeDir, props.root, selectedPath)
  }, [props.storeDir, props.root, selectedPath])

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

  const issue = mode.kind === 'browse' && !wizard.wizard ? issues[0] : undefined

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

    if (wizard.wizard) {
      wizard.handleKey(input, key)
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
        setMode({ kind: 'browse' })
        wizard.release(commandTargets, { bump: choice.bump })
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
          wizard.release(commandTargets, { tag: branch })
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
      else if (selectedPath !== null) setSelectedPath(null)
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
    if (command === 'enter') wizard.commit(commandTargets)
    if (command === 'o') wizard.pullRequest(commandTargets)
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

      {(mode.kind !== 'browse' || issue || wizard.wizard) && <Text> </Text>}

      {(mode.kind !== 'browse' || issue || wizard.wizard) && (
        <Box
          position="absolute"
          width={windowSize.columns}
          height={windowSize.rows}
          alignItems="center"
          justifyContent="center"
        >
          {mode.kind === 'confirm' && (
            <ConfirmDialog
              message={mode.message}
              danger={mode.danger}
              list={mode.list}
              choice={mode.choice}
              width={Math.min(64, windowSize.columns - 4)}
              height={windowSize.rows}
            />
          )}
          {mode.kind === 'input' && (
            <InputDialog
              purpose={mode.purpose}
              context={
                mode.purpose === 'new-branch'
                  ? `From ${selectedSummary?.branch ?? 'HEAD'} in ${selectedPath === null ? '' : repoName(props.root, selectedPath)}`
                  : mode.purpose === 'release-tag'
                    ? `In ${commandTargets.length === 1 ? repoName(props.root, commandTargets[0]) : `${commandTargets.length} repos`}`
                    : `In ${bulkLabel}`
              }
              value={mode.value}
              width={Math.min(64, windowSize.columns - 4)}
            />
          )}
          {issue && (
            <IssueDialog
              root={props.root}
              issue={issue}
              count={issues.length}
              width={Math.min(72, windowSize.columns - 4)}
            />
          )}
          {wizard.wizard && (
            <WizardDialog
              title={wizard.wizard.title}
              root={props.root}
              entries={wizard.wizard.entries}
              width={Math.min(90, windowSize.columns - 4)}
              height={windowSize.rows}
            />
          )}
          {mode.kind === 'release-pick' && (
            <ReleaseDialog
              root={props.root}
              targets={commandTargets}
              cursor={mode.cursor}
              width={Math.min(64, windowSize.columns - 4)}
            />
          )}
          {mode.kind === 'help' && (
            <HelpDialog
              cursor={mode.cursor}
              width={Math.min(64, windowSize.columns - 4)}
            />
          )}
          {mode.kind === 'checkout' && selectedPath !== null && (
            <CheckoutDialog
              root={props.root}
              repoPath={selectedPath}
              branches={branches}
              cursor={mode.cursor}
              width={Math.min(64, windowSize.columns - 4)}
              height={windowSize.rows}
            />
          )}
        </Box>
      )}
      {mode.kind === 'browse' && !issue && !wizard.wizard && (
        <Box justifyContent="space-between" gap={2}>
          <Text wrap="truncate-end">
            {markedPaths.length > 0 && (
              <Text color="green">{` ${markedPaths.length} selected:`}</Text>
            )}
            <Text dimColor>
              {markedPaths.length === 0 &&
                selectedPath === null &&
                ' All repos:'}
              {markedPaths.length > 0 && ' Clear (esc)'}
              {markedPaths.length === 0 && selectedPath === null && ' Quit (q)'}
              {markedPaths.length === 0 &&
                selectedPath !== null &&
                ' Back (esc)'}
              {' · Move (↑↓) · Select (space)'}
            </Text>
          </Text>
          <Box flexShrink={0}>
            <Text dimColor>Help (?) </Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
