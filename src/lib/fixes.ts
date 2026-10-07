import type { RepoAction } from './git'

export type Fix = { label: string; danger: boolean; action: RepoAction }

export type Issue = {
  repoPath: string
  problem: string
  fixes: Fix[]
  choice: number
}

export function getFixes(action: RepoAction, message: string) {
  const problems: { problem: string; fixes: Fix[] }[] = []

  for (const match of message.matchAll(
    /cannot delete branch '(.+?)' used by worktree at '(.+?)'/g
  )) {
    problems.push({
      problem: match[0],
      fixes: [
        {
          label: `Remove worktree at ${match[2]}, then delete ${match[1]}`,
          danger: false,
          action: {
            kind: 'sequence',
            actions: [
              { kind: 'remove-worktree', worktreePath: match[2], force: false },
              { kind: 'delete-branches', branches: [match[1]] },
            ],
          },
        },
      ],
    })
  }

  const worktreeMatch = /'(.+?)' is already used by worktree at '(.+?)'/.exec(
    message
  )
  if (worktreeMatch) {
    problems.push({
      problem: worktreeMatch[0],
      fixes: [
        {
          label: `Remove worktree at ${worktreeMatch[2]}, then retry`,
          danger: false,
          action: {
            kind: 'sequence',
            actions: [
              {
                kind: 'remove-worktree',
                worktreePath: worktreeMatch[2],
                force: false,
              },
              action,
            ],
          },
        },
      ],
    })
  }

  const firstStep = action.kind === 'sequence' ? action.actions[0] : null
  if (
    /contains modified or untracked files, use --force/.test(message) &&
    action.kind === 'sequence' &&
    firstStep?.kind === 'remove-worktree'
  ) {
    problems.push({
      problem: `Worktree at ${firstStep.worktreePath} has uncommitted changes`,
      fixes: [
        {
          label: 'Force remove the worktree (discards its changes)',
          danger: true,
          action: {
            kind: 'sequence',
            actions: [
              { ...firstStep, force: true },
              ...action.actions.slice(1),
            ],
          },
        },
      ],
    })
  }

  if (
    /Your local changes to the following files would be overwritten|untracked working tree files would be overwritten/.test(
      message
    )
  ) {
    problems.push({
      problem: 'Local changes are in the way',
      fixes: [
        {
          label: 'Stash changes, then retry',
          danger: false,
          action: { kind: 'sequence', actions: [{ kind: 'stash' }, action] },
        },
      ],
    })
  }

  const existsMatch = /a branch named '(.+?)' already exists/.exec(message)
  if (existsMatch && action.kind === 'create-branch') {
    problems.push({
      problem: `Branch ${existsMatch[1]} already exists`,
      fixes: [
        {
          label: `Checkout existing ${existsMatch[1]}`,
          danger: false,
          action: { kind: 'checkout', branch: existsMatch[1] },
        },
      ],
    })
  }

  if (
    /pathspec '.+?' did not match/.test(message) &&
    action.kind === 'checkout'
  ) {
    problems.push({
      problem: `Branch ${action.branch} does not exist`,
      fixes: [
        {
          label: `Create branch ${action.branch}`,
          danger: false,
          action: { kind: 'create-branch', branch: action.branch },
        },
      ],
    })
  }

  if (/Not possible to fast-forward/.test(message)) {
    problems.push({
      problem: 'Local and remote branches have diverged',
      fixes: [
        {
          label: 'Pull with rebase',
          danger: false,
          action: { kind: 'pull-rebase' },
        },
        {
          label: 'Pull with merge',
          danger: false,
          action: { kind: 'pull-merge' },
        },
      ],
    })
  }

  if (/\[rejected\]/.test(message) && action.kind === 'push') {
    problems.push({
      problem: 'Push was rejected because the remote has new commits',
      fixes: [
        {
          label: 'Pull with rebase, then push',
          danger: false,
          action: {
            kind: 'sequence',
            actions: [{ kind: 'pull-rebase' }, action],
          },
        },
        {
          label: 'Force push (overwrites remote commits)',
          danger: true,
          action: { kind: 'push-force', branch: action.branch },
        },
      ],
    })
  }

  return problems
}
