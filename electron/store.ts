import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  AppStoreData,
  AssistantSettings,
  ChatMessage,
  NoteItem,
  ReminderItem,
  ShortcutItem
} from '../src/types/assistant'

const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  {
    id: 'builtin-notepad',
    name: 'Notepad',
    triggers: ['notepad', 'buku catatan windows', 'teks editor'],
    target: 'notepad.exe',
    kind: 'system',
    builtIn: true
  },
  {
    id: 'builtin-calc',
    name: 'Kalkulator',
    triggers: ['kalkulator', 'calculator', 'hitung'],
    target: 'calc.exe',
    kind: 'system',
    builtIn: true
  },
  {
    id: 'builtin-explorer',
    name: 'File Explorer',
    triggers: ['file explorer', 'explorer', 'folder', 'berkas'],
    target: 'explorer.exe',
    kind: 'system',
    builtIn: true
  },
  {
    id: 'builtin-cmd',
    name: 'Terminal / CMD',
    triggers: ['terminal', 'cmd', 'command prompt', 'powershell'],
    target: 'cmd.exe',
    kind: 'system',
    builtIn: true
  },
  {
    id: 'builtin-settings',
    name: 'Pengaturan Windows',
    triggers: ['pengaturan windows', 'windows settings', 'setelan windows'],
    target: 'ms-settings:',
    kind: 'url',
    builtIn: true
  },
  {
    id: 'builtin-vscode',
    name: 'Visual Studio Code',
    triggers: ['vscode', 'vs code', 'visual studio code', 'kode editor'],
    target: 'code',
    kind: 'system',
    builtIn: true
  },
  {
    id: 'builtin-google',
    name: 'Google / Browser',
    triggers: ['browser', 'google', 'chrome', 'internet'],
    target: 'https://www.google.com',
    kind: 'url',
    builtIn: true
  },
  {
    id: 'builtin-youtube',
    name: 'YouTube',
    triggers: ['youtube', 'yt', 'video'],
    target: 'https://www.youtube.com',
    kind: 'url',
    builtIn: true
  },
  {
    id: 'builtin-ytmusic',
    name: 'YouTube Music',
    triggers: ['youtube music', 'yt music', 'youtube musik', 'musik youtube'],
    target: 'https://music.youtube.com',
    kind: 'url',
    builtIn: true
  },
  {
    id: 'builtin-whatsapp',
    name: 'WhatsApp Web',
    triggers: ['whatsapp', 'wa', 'wa web'],
    target: 'https://web.whatsapp.com',
    kind: 'url',
    builtIn: true
  },
  {
    id: 'builtin-github',
    name: 'GitHub',
    triggers: ['github', 'git hub'],
    target: 'https://github.com',
    kind: 'url',
    builtIn: true
  },
  {
    id: 'builtin-spotify',
    name: 'Spotify Web',
    triggers: ['spotify', 'musik'],
    target: 'https://open.spotify.com',
    kind: 'url',
    builtIn: true
  }
]

const DEFAULT_SETTINGS: AssistantSettings = {
  settingsVersion: 4,
  assistantName: 'Dann',
  wakeWord: 'Woii Dann',
  wakeAliases: [
    'woii dann',
    'woi dan',
    'woi dann',
    'woy dan',
    'woy dann',
    'oi dan',
    'oi dann',
    'wei dan',
    'hai dan',
    'halo dan',
    'oke dan',
    'eh dan',
    'bang dan'
  ],
  alwaysListen: true,
  ttsEnabled: true,
  ttsVoice: 'id-ID-ArdiNeural',
  ttsRate: 1.05,
  sttEngine: 'whisper-cpp-small',
  aiProvider: 'hybrid-gemini',
  geminiApiKey: '',
  groqApiKey: '',
  openaiApiKey: '',
  globalHotkey: 'Alt+Space',
  orbAlwaysOnTop: true,
  autoHideMascot: true,
  autoHideMinutes: 2,
  singAlongLyrics: true,
  micSensitivity: 0.014
}

