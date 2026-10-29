import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  windowsHide: false,
  env
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
