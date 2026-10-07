import { Box, Text } from 'ink'
import type { RepoDetails } from './git'

export function BranchPicker(props: {
  branches: RepoDetails['branches']
  cursor: number
  height: number
}) {
  const listHeight = Math.max(1, props.height)
  const offset = Math.max(
    0,
    Math.min(
      props.cursor - Math.floor(listHeight / 2),
      props.branches.length - listHeight
    )
  )

  return (
    <Box flexDirection="column">
      {props.branches
        .slice(offset, offset + listHeight)
        .map((branch, index) => {
          const isSelected = offset + index === props.cursor

          return (
            <Box
              key={branch.name}
              gap={2}
              backgroundColor={isSelected ? '#3e4451' : undefined}
            >
              <Text color="yellow" bold={isSelected} wrap="truncate-end">
                {branch.name}
              </Text>
              {branch.isCurrent && <Text dimColor>current</Text>}
              {branch.track && <Text color="cyan">{branch.track}</Text>}
            </Box>
          )
        })}
    </Box>
  )
}
