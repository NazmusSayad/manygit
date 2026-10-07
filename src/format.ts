import os from 'node:os'
import path from 'node:path'

export function repoName(root: string, repoPath: string) {
  return path.relative(root, repoPath) || path.basename(repoPath)
}

export function displayPath(fullPath: string) {
  const home = os.homedir()
  return fullPath.startsWith(home)
    ? `~${fullPath.slice(home.length)}`
    : fullPath
}

export function formatAge(seconds: number) {
  const age = Date.now() / 1000 - seconds
  if (age < 3600) return `${Math.max(1, Math.floor(age / 60))}m`
  if (age < 86400) return `${Math.floor(age / 3600)}h`
  if (age < 2592000) return `${Math.floor(age / 86400)}d`
  if (age < 31536000) return `${Math.floor(age / 2592000)}mo`
  return `${Math.floor(age / 31536000)}y`
}

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lines = message.trim().split('\n')
  return (
    lines.find((line) => /^(fatal|error):/.test(line)) ??
    lines[lines.length - 1]
  )
}
