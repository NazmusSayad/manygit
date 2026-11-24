import fs from 'node:fs'
import path from 'node:path'
import { configSchema } from './lib/config'

fs.writeFileSync(
  path.resolve('./schema.json'),
  `${JSON.stringify(configSchema.toJSONSchema({ io: 'input' }), null, 2)}\n`
)
