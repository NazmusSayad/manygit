import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { Issue } from '../lib/fixes'
import { repoName } from '../lib/format'
import type { RepoDetails } from '../lib/git'

export const RELEASE_CHOICES = [
  { label: 'Patch', bump: 'patch' },
  { label: 'Minor', bump: 'minor' },
  { label: 'Major', bump: 'major' },
  { label: 'Custom tag…', bump: null },
] as const

export const COMMANDS = [
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

export function ConfirmDialog(props: {
  message: string
  danger?: boolean
  list?: string[]
  choice: 'yes' | 'no'
  width: number
  height: number
}) {
  const listHeight = Math.max(1, props.height - 16)

  return (
    <Dialog
      title="Confirm"
      hints="Switch (←→) · Choose (enter) · Yes (y) · No (n/esc)"
      width={props.width}
    >
      <Text color={props.danger ? 'red' : undefined}>{props.message}</Text>
      {props.list && (
        <Box flexDirection="column" marginTop={1}>
          {props.list.slice(0, listHeight).map((line, index) => (
            <Text
              key={index}
              color={line.startsWith('  ') ? 'yellow' : 'blue'}
              wrap="truncate-end"
            >
              {line}
            </Text>
          ))}
          {props.list.length > listHeight && (
            <Text dimColor>
              …and {props.list.length - listHeight} more lines
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1} gap={2}>
        <Text
          color={props.danger ? 'red' : undefined}
          inverse={props.choice === 'yes'}
          bold={props.choice === 'yes'}
        >
          {' Yes '}
        </Text>
        <Text inverse={props.choice === 'no'} bold={props.choice === 'no'}>
          {' No '}
        </Text>
      </Box>
    </Dialog>
  )
}

export function InputDialog(props: {
  purpose: 'new-branch' | 'bulk-new-branch' | 'bulk-checkout' | 'release-tag'
  context: string
  value: string
  width: number
}) {
  return (
    <Dialog
      title={
        props.purpose === 'bulk-checkout'
          ? 'Checkout branch'
          : props.purpose === 'release-tag'
            ? 'Release tag'
            : 'New branch'
      }
      hints={
        props.purpose === 'new-branch'
          ? 'Create (enter) · Cancel (esc)'
          : 'Continue (enter) · Cancel (esc)'
      }
      width={props.width}
    >
      <Text dimColor>{props.context}</Text>
      {props.purpose === 'bulk-checkout' && (
        <Text dimColor>
          Leave empty to check out each repo's default branch.
        </Text>
      )}
      <Box marginTop={1}>
        <Text>
          <Text color="yellow">{props.value}</Text>
          <Text inverse> </Text>
        </Text>
      </Box>
    </Dialog>
  )
}

export function IssueDialog(props: {
  root: string
  issue: Issue
  count: number
  width: number
}) {
  return (
    <Dialog
      title={`Problem ${props.count > 1 ? `1 of ${props.count} ` : ''}in ${repoName(props.root, props.issue.repoPath)}`}
      hints="Choose (↑↓) · Run (enter) · Ignore (esc)"
      width={props.width}
    >
      <Text color="red">{props.issue.problem}</Text>
      <Box flexDirection="column" marginTop={1}>
        {[
          ...props.issue.fixes,
          { label: 'Ignore', danger: false, action: null },
        ].map((fix, index) => (
          <Box
            key={fix.label}
            paddingX={1}
            backgroundColor={
              index === props.issue.choice ? '#3e4451' : undefined
            }
          >
            <Text
              color={fix.danger ? 'red' : undefined}
              bold={index === props.issue.choice}
              wrap="truncate-end"
            >
              {fix.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Dialog>
  )
}

export function ReleaseDialog(props: {
  root: string
  targets: string[]
  cursor: number
  width: number
}) {
  return (
    <Dialog
      title="Release"
      hints="Choose (↑↓) · Continue (enter) · Cancel (esc)"
      width={props.width}
    >
      <Text dimColor>
        {props.targets.length === 1
          ? `In ${repoName(props.root, props.targets[0])}`
          : `In ${props.targets.length} repos`}
        , from each repo's latest release
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {RELEASE_CHOICES.map((choice, index) => (
          <Box
            key={choice.label}
            paddingX={1}
            backgroundColor={index === props.cursor ? '#3e4451' : undefined}
          >
            <Text bold={index === props.cursor}>{choice.label}</Text>
          </Box>
        ))}
      </Box>
    </Dialog>
  )
}

export function HelpDialog(props: { cursor: number; width: number }) {
  return (
    <Dialog
      title="Commands"
      hints="Choose (↑↓) · Run (enter) · Close (esc)"
      width={props.width}
    >
      {COMMANDS.map((command, index) => (
        <Box
          key={command.key}
          gap={2}
          paddingX={1}
          backgroundColor={index === props.cursor ? '#3e4451' : undefined}
        >
          <Box width={6} flexShrink={0}>
            <Text color="yellow">{command.key}</Text>
          </Box>
          <Text bold={index === props.cursor} wrap="truncate-end">
            {command.label}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Move (↑↓ j k) · First / last (g G) · Back (esc)</Text>
      </Box>
    </Dialog>
  )
}

export function CheckoutDialog(props: {
  root: string
  repoPath: string
  branches: RepoDetails['branches']
  cursor: number
  width: number
  height: number
}) {
  const listHeight = Math.max(3, props.height - 12)
  const offset = Math.max(
    0,
    Math.min(
      props.cursor - Math.floor(listHeight / 2),
      props.branches.length - listHeight
    )
  )

  return (
    <Dialog
      title={`Checkout branch in ${repoName(props.root, props.repoPath)}`}
      hints="Choose (↑↓) · Checkout (enter) · Cancel (esc)"
      width={props.width}
    >
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
    </Dialog>
  )
}
