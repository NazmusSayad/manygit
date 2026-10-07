import { Box, Text } from 'ink'
import { Dialog } from './dialog'
import { repoName } from './format'
import { Spinner } from './sidebar'

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
