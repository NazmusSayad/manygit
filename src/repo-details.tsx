import { Box, Text } from 'ink'
import type { RepoState } from './app'
import { displayPath, formatAge } from './format'
import type { RepoDetails } from './git'
import { BranchStatus } from './sidebar'

const ACTIVITY_LABELS = {
  checkout: 'checking out…',
  'create-branch': 'creating branch…',
  'checkout-default': 'checking out default branch…',
  'delete-branches': 'deleting branches…',
  stash: 'stashing…',
  'remove-worktree': 'removing worktree…',
  'pull-rebase': 'pulling…',
  'pull-merge': 'pulling…',
  'push-force': 'force pushing…',
  sequence: 'fixing…',
  loading: 'refreshing…',
  fetch: 'fetching…',
  pull: 'pulling…',
  push: 'pushing…',
}

export function RepoDetailsPane(props: {
  repoPath: string
  state: RepoState | undefined
  details: { data: RepoDetails | null; error: string | null } | null
}) {
  const data = props.details?.data

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Box flexShrink={1}>
          <Text color="blue" bold wrap="truncate-start">
            {displayPath(props.repoPath)}
          </Text>
        </Box>
        <Box flexShrink={0} flexGrow={1}>
          <Text>
            {props.state?.summary && (
              <BranchStatus summary={props.state.summary} />
            )}
          </Text>
        </Box>
        {props.state?.activity && (
          <Box flexShrink={0} marginLeft={2}>
            <Text color="blue">{ACTIVITY_LABELS[props.state.activity]}</Text>
          </Box>
        )}
      </Box>

      {!props.state?.activity && props.state?.error && (
        <Text color="red">✗ {props.state.error}</Text>
      )}

      {!props.details && <Text dimColor>Loading…</Text>}
      {props.details?.error && <Text color="red">✗ {props.details.error}</Text>}

      {data && (
        <>
          <Box marginTop={1}>
            <Text bold>Changes </Text>
            <Text dimColor>{data.files.length}</Text>
          </Box>
          {data.files.length === 0 && <Text dimColor>Working tree clean</Text>}
          {data.files.slice(0, 10).map((file) => (
            <Box key={file.path} gap={1}>
              <Text>
                <Text color={file.index === '?' ? 'gray' : 'green'}>
                  {file.index}
                </Text>
                <Text color={file.workingDir === '?' ? 'gray' : 'red'}>
                  {file.workingDir}
                </Text>
              </Text>
              <Text wrap="truncate-start">{file.path}</Text>
            </Box>
          ))}
          {data.files.length > 10 && (
            <Text dimColor>…and {data.files.length - 10} more</Text>
          )}

          <Box marginTop={1}>
            <Text bold>Branches </Text>
            <Text dimColor>{data.branches.length}</Text>
          </Box>
          {data.branches.slice(0, 6).map((branch) => (
            <Box key={branch.name} gap={2}>
              <Text color={branch.isCurrent ? 'magenta' : undefined}>
                {branch.isCurrent ? '* ' : '  '}
                {branch.name}
              </Text>
              {branch.name === data.defaultBranch && (
                <Text color="green">default</Text>
              )}
              <Text dimColor>{branch.upstream || 'no upstream'}</Text>
              {branch.track && <Text color="cyan">{branch.track}</Text>}
            </Box>
          ))}
          {data.branches.length > 6 && (
            <Text dimColor>…and {data.branches.length - 6} more</Text>
          )}

          <Box marginTop={1}>
            <Text bold>Recent commits</Text>
          </Box>
          {data.commits.length === 0 && <Text dimColor>No commits yet</Text>}
          {data.commits.map((commit) => (
            <Box key={commit.hash} gap={1}>
              <Box flexShrink={0}>
                <Text color="yellow">{commit.hash}</Text>
              </Box>
              <Box width={4} flexShrink={0}>
                <Text dimColor>{formatAge(commit.date)}</Text>
              </Box>
              <Box flexShrink={1}>
                <Text wrap="truncate-end">{commit.message}</Text>
              </Box>
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}
