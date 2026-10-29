import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  session,
  Tray
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StoreManager } from './store'
import { SpeechService } from './speechService'
import { IndonesianTTSService } from './ttsService'
import { AssistantBrain } from './assistantBrain'
import { MediaLyricsService } from './mediaLyricsService'
import { executeShortcut } from './launcher'
import type {
  AssistantSettings,
  MediaControlAction,
  NoteItem,
  ShortcutItem
} from '../src/types/assistant'

// Allow background Web Audio & Indonesian MP3 TTS playback without requiring prior window click!
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_PATH = path.join(__dirname, '../dist')
const PRELOAD_PATH = path.join(__dirname, 'preload.js')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let orbWindow: BrowserWindow | null = null
let dashboardWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

let store: StoreManager
let speechService: SpeechService
let ttsService: IndonesianTTSService
let mediaLyricsService: MediaLyricsService
let brain: AssistantBrain
let reminderInterval: NodeJS.Timeout | null = null

function createAppIcon(): Electron.NativeImage {
  const candidates = [
    path.join(DIST_PATH, 'icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../assets/icon.ico'),
    path.join(DIST_PATH, 'icon.png'),
    path.join(__dirname, '../public/icon.png')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        return img
      }
    }
  }
  return nativeImage.createEmpty()
}

function createOrbTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(DIST_PATH, 'icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(DIST_PATH, 'icon-tray.png'),
    path.join(__dirname, '../public/icon-tray.png'),
    path.join(DIST_PATH, 'icon.png'),
    path.join(__dirname, '../public/icon.png')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        return p.endsWith('.ico') ? img : img.resize({ width: 32, height: 32 })
      }
    }
  }

  return createAppIcon()
}

function broadcastToAll(channel: string, payload?: unknown): void {
  if (orbWindow && !orbWindow.isDestroyed()) {
    orbWindow.webContents.send(channel, payload)
  }
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send(channel, payload)
  }
}

function createOrbWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { x: wx, y: wy, width: sw, height: sh } = primaryDisplay.workArea
  const winW = 420
  const winH = 396

  orbWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: wx + sw - winW - 16,
    y: wy + sh - winH,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: store.getData().settings.orbAlwaysOnTop,
    icon: createAppIcon(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Keep wake-word listener active in background!
    }
  })

  orbWindow.setAlwaysOnTop(store.getData().settings.orbAlwaysOnTop, 'screen-saver')

  orbWindow.once('ready-to-show', () => {
    orbWindow?.showInactive()
    console.log('[Dann] Floating Orb window shown.')
  })

  if (VITE_DEV_SERVER_URL) {
    orbWindow.loadURL(`${VITE_DEV_SERVER_URL}#orb`)
  } else {
    orbWindow.loadFile(path.join(DIST_PATH, 'index.html'), { hash: 'orb' })
  }

  orbWindow.on('closed', () => {
    orbWindow = null
  })
}

function createDashboardWindow(initialTab?: string): void {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show()
    dashboardWindow.focus()
    if (initialTab) {
      dashboardWindow.webContents.send('dashboard:switch-tab', initialTab)
    }
    return
  }

  dashboardWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Dann — Asisten Desktop Pintar',
    backgroundColor: '#FFFDF7',
    autoHideMenuBar: true,
    icon: createAppIcon(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow?.show()
    dashboardWindow?.moveTop()
    dashboardWindow?.focus()
    console.log('[Dann] Dashboard window shown.')
  })

  if (VITE_DEV_SERVER_URL) {
    dashboardWindow.loadURL(`${VITE_DEV_SERVER_URL}#dashboard`)
  } else {
    dashboardWindow.loadFile(path.join(DIST_PATH, 'index.html'), { hash: 'dashboard' })
  }

  if (initialTab) {
    dashboardWindow.webContents.once('did-finish-load', () => {
      dashboardWindow?.webContents.send('dashboard:switch-tab', initialTab)
    })
  }

  dashboardWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      dashboardWindow?.hide()
    }
  })

  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })
}

