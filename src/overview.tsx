import { Box, Text } from 'ink'
import type { RepoState } from './app'
import { displayPath, repoName } from './format'

export function Overview(props: {
  root: string
  paths: string[]
  repos: Record<string, RepoState>
}) {
  const states = props.paths.map((repoPath) => props.repos[repoPath])
  const working = states.filter((state) => state?.activity).length
  const attention = props.paths.filter((repoPath) => {
    const state = props.repos[repoPath]
    return (
      state?.error ||
      (state?.summary &&
        (state.summary.changes > 0 ||
          state.summary.ahead > 0 ||
          state.summary.behind > 0))
    )
  })
  const nameWidth = Math.min(
    32,
    Math.max(
      ...attention.map((repoPath) => repoName(props.root, repoPath).length),
      4
    )
  )

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text bold>{displayPath(props.root)}</Text>
      <Text>
        {props.paths.length} repos
        <Text dimColor> · </Text>
        <Text color="yellow">
          {states.filter((state) => state?.summary?.changes).length} dirty
        </Text>
        <Text dimColor> · </Text>
        <Text color="green">
          {states.filter((state) => state?.summary?.ahead).length} ahead
        </Text>
        <Text dimColor> · </Text>
        <Text color="cyan">
          {states.filter((state) => state?.summary?.behind).length} behind
        </Text>
        <Text dimColor> · </Text>
        <Text color="red">
          {states.filter((state) => state?.error).length} errors
        </Text>
      </Text>
      {working > 0 && (
        <Text dimColor>
          working {props.paths.length - working}/{props.paths.length}
        </Text>
      )}

      <Box marginTop={1}>
        <Text bold>Needs attention</Text>
      </Box>
      {attention.length === 0 && working === 0 && (
        <Text dimColor>Everything is clean and up to date.</Text>
      )}
      {attention.map((repoPath) => {
        const state = props.repos[repoPath]
        const summary = state?.summary

        return (
          <Box key={repoPath} gap={2}>
            <Box width={nameWidth} flexShrink={0}>
              <Text wrap="truncate-end">{repoName(props.root, repoPath)}</Text>
            </Box>
            {summary && summary.changes > 0 && (
              <Text color="yellow">{summary.changes} changed</Text>
            )}
            {summary && summary.ahead > 0 && (
              <Text color="green">{summary.ahead} ahead</Text>
            )}
            {summary && summary.behind > 0 && (
              <Text color="cyan">{summary.behind} behind</Text>
            )}
            {state?.error && (
              <Text color="red" wrap="truncate-end">
                {state.error}
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
