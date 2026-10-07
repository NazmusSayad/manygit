import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import pLimit from 'p-limit'
import { simpleGit, type SimpleGit } from 'simple-git'

const limit = pLimit(8)

export type RepoAction =
  | { kind: 'fetch' }
  | { kind: 'pull' }
  | { kind: 'push'; branch: string; setUpstream: boolean }
  | { kind: 'checkout'; branch: string }
  | { kind: 'create-branch'; branch: string }
  | { kind: 'checkout-default' }
  | { kind: 'delete-branches'; branches: string[] }
  | { kind: 'stash' }
  | { kind: 'remove-worktree'; worktreePath: string; force: boolean }
  | { kind: 'pull-rebase' }
  | { kind: 'pull-merge' }
  | { kind: 'push-force'; branch: string }
  | { kind: 'sequence'; actions: RepoAction[] }
  | { kind: 'open-remote' }

export type RepoSummary = {
  branch: string | null
  isDetached: boolean
  tracking: string | null
  ahead: number
  behind: number
  changes: number
  lastCommitAt: number | null
  lastChangeAt: number | null
  flags: {
    conflicted: boolean
    stashed: boolean
    deleted: boolean
    renamed: boolean
    modified: boolean
    staged: boolean
    untracked: boolean
  }
}

export type Activity = 'loading' | RepoAction['kind']

export type RepoState = {
  summary: RepoSummary | null
  activity: Activity | null
  error: string | null
}

export type RepoDetails = {
  files: { path: string; index: string; workingDir: string }[]
  branches: {
    name: string
    isCurrent: boolean
    upstream: string
    track: string
  }[]
  defaultBranch: string | null
  commits: { hash: string; date: number; message: string; author: string }[]
}

export function getSummary(dir: string) {
  return limit(async (): Promise<RepoSummary> => {
    const git = openRepo(dir)
    const status = await git.status()
    const lastCommit = await git.raw([
      'log',
      '-1',
      '--format=%ct',
      '--branches',
    ])
    const stashList = await git.raw(['stash', 'list'])
    const files = status.files.filter(
      (file) => !status.conflicted.includes(file.path)
    )
    const changeTimes = await Promise.all(
      status.files.map(async (file) => {
        try {
          return (await stat(path.join(dir, file.path))).mtimeMs / 1000
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            return null
          }
          throw error
        }
      })
    )
    const knownChangeTimes = changeTimes.filter((time) => time !== null)

    return {
      branch: status.current,
      isDetached: status.detached,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      changes: status.files.length,
      lastCommitAt: lastCommit.trim() === '' ? null : Number(lastCommit),
      lastChangeAt:
        knownChangeTimes.length === 0 ? null : Math.max(...knownChangeTimes),
      flags: {
        conflicted: status.conflicted.length > 0,
        stashed: stashList.trim() !== '',
        deleted: files.some(
          (file) => file.index === 'D' || file.working_dir === 'D'
        ),
        renamed: files.some((file) => file.index === 'R'),
        modified: files.some((file) => file.working_dir === 'M'),
        staged: files.some((file) => file.index !== ' ' && file.index !== '?'),
        untracked: files.some((file) => file.index === '?'),
      },
    }
  })
}

export function getDetails(dir: string) {
  return limit(async (): Promise<RepoDetails> => {
    const git = openRepo(dir)
    const status = await git.status()
    const branchOutput = await git.raw([
      'for-each-ref',
      '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)%09%(upstream:track,nobracket)',
      'refs/heads',
    ])

    const branches = branchOutput
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const fields = line.split('\t')
        return {
          isCurrent: fields[0] === '*',
          name: fields[1],
          upstream: fields[2],
          track: fields[3],
        }
      })

    const hasHead =
      status.detached || branches.some((branch) => branch.isCurrent)
    const log = hasHead ? await git.log({ maxCount: 10 }) : null

    return {
      files: status.files.map((file) => ({
        path: file.path,
        index: file.index,
        workingDir: file.working_dir,
      })),
      branches,
      defaultBranch: await getLocalDefaultBranch(git),
      commits: (log?.all ?? []).map((commit) => ({
        hash: commit.hash.slice(0, 7),
        date: Date.parse(commit.date) / 1000,
        message: commit.message,
        author: commit.author_name,
      })),
    }
  })
}

