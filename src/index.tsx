#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from '@commander-js/extra-typings'
import { render } from 'ink'
import packageJSON from '../package.json' with { type: 'json' }
import { App } from './app'

const program = new Command()
  .name('manygit')
  .description('Browse and manage every git repo in a folder')
  .version(packageJSON.version)
  .argument('[directory]', 'folder to scan for repos', '.')
  .option(
    '--store-dir <dir>',
    'folder where manygit saves its state',
    path.join(os.homedir(), '.manygit')
  )
  .action((directory, options) => {
    const root = path.resolve(directory)

    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      program.error(`Not a directory: ${root}`)
    }

    process.env.GIT_TERMINAL_PROMPT = '0'
    process.env.GIT_SSH_COMMAND ??= 'ssh -o BatchMode=yes'

    render(<App root={root} storeDir={path.resolve(options.storeDir)} />, {
      alternateScreen: true,
      incrementalRendering: true,
    })
  })

program.parse()
