import fs from 'node:fs/promises'
import path from 'node:path'

export async function findRepos(dir: string): Promise<string[]> {
  const entries = await readDir(dir)

  if (entries.some((entry) => entry.name === '.git')) {
    return [dir]
  }

  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => findRepos(path.join(dir, entry.name)))
  )

  return nested.flat()
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
