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
  type RepoAction,
  type RepoDetails,
  type RepoSummary,
} from './git'
import { Overview } from './overview'
import { RepoDetailsPane } from './repo-details'
import { Sidebar } from './sidebar'
import { loadSelection, saveSelection } from './state'

export type Activity = 'loading' | RepoAction['kind']

export type RepoState = {
  summary: RepoSummary | null
  activity: Activity | null
  error: string | null
}

export type SortMode = 'name' | 'last-commit'

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
  | { kind: 'help' }
  | {
      kind: 'input'
      purpose: 'new-branch' | 'bulk-new-branch' | 'bulk-checkout'
      value: string
    }

const SORT_MODES: SortMode[] = ['name', 'last-commit']

const COMMANDS = [
  ['↑↓ / j k', 'Move between repos (wraps around)'],
  ['g / G', 'Jump to first / last repo'],
  ['space', 'Select or unselect the repo for bulk actions'],
  ['s', 'Sort by name or most recent commit'],
  ['f', 'Fetch from the remote'],
  ['p', 'Pull, fast-forward only'],
  ['P', 'Push, setting upstream to origin if missing'],
  ['c', 'Checkout a branch (empty = default branch in bulk)'],
  ['C', 'Create and checkout a new branch'],
  ['X', 'Force delete every local branch except the current one'],
  ['r', 'Refresh status'],
  ['esc', 'Close dialog, clear selection, go back, then quit'],
  ['?', 'Show this help'],
]

export function App(props: { root: string; storeDir: string }) {
  const app = useApp()
  const windowSize = useWindowSize()
  const [paths, setPaths] = useState<string[] | null>(null)
  const [repos, setRepos] = useState<Record<string, RepoState>>({})
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [marked, setMarked] = useState(() =>
    loadSelection(props.storeDir, props.root)
  )
  const [issues, setIssues] = useState<
    { repoPath: string; problem: string; fixes: Fix[]; choice: number }[]
  >([])
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
    } catch (error) {
      patchRepo(repoPath, { activity: null, error: errorMessage(error) })
      if (action === null) return
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
    }
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

  const issue = mode.kind === 'browse' ? issues[0] : undefined

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
      if (key.escape || input === '?') setMode({ kind: 'browse' })
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
    if (input === '?') {
      setMode({ kind: 'help' })
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
    if (input === 's') {
      setSortMode(
        SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length]
      )
    }

    if (input === ' ' && selectedPath !== null) {
      const repoPath = selectedPath
      setMarked((previous) => {
        const next = new Set(previous)
        if (next.has(repoPath)) next.delete(repoPath)
        else next.add(repoPath)
        return next
      })
      return
    }

    if (markedPaths.length > 0 || selectedPath === null) {
      if (bulkTargets.some((repoPath) => repos[repoPath]?.activity)) return
      handleBulkKey(input)
      return
    }

    if (repos[selectedPath]?.activity) return
    handleRepoKey(selectedPath, input)
  })

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
          targets={
            new Set(
              markedPaths.length === 0 && selectedPath !== null
                ? [selectedPath]
                : bulkTargets
            )
          }
          sortMode={sortMode}
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

      {(mode.kind !== 'browse' || issue) && <Text> </Text>}

      {(mode.kind !== 'browse' || issue) && (
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
          {mode.kind === 'help' && (
            <Dialog
              title="Commands"
              hints="Close (esc)"
              width={Math.min(72, windowSize.columns - 4)}
            >
              {COMMANDS.map((command) => (
                <Box key={command[0]} gap={2}>
                  <Box width={10} flexShrink={0}>
                    <Text color="yellow">{command[0]}</Text>
                  </Box>
                  <Text wrap="truncate-end">{command[1]}</Text>
                </Box>
              ))}
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
      {mode.kind === 'browse' && !issue && (
        <Text dimColor wrap="truncate-end">
          {markedPaths.length > 0 && (
            <Text color="green">{` ${markedPaths.length} selected:`}</Text>
          )}
          {markedPaths.length === 0 && selectedPath === null && ' All repos:'}
          {markedPaths.length > 0 && ' Clear (esc)'}
          {markedPaths.length === 0 && selectedPath === null && ' Quit (esc)'}
          {markedPaths.length === 0 && selectedPath !== null && ' Back (esc)'}
          {
            ' · Fetch (f) · Pull (p) · Push (P) · Checkout (c) · New branch (C) · Delete branches (X) · Refresh (r) · Help (?)'
          }
        </Text>
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
    throw new Error(`Unknown sort mode: ${String(sortMode)}`)
  })
}
