import path from 'node:path'
import { repoName } from './format'
import type { RepoState } from './git'

export type SortMode = 'name' | 'path' | 'last-commit' | 'last-change'

export const SORT_MODES: SortMode[] = [
  'name',
  'path',
  'last-commit',
  'last-change',
]

export function sortRepos(
  paths: string[],
  repos: Record<string, RepoState>,
  sortMode: SortMode,
  root: string
) {
  return [...paths].sort((a, b) => {
    const byName = repoName(root, a).localeCompare(repoName(root, b))
    if (sortMode === 'path') return byName
    if (sortMode === 'name') {
      return path.basename(a).localeCompare(path.basename(b)) || byName
    }
    if (sortMode === 'last-commit') {
      const aTime = repos[a]?.summary?.lastCommitAt ?? 0
      const bTime = repos[b]?.summary?.lastCommitAt ?? 0
      return bTime - aTime || byName
    }
    if (sortMode === 'last-change') {
      const aTime = repos[a]?.summary?.lastChangeAt ?? 0
      const bTime = repos[b]?.summary?.lastChangeAt ?? 0
      return bTime - aTime || byName
    }
    throw new Error(`Unknown sort mode: ${String(sortMode)}`)
  })
}