function setupTray(): void {
  const icon = createOrbTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('Dann — Asisten Suara ("Woii Dann")')

  const rebuildMenu = () => {
    const settings = store.getData().settings
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Dann (${settings.wakeWord})`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Panggil Dann Sekarang (Alt+Space)',
        click: () => {
          if (orbWindow && !orbWindow.isDestroyed()) {
            orbWindow.show()
            orbWindow.webContents.send('assistant:summon')
          }
        }
      },
      {
        label: 'Buka Panel Dashboard',
        click: () => createDashboardWindow('home')
      },
      {
        label: settings.alwaysListen
          ? '✓ Mode Dengar "Woii Dann" Aktif'
          : 'Aktifkan Mode Dengar "Woii Dann"',
        click: () => {
          store.updateSettings({ alwaysListen: !settings.alwaysListen })
          rebuildMenu()
        }
      },
      {
        label:
          settings.singAlongLyrics !== false
            ? '✓ Mode Lirik Bernyanyi Aktif'
            : 'Aktifkan Mode Lirik Bernyanyi',
        click: () => {
          store.updateSettings({ singAlongLyrics: settings.singAlongLyrics === false })
          rebuildMenu()
        }
      },
      {
        label: 'Naik / Turunkan Karakter Dann',
        click: () => {
          if (!orbWindow || orbWindow.isDestroyed()) {
            createOrbWindow()
          } else {
            orbWindow.showInactive()
            orbWindow.webContents.send('orb:toggle-slide')
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Keluar dari Dann',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray?.setContextMenu(contextMenu)
  }

  rebuildMenu()
  store.onChange(() => rebuildMenu())

  tray.on('double-click', () => {
    createDashboardWindow('home')
  })
}

function registerHotkey(hotkey: string): void {
  globalShortcut.unregisterAll()
  if (!hotkey.trim()) return
  try {
    globalShortcut.register(hotkey, () => {
      if (!orbWindow || orbWindow.isDestroyed()) {
        createOrbWindow()
      } else {
        orbWindow.show()
      }
      orbWindow?.webContents.send('assistant:summon')
    })
  } catch (err) {
    console.warn('[Main] Failed to register hotkey:', hotkey, err)
  }
}

function startReminderTicker(): void {
  if (reminderInterval) clearInterval(reminderInterval)
  reminderInterval = setInterval(() => {
    const now = Date.now()
    const reminders = store.getData().reminders
    for (const r of reminders) {
      if (!r.fired && now >= r.triggerAt) {
        const updated = store.markReminderFired(r.id)
        if (updated) {
          if (Notification.isSupported()) {
            new Notification({
              title: '⏰ Pengingat dari Dann!',
              body: updated.label,
              icon: createAppIcon()
            }).show()
          }
          store.appendHistory({
            role: 'assistant',
            text: `Bos! Waktunya pengingat: "${updated.label}"`,
            actionBadge: '⏰ Alarm Selesai'
          })
          broadcastToAll('reminder:fired', updated)
        }
      }
    }
  }, 1000)
}

function setupIPC(): void {
  ipcMain.handle('store:get', () => store.getData())

  ipcMain.handle('settings:update', (_e, partial: Partial<AssistantSettings>) => {
    const prevHotkey = store.getData().settings.globalHotkey
    const next = store.updateSettings(partial)

    if (partial.globalHotkey !== undefined && partial.globalHotkey !== prevHotkey) {
      registerHotkey(next.globalHotkey)
    }
    if (partial.orbAlwaysOnTop !== undefined && orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.setAlwaysOnTop(next.orbAlwaysOnTop, 'screen-saver')
    }
    return next
  })

  ipcMain.handle('notes:add', (_e, note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) =>
    store.addNote(note)
  )
  ipcMain.handle('notes:update', (_e, id: string, patch: Partial<NoteItem>) =>
    store.updateNote(id, patch)
  )
  ipcMain.handle('notes:delete', (_e, id: string) => store.deleteNote(id))

  ipcMain.handle('reminders:add', (_e, label: string, durationSec: number) =>
    store.addReminder(label, durationSec)
  )
  ipcMain.handle('reminders:delete', (_e, id: string) => store.deleteReminder(id))

  ipcMain.handle('shortcuts:add', (_e, shortcut: Omit<ShortcutItem, 'id'>) =>
    store.addShortcut(shortcut)
  )
  ipcMain.handle('shortcuts:delete', (_e, id: string) => store.deleteShortcut(id))
  ipcMain.handle('shortcuts:trigger', async (_e, id: string) => {
    const found = store.getData().shortcuts.find((s) => s.id === id)
    if (!found) return { ok: false, message: 'Pintasan tidak ditemukan' }
    return executeShortcut(found)
  })

  ipcMain.handle('speech:preload', async () => {
    const data = store.getData()
    try {
      await speechService.preloadOfflineEngine(data.settings, data.shortcuts)
    } catch {
      // Status already updated via callback
    }
    return speechService.getStatus()
  })

  ipcMain.handle('speech:status', () => speechService.getStatus())

  ipcMain.handle(
    'speech:transcribe',
    async (_e, pcmFloat32: Float32Array, wavBase64?: string) => {
      const data = store.getData()
      return speechService.transcribe(
        pcmFloat32,
        wavBase64,
        data.settings,
        data.shortcuts,
        mediaLyricsService.getState()
      )
    }
  )

  ipcMain.handle('tts:synthesize', async (_e, text: string) => {
    const s = store.getData().settings
    return ttsService.synthesize(text, s.ttsVoice || 'id-ID-ArdiNeural', s.ttsRate || 1.05)
  })

  ipcMain.handle('brain:process', async (_e, text: string) => {
    const res = await brain.handleInput(text)
    if (res.openDashboardTab) {
      createDashboardWindow(res.openDashboardTab)
    }
    return res
  })

  ipcMain.handle('history:clear', () => {
    store.clearHistory()
  })

  ipcMain.handle('media:get-state', () => {
    return mediaLyricsService.getState()
  })

  ipcMain.handle('media:control', (_e, action: MediaControlAction) => {
    return mediaLyricsService.control(action)
  })

  ipcMain.handle('window:open-dashboard', (_e, tab?: string) => {
    createDashboardWindow(tab)
  })

  ipcMain.handle('window:toggle-orb', () => {
    if (!orbWindow || orbWindow.isDestroyed()) {
      createOrbWindow()
    } else {
      orbWindow.showInactive()
      orbWindow.webContents.send('orb:toggle-slide')
    }
  })

  ipcMain.handle('window:orb-expanded', () => {
    // Reserved for future layout hooks
  })

  ipcMain.on('window:orb-ignore-mouse', (_e, ignore: boolean) => {
    if (orbWindow && !orbWindow.isDestroyed()) {
      if (ignore) {
        orbWindow.setIgnoreMouseEvents(true, { forward: true })
      } else {
        orbWindow.setIgnoreMouseEvents(false)
      }
    }
  })

  ipcMain.on('window:orb-move', (_e, deltaX: number) => {
    if (orbWindow && !orbWindow.isDestroyed()) {
      const [x, y] = orbWindow.getPosition()
      const disp = screen.getDisplayNearestPoint({ x, y })
      const { y: wy, height: sh } = disp.workArea
      const [, winH] = orbWindow.getSize()
      orbWindow.setPosition(Math.round(x + deltaX), wy + sh - winH)
    }
  })

  ipcMain.on('orb:status-broadcast', (_e, payload) => {
    broadcastToAll('orb:status-sync', payload)
  })
}

// Prevent duplicate instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    createDashboardWindow('home')
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dann.desktop.assistant')

    // Grant microphone & notification permissions seamlessly
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media' || permission === 'notifications') {
        callback(true)
      } else {
        callback(false)
      }
    })

    store = new StoreManager()
    speechService = new SpeechService()
    ttsService = new IndonesianTTSService()
    mediaLyricsService = new MediaLyricsService()
    brain = new AssistantBrain(
      store,
      (label, durationSec) => {
        store.addReminder(label, durationSec)
      },
      () => mediaLyricsService.getState(),
      (action) => mediaLyricsService.control(action)
    )

    store.onChange((data) => {
      broadcastToAll('store:updated', data)
    })

    speechService.onStatus((status) => {
      broadcastToAll('speech:model-status', status)
    })

    mediaLyricsService.onStateChange((mediaState) => {
      broadcastToAll('media:state', mediaState)
    })

    setupIPC()
    createOrbWindow()
    createDashboardWindow('home')
    setupTray()
    registerHotkey(store.getData().settings.globalHotkey)
    startReminderTicker()
    mediaLyricsService.start()

    // Warm up local offline whisper.cpp & Indonesian Neural Voice shortly after UI opens
    setTimeout(() => {
      const data = store.getData()
      if (speechService.isOfflineEngine(data.settings.sttEngine)) {
        speechService.preloadOfflineEngine(data.settings, data.shortcuts).catch(() => {})
      }
      if (data.settings.ttsEnabled) {
        ttsService.warmUp(data.settings.ttsVoice || 'id-ID-ArdiNeural').catch(() => {})
      }
    }, 800)
  })
}

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  if (reminderInterval) clearInterval(reminderInterval)
  mediaLyricsService?.stop()
  speechService?.shutdown()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})