export function getOtherBranches(dir: string) {
  return limit(async () => {
    const output = await openRepo(dir).raw([
      'for-each-ref',
      '--format=%(HEAD)%09%(refname:short)',
      'refs/heads',
    ])
    const lines = output.split('\n').filter((line) => line !== '')
    if (!lines.some((line) => line.startsWith('*'))) {
      throw new Error('Not on a branch')
    }
    return lines
      .filter((line) => !line.startsWith('*'))
      .map((line) => line.split('\t')[1])
  })
}

function openRepo(dir: string) {
  return simpleGit(dir, {
    allowEnvironment: ['GIT_TERMINAL_PROMPT', 'GIT_SSH_COMMAND'],
  })
}

export function runAction(dir: string, action: RepoAction) {
  return limit(() => perform(openRepo(dir), action))
}

async function perform(git: SimpleGit, action: RepoAction): Promise<void> {
  if (action.kind === 'fetch') {
    await git.fetch()
    return
  }

  if (action.kind === 'pull') {
    await git.pull({ '--ff-only': null })
    return
  }

  if (action.kind === 'push') {
    if (action.setUpstream) {
      await git.push('origin', action.branch, { '--set-upstream': null })
    } else {
      await git.push()
    }
    return
  }

  if (action.kind === 'checkout') {
    await git.checkout(action.branch)
    return
  }

  if (action.kind === 'checkout-default') {
    await git.checkout(await getDefaultBranch(git))
    return
  }

  if (action.kind === 'delete-branches') {
    await git.raw(['prune', '--progress'])
    await git.raw(['branch', '-D', ...action.branches])
    return
  }

  if (action.kind === 'create-branch') {
    await git.checkoutLocalBranch(action.branch)
    return
  }

  if (action.kind === 'stash') {
    await git.raw(['stash', 'push', '--include-untracked'])
    return
  }

  if (action.kind === 'remove-worktree') {
    await git.raw([
      'worktree',
      'remove',
      ...(action.force ? ['--force'] : []),
      action.worktreePath,
    ])
    return
  }

  if (action.kind === 'pull-rebase') {
    try {
      await git.raw(['pull', '--rebase'])
    } catch (error) {
      await git.raw(['rebase', '--abort']).catch(() => undefined)
      throw error
    }
    return
  }

  if (action.kind === 'pull-merge') {
    try {
      await git.raw(['pull', '--no-rebase', '--no-edit'])
    } catch (error) {
      await git.raw(['merge', '--abort']).catch(() => undefined)
      throw error
    }
    return
  }

  if (action.kind === 'push-force') {
    await git.push('origin', action.branch, { '--force-with-lease': null })
    return
  }

  if (action.kind === 'open-remote') {
    const remote = (await git.raw(['remote', 'get-url', 'origin'])).trim()
    await openInBrowser(toWebUrl(remote))
    return
  }

  if (action.kind === 'sequence') {
    for (const step of action.actions) await perform(git, step)
    return
  }

  throw new Error(`Unknown action: ${JSON.stringify(action)}`)
}

function toWebUrl(remote: string) {
  const scpLike = /^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(remote)
  if (scpLike) return `https://${scpLike[1]}/${scpLike[2]}`

  const url =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(
      remote
    )
  if (url) return `https://${url[1]}/${url[2]}`

  throw new Error(`Origin is not a web URL: ${remote}`)
}

function openInBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : process.platform === 'linux'
          ? { file: 'xdg-open', args: [url] }
          : null
  if (command === null) {
    throw new Error(`Opening a browser is not supported on ${process.platform}`)
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

async function getLocalDefaultBranch(git: SimpleGit) {
  const localHead = await git.raw([
    'for-each-ref',
    '--format=%(symref:short)',
    'refs/remotes/origin/HEAD',
  ])
  if (localHead.trim() === '') return null
  return localHead.trim().slice('origin/'.length)
}

async function getDefaultBranch(git: SimpleGit) {
  const localDefault = await getLocalDefaultBranch(git)
  if (localDefault !== null) return localDefault

  const remoteHead = await git.raw(['ls-remote', '--symref', 'origin', 'HEAD'])
  const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(remoteHead)
  if (!match) throw new Error('Could not find the default branch of origin')
  return match[1]
}
