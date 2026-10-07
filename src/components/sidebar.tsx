import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import { repoName } from '../lib/format'
import type { RepoState, RepoSummary } from '../lib/git'
import type { SortMode } from '../lib/sort'

const SORT_LABELS = {
  name: 'name',
  path: 'path',
  'last-commit': 'recent commit',
  'last-change': 'recent change',
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function Sidebar(props: {
  root: string
  paths: string[]
  repos: Record<string, RepoState>
  cursor: number
  targets: Set<string>
  sortMode: SortMode
  width: number
  height: number
}) {
  const listHeight = Math.max(1, props.height - 3)
  const offset = Math.max(
    0,
    Math.min(
      props.cursor - Math.floor(listHeight / 2),
      props.paths.length - listHeight
    )
  )

  return (
    <Box
      flexDirection="column"
      width={props.width}
      flexShrink={0}
      borderStyle="round"
      borderColor="gray"
    >
      <Box paddingX={1} justifyContent="space-between" gap={1}>
        <Box flexShrink={0}>
          <Text bold>ManyGit</Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          Sort: {SORT_LABELS[props.sortMode]} (s)
        </Text>
      </Box>

      {props.paths.slice(offset, offset + listHeight).map((repoPath, index) => {
        const isSelected = offset + index === props.cursor
        const isTarget = props.targets.has(repoPath)

        const state = props.repos[repoPath]
        const summary = state?.summary

        return (
          <Box
            key={repoPath}
            paddingX={1}
            backgroundColor={isSelected ? '#3e4451' : undefined}
          >
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">
                <Text>{isTarget ? '● ' : '○ '}</Text>
                <Text color="blue" bold={isSelected}>
                  {repoName(props.root, repoPath)}
                </Text>
                {summary && <BranchStatus summary={summary} />}
              </Text>
            </Box>
            {state?.activity && (
              <Box flexShrink={0} marginLeft={1}>
                <Spinner />
              </Box>
            )}
            {!state?.activity && state?.error && (
              <Box flexShrink={0} marginLeft={1}>
                <Text color="red">✗</Text>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export function BranchStatus(props: { summary: RepoSummary }) {
  return (
    <>
      <Text color="yellow">
        {' '}
        {props.summary.isDetached ? 'HEAD' : props.summary.branch}
      </Text>
      <Text color="red">
        {props.summary.flags.conflicted && '='}
        {props.summary.flags.stashed && <Text dimColor>|</Text>}
        {props.summary.flags.deleted && '✘'}
        {props.summary.flags.renamed && '~'}
        {props.summary.flags.modified && '*'}
        {props.summary.flags.staged && '+'}
        {props.summary.flags.untracked && '?'}
        {props.summary.ahead > 0 && props.summary.behind > 0 && '⇕'}
        {props.summary.ahead > 0 && props.summary.behind === 0 && '↑'}
        {props.summary.ahead === 0 && props.summary.behind > 0 && '↓'}
      </Text>
    </>
  )
}

export function Spinner() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setFrame((previous) => previous + 1), 80)
    return () => clearInterval(timer)
  }, [])

  return (
    <Text color="cyan">{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>
  )
}
