import fs from 'node:fs'
import path from 'node:path'
import type { SortMode } from './app'

type State = {
  selections: Record<string, string[]>
  sorts: Record<string, SortMode>
}

const SORT_MODES: SortMode[] = ['name', 'last-commit', 'last-change']

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

  writeState(storeDir, state)
}

export function loadSortMode(storeDir: string, root: string) {
  return readState(storeDir).sorts[root] ?? 'name'
}

export function saveSortMode(
  storeDir: string,
  root: string,
  sortMode: SortMode
) {
  const state = readState(storeDir)
  state.sorts[root] = sortMode
  writeState(storeDir, state)
}

function writeState(storeDir: string, state: State) {
  fs.mkdirSync(storeDir, { recursive: true })
  fs.writeFileSync(stateFile(storeDir), `${JSON.stringify(state, null, 2)}\n`)
}

function stateFile(storeDir: string) {
  return path.join(storeDir, 'state.json')
}

function readState(storeDir: string): State {
  const file = stateFile(storeDir)
  if (!fs.existsSync(file)) return { selections: {}, sorts: {} }

  let state: Partial<State>
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `Invalid state file ${file}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const sorts = state.sorts ?? {}
  for (const sortMode of Object.values(sorts)) {
    if (!SORT_MODES.includes(sortMode)) {
      throw new Error(`Invalid sort mode '${sortMode}' in state file ${file}`)
    }
  }
  return { selections: state.selections ?? {}, sorts }
}
