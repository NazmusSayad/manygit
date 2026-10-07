import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

export function Dialog(props: {
  title: string
  hints: string
  width: number
  children: ReactNode
}) {
  return (
    <Box
      flexDirection="column"
      width={props.width}
      borderStyle="round"
      borderColor="gray"
      borderBackgroundColor="#282c34"
      backgroundColor="#282c34"
      paddingX={2}
      paddingY={1}
    >
      <Text bold>{props.title}</Text>
      <Box flexDirection="column" marginY={1}>
        {props.children}
      </Box>
      <Text dimColor>{props.hints}</Text>
    </Box>
  )
}
