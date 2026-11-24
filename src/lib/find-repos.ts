import fs from 'node:fs/promises'
import path from 'node:path'
import type { Config } from './config'

export async function findRepos(
  root: string,
  config: Config,
  dir = root
): Promise<string[]> {
  const entries = await readDir(dir)

  if (entries.some((entry) => entry.name === '.git')) {
    return [dir]
  }

  const nested = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          (config.includeHidden || !entry.name.startsWith('.'))
      )
      .map((entry) => path.join(dir, entry.name))
      .filter((child) => !isExcluded(root, child, config.exclude))
      .map((child) => findRepos(root, config, child))
  )

  return nested.flat()
}

function isExcluded(root: string, dir: string, exclude: string[]) {
  const relative = path.relative(root, dir).split(path.sep).join('/')
  return exclude.some((pattern) => path.posix.matchesGlob(relative, pattern))
}

async function readDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EACCES' || error.code === 'EPERM')
    ) {
      return []
    }

    throw error
  }
}