export class StoreManager {
  private filePath: string
  private data: AppStoreData
  private onChangeCallbacks: Array<(data: AppStoreData) => void> = []

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'dann-store.json')
    this.data = this.load()
  }

  private getDefaultData(): AppStoreData {
    const now = Date.now()
    return {
      settings: { ...DEFAULT_SETTINGS },
      notes: [
        {
          id: crypto.randomUUID(),
          title: 'Selamat datang di Dann!',
          content:
            'Panggil "Woii Dann" (atau "Halo Dan") dalam Bahasa Indonesia, lalu ucapkan perintah seperti:\n• "Catat rapat besok jam 9 pagi"\n• "Tambah tugas selesaikan desain UI"\n• "Buka YouTube" atau "Cari musik santai di YouTube"\n• "Pasang timer 5 menit"',
          isTodo: false,
          completed: false,
          pinned: true,
          createdAt: now,
          updatedAt: now
        }
      ],
      reminders: [],
      shortcuts: [...DEFAULT_SHORTCUTS],
      history: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'Halo! Saya Dann, asisten desktop berbahasa Indonesia. Panggil saja "Woii Dann" atau tekan Alt+Space kapan pun butuh bantuan membuka aplikasi, mencatat, atau memasang pengingat!',
          actionBadge: 'Siap Melayani',
          timestamp: now
        }
      ]
    }
  }

  private load(): AppStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppStoreData>
        const defaults = this.getDefaultData()
        const mergedSettings: AssistantSettings = {
          ...defaults.settings,
          ...(parsed.settings || {})
        }

        // Migrate v1 store -> v2 Indonesian Whisper-Base + Indonesian Ardi Neural Voice
        if (!parsed.settings?.settingsVersion || parsed.settings.settingsVersion < 2) {
          mergedSettings.settingsVersion = 2
          if (mergedSettings.sttEngine === 'local-whisper-tiny') {
            mergedSettings.sttEngine = 'local-whisper-base'
          }
          mergedSettings.ttsVoice = 'id-ID-ArdiNeural'
          mergedSettings.micSensitivity = 0.014
        }

        // Migrate v2 -> v3: Appear on "Woi Dan" & auto-leave after 2 minutes of no response
        if (!parsed.settings?.settingsVersion || parsed.settings.settingsVersion < 3) {
          mergedSettings.settingsVersion = 3
          mergedSettings.autoHideMascot = true
          mergedSettings.autoHideMinutes = 2
        }

        // Migrate v3 -> v4: Upgrade offline STT to native C++ whisper.cpp Small Q5_1
        if (!parsed.settings?.settingsVersion || parsed.settings.settingsVersion < 4) {
          mergedSettings.settingsVersion = 4
          if (
            mergedSettings.sttEngine === 'local-whisper-base' ||
            mergedSettings.sttEngine === 'local-whisper-small' ||
            mergedSettings.sttEngine === 'local-whisper-tiny'
          ) {
            mergedSettings.sttEngine = 'whisper-cpp-small'
          }
        }

        const loadedShortcuts =
          Array.isArray(parsed.shortcuts) && parsed.shortcuts.length > 0
            ? [...parsed.shortcuts]
            : [...defaults.shortcuts]

        // Ensure YouTube Music built-in shortcut is present for existing users
        const ytMusicDefault = defaults.shortcuts.find((s) => s.id === 'builtin-ytmusic')
        if (ytMusicDefault && !loadedShortcuts.some((s) => s.id === 'builtin-ytmusic')) {
          loadedShortcuts.push(ytMusicDefault)
        }

        const loaded: AppStoreData = {
          settings: mergedSettings,
          notes: Array.isArray(parsed.notes) ? parsed.notes : defaults.notes,
          reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
          shortcuts: loadedShortcuts,
          history: Array.isArray(parsed.history) ? parsed.history.slice(-80) : defaults.history
        }
        this.save(loaded)
        return loaded
      }
    } catch (err) {
      console.error('[Store] Failed to load store, using defaults:', err)
    }
    const initial = this.getDefaultData()
    this.save(initial)
    return initial
  }

  private save(nextData: AppStoreData = this.data): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(nextData, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Store] Failed to save store:', err)
    }
  }

  private notify(): void {
    for (const cb of this.onChangeCallbacks) {
      cb(this.data)
    }
  }

  public onChange(cb: (data: AppStoreData) => void): void {
    this.onChangeCallbacks.push(cb)
  }

  public getData(): AppStoreData {
    return this.data
  }

  public updateSettings(partial: Partial<AssistantSettings>): AssistantSettings {
    this.data.settings = { ...this.data.settings, ...partial }
    this.save()
    this.notify()
    return this.data.settings
  }

  public addNote(input: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>): NoteItem {
    const now = Date.now()
    const note: NoteItem = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    }
    this.data.notes.unshift(note)
    this.save()
    this.notify()
    return note
  }

  public updateNote(id: string, patch: Partial<NoteItem>): NoteItem | null {
    const idx = this.data.notes.findIndex((n) => n.id === id)
    if (idx === -1) return null
    this.data.notes[idx] = {
      ...this.data.notes[idx],
      ...patch,
      updatedAt: Date.now()
    }
    this.save()
    this.notify()
    return this.data.notes[idx]
  }

  public deleteNote(id: string): boolean {
    const prevLen = this.data.notes.length
    this.data.notes = this.data.notes.filter((n) => n.id !== id)
    if (this.data.notes.length !== prevLen) {
      this.save()
      this.notify()
      return true
    }
    return false
  }

  public addReminder(label: string, durationSec: number): ReminderItem {
    const now = Date.now()
    const reminder: ReminderItem = {
      id: crypto.randomUUID(),
      label,
      durationSec,
      triggerAt: now + durationSec * 1000,
      fired: false,
      createdAt: now
    }
    this.data.reminders.unshift(reminder)
    this.save()
    this.notify()
    return reminder
  }

  public markReminderFired(id: string): ReminderItem | null {
    const item = this.data.reminders.find((r) => r.id === id)
    if (!item) return null
    item.fired = true
    this.save()
    this.notify()
    return item
  }

  public deleteReminder(id: string): boolean {
    const prevLen = this.data.reminders.length
    this.data.reminders = this.data.reminders.filter((r) => r.id !== id)
    if (this.data.reminders.length !== prevLen) {
      this.save()
      this.notify()
      return true
    }
    return false
  }

  public addShortcut(input: Omit<ShortcutItem, 'id'>): ShortcutItem {
    const shortcut: ShortcutItem = {
      ...input,
      id: crypto.randomUUID()
    }
    this.data.shortcuts.push(shortcut)
    this.save()
    this.notify()
    return shortcut
  }

  public deleteShortcut(id: string): boolean {
    const prevLen = this.data.shortcuts.length
    this.data.shortcuts = this.data.shortcuts.filter((s) => s.id !== id)
    if (this.data.shortcuts.length !== prevLen) {
      this.save()
      this.notify()
      return true
    }
    return false
  }

  public appendHistory(msg: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
    const entry: ChatMessage = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }
    this.data.history.push(entry)
    if (this.data.history.length > 100) {
      this.data.history = this.data.history.slice(-100)
    }
    this.save()
    this.notify()
    return entry
  }

  public clearHistory(): void {
    this.data.history = []
    this.save()
    this.notify()
  }
}
