import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron') as string

delete process.env.ELECTRON_RUN_AS_NODE

let electronApp: ChildProcess | null = null

function startElectronSafe() {
  if (electronApp && electronApp.pid) {
    try {
      execSync(`taskkill /pid ${electronApp.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      // Ignore if process already exited on Windows
    }
    electronApp = null
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://localhost:5173/'
  }
  delete env.ELECTRON_RUN_AS_NODE

  electronApp = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    windowsHide: false,
    env
  })

  electronApp.on('exit', () => {
    electronApp = null
  })
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart() {
          startElectronSafe()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'electron',
                '@huggingface/transformers',
                'onnxruntime-node',
                'sharp',
                'msedge-tts',
                'ws'
              ]
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/dist-electron/**', '**/dist/**']
    }
  }
})
