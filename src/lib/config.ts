import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

export const CONFIG_SCHEMA_URL =
  'https://github.com/NazmusSayad/manygit/raw/refs/heads/schema/schema.json'

export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  exclude: z.array(z.string()).default([]),
  includeHidden: z.boolean().default(false),
})

export type Config = z.output<typeof configSchema>

export function loadConfig(root: string) {
  const file = path.join(root, '.manygit.json')
  if (!fs.existsSync(file)) return configSchema.parse({})

  let json: unknown
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `Invalid config file ${file}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const parsed = configSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid config file ${file}:\n${z.prettifyError(parsed.error)}`
    )
  }

  return parsed.data
}
