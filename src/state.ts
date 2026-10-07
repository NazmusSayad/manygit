import fs from 'node:fs'
import path from 'node:path'

type State = { selections: Record<string, string[]> }

export function loadSelection(storeDir: string, root: string) {
  return new Set(readState(storeDir).selections[root] ?? [])
}

export function saveSelection(
  storeDir: string,
  root: string,
  selection: Set<string>
) {
  const state = readState(storeDir)

  if (selection.size === 0) delete state.selections[root]
  else state.selections[root] = [...selection].sort()

  fs.mkdirSync(storeDir, { recursive: true })
  fs.writeFileSync(stateFile(storeDir), `${JSON.stringify(state, null, 2)}\n`)
}

function stateFile(storeDir: string) {
  return path.join(storeDir, 'state.json')
}

function readState(storeDir: string): State {
  const file = stateFile(storeDir)
  if (!fs.existsSync(file)) return { selections: {} }

  try {
    const state: State = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { selections: state.selections ?? {} }
  } catch (error) {
    throw new Error(
      `Invalid state file ${file}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
