export interface NoteItem {
  id: string
  title: string
  content: string
  isTodo: boolean
  completed: boolean
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface ReminderItem {
  id: string
  label: string
  triggerAt: number
  durationSec: number
  fired: boolean
  createdAt: number
}

export interface ShortcutItem {
  id: string
  name: string
  triggers: string[]
  target: string
  kind: 'app' | 'url' | 'system'
  builtIn?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  actionBadge?: string
  timestamp: number
}

export type STTEngine =
  | 'whisper-cpp-small'
  | 'whisper-cpp-base'
  | 'whisper-cpp-turbo'
  | 'local-whisper-base'
  | 'local-whisper-tiny'
  | 'local-whisper-small'
  | 'groq-whisper'
  | 'openai-whisper'

export type TTSVoice =
  | 'id-ID-ArdiNeural'
  | 'id-ID-GadisNeural'
  | 'google-id'

export type AIProvider =
  | 'hybrid-gemini'
  | 'hybrid-groq'
  | 'hybrid-openai'
  | 'local-only'

export interface AssistantSettings {
  settingsVersion?: number
  assistantName: string
  wakeWord: string
  wakeAliases: string[]
  alwaysListen: boolean
  ttsEnabled: boolean
  ttsVoice: TTSVoice
  ttsRate: number
  sttEngine: STTEngine
  aiProvider: AIProvider
  geminiApiKey: string
  groqApiKey: string
  openaiApiKey: string
  globalHotkey: string
  orbAlwaysOnTop: boolean
  autoHideMascot?: boolean
  autoHideMinutes?: number
  singAlongLyrics?: boolean
  micSensitivity: number
}

export interface AppStoreData {
  settings: AssistantSettings
  notes: NoteItem[]
  reminders: ReminderItem[]
  shortcuts: ShortcutItem[]
  history: ChatMessage[]
}

export type OrbStatus =
  | 'idle'
  | 'standby'        // Pose 1: Santai menunggu "Woii Dann"
  | 'awake'          // Pose 2: Pakai headphone mendengarkan perintah!
  | 'thinking'       // Pose 4: Lampu ide memproses perintah
  | 'speaking'       // Pose 4: Lampu ide menjawab dalam Bahasa Indonesia
  | 'alert'          // Pose 3: Semangat / Alarm!

export interface ModelStatus {
  status: 'idle' | 'loading' | 'ready' | 'error'
  progress: number
  model: string
  message: string
}

export interface CommandResult {
  reply: string
  normalizedInput?: string
  actionBadge?: string
  openDashboardTab?: 'home' | 'notes' | 'reminders' | 'shortcuts' | 'settings'
  shouldContinueConversation?: boolean
  triggerPose?: 'idle' | 'listen' | 'idea' | 'alert'
  dismissMascot?: boolean
}

export interface LyricLine {
  timeMs: number
  text: string
}

export type MediaSourceKind = 'Spotify' | 'YouTube Music' | 'YouTube' | ''

export type MediaControlAction = 'play' | 'pause' | 'toggle' | 'next' | 'previous'

export interface MediaPlaybackState {
  active: boolean
  isPlaying?: boolean
  hasSession?: boolean
  source: MediaSourceKind
  title: string
  artist: string
  cleanTitle: string
  cleanArtist: string
  positionMs: number
  durationMs: number
  updatedAt: number
  lyricsStatus: 'idle' | 'loading' | 'ready' | 'not-found'
  isSynced: boolean
  lyrics: LyricLine[]
}

export interface DannAPI {
  // Store & State
  getStore: () => Promise<AppStoreData>
  updateSettings: (partial: Partial<AssistantSettings>) => Promise<AssistantSettings>

  // Notes & Todos
  addNote: (note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<NoteItem>
  updateNote: (id: string, patch: Partial<NoteItem>) => Promise<NoteItem | null>
  deleteNote: (id: string) => Promise<boolean>

  // Reminders
  addReminder: (label: string, durationSec: number) => Promise<ReminderItem>
  deleteReminder: (id: string) => Promise<boolean>

  // Shortcuts
  addShortcut: (shortcut: Omit<ShortcutItem, 'id'>) => Promise<ShortcutItem>
  deleteShortcut: (id: string) => Promise<boolean>
  triggerShortcut: (id: string) => Promise<{ ok: boolean; message: string }>

  // Speech, Indonesian TTS & Brain
  transcribeAudio: (pcmFloat32: Float32Array, wavBase64?: string) => Promise<{ text: string; error?: string }>
  synthesizeSpeech: (text: string) => Promise<{ audioBase64: string; mimeType: string } | null>
  processCommand: (text: string) => Promise<CommandResult>
  preloadWhisper: () => Promise<ModelStatus>
  getModelStatus: () => Promise<ModelStatus>
  clearHistory: () => Promise<void>

  // Media & Synced Singing Lyrics (Spotify / YouTube / YouTube Music)
  getMediaState: () => Promise<MediaPlaybackState>
  controlMedia: (action: MediaControlAction) => Promise<{ ok: boolean; action: MediaControlAction }>

  // Window Management
  openDashboard: (tab?: string) => Promise<void>
  toggleOrbVisibility: () => Promise<void>
  setOrbExpanded: (expanded: boolean) => Promise<void>
  setOrbIgnoreMouse: (ignore: boolean) => void
  moveOrbWindow: (deltaX: number, deltaY: number) => void
  broadcastOrbStatus: (payload: { status: OrbStatus; transcript?: string; reply?: string }) => void

  // Event Subscriptions
  onStoreUpdated: (cb: (data: AppStoreData) => void) => () => void
  onModelStatus: (cb: (status: ModelStatus) => void) => () => void
  onSummonTrigger: (cb: () => void) => () => void
  onToggleSlide: (cb: () => void) => () => void
  onReminderFired: (cb: (reminder: ReminderItem) => void) => () => void
  onOrbStatusSync: (cb: (payload: { status: OrbStatus; transcript?: string; reply?: string }) => void) => () => void
  onDashboardTabRequest: (cb: (tab: string) => void) => () => void
  onMediaState: (cb: (state: MediaPlaybackState) => void) => () => void
}

declare global {
  interface Window {
    dannAPI: DannAPI
  }
}
