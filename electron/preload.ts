import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppStoreData,
  AssistantSettings,
  MediaControlAction,
  MediaPlaybackState,
  ModelStatus,
  NoteItem,
  OrbStatus,
  ReminderItem,
  ShortcutItem
} from '../src/types/assistant'

const api = {
  getStore: () => ipcRenderer.invoke('store:get'),
  updateSettings: (partial: Partial<AssistantSettings>) =>
    ipcRenderer.invoke('settings:update', partial),

  addNote: (note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) =>
    ipcRenderer.invoke('notes:add', note),
  updateNote: (id: string, patch: Partial<NoteItem>) =>
    ipcRenderer.invoke('notes:update', id, patch),
  deleteNote: (id: string) => ipcRenderer.invoke('notes:delete', id),

  addReminder: (label: string, durationSec: number) =>
    ipcRenderer.invoke('reminders:add', label, durationSec),
  deleteReminder: (id: string) => ipcRenderer.invoke('reminders:delete', id),

  addShortcut: (shortcut: Omit<ShortcutItem, 'id'>) =>
    ipcRenderer.invoke('shortcuts:add', shortcut),
  deleteShortcut: (id: string) => ipcRenderer.invoke('shortcuts:delete', id),
  triggerShortcut: (id: string) => ipcRenderer.invoke('shortcuts:trigger', id),

  transcribeAudio: (pcmFloat32: Float32Array, wavBase64?: string) =>
    ipcRenderer.invoke('speech:transcribe', pcmFloat32, wavBase64),
  synthesizeSpeech: (text: string) => ipcRenderer.invoke('tts:synthesize', text),
  processCommand: (text: string) => ipcRenderer.invoke('brain:process', text),
  preloadWhisper: () => ipcRenderer.invoke('speech:preload'),
  getModelStatus: () => ipcRenderer.invoke('speech:status'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  getMediaState: () => ipcRenderer.invoke('media:get-state'),
  controlMedia: (action: MediaControlAction) => ipcRenderer.invoke('media:control', action),

  openDashboard: (tab?: string) => ipcRenderer.invoke('window:open-dashboard', tab),
  toggleOrbVisibility: () => ipcRenderer.invoke('window:toggle-orb'),
  setOrbExpanded: (expanded: boolean) => ipcRenderer.invoke('window:orb-expanded', expanded),
  setOrbIgnoreMouse: (ignore: boolean) => ipcRenderer.send('window:orb-ignore-mouse', ignore),
  moveOrbWindow: (deltaX: number, deltaY: number) =>
    ipcRenderer.send('window:orb-move', deltaX, deltaY),
  broadcastOrbStatus: (payload: { status: OrbStatus; transcript?: string; reply?: string }) =>
    ipcRenderer.send('orb:status-broadcast', payload),

  onStoreUpdated: (cb: (data: AppStoreData) => void) => {
    const handler = (_e: unknown, data: AppStoreData) => cb(data)
    ipcRenderer.on('store:updated', handler)
    return () => ipcRenderer.removeListener('store:updated', handler)
  },
  onModelStatus: (cb: (status: ModelStatus) => void) => {
    const handler = (_e: unknown, status: ModelStatus) => cb(status)
    ipcRenderer.on('speech:model-status', handler)
    return () => ipcRenderer.removeListener('speech:model-status', handler)
  },
  onSummonTrigger: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('assistant:summon', handler)
    return () => ipcRenderer.removeListener('assistant:summon', handler)
  },
  onToggleSlide: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('orb:toggle-slide', handler)
    return () => ipcRenderer.removeListener('orb:toggle-slide', handler)
  },
  onReminderFired: (cb: (reminder: ReminderItem) => void) => {
    const handler = (_e: unknown, reminder: ReminderItem) => cb(reminder)
    ipcRenderer.on('reminder:fired', handler)
    return () => ipcRenderer.removeListener('reminder:fired', handler)
  },
  onOrbStatusSync: (cb: (payload: { status: OrbStatus; transcript?: string; reply?: string }) => void) => {
    const handler = (
      _e: unknown,
      payload: { status: OrbStatus; transcript?: string; reply?: string }
    ) => cb(payload)
    ipcRenderer.on('orb:status-sync', handler)
    return () => ipcRenderer.removeListener('orb:status-sync', handler)
  },
  onDashboardTabRequest: (cb: (tab: string) => void) => {
    const handler = (_e: unknown, tab: string) => cb(tab)
    ipcRenderer.on('dashboard:switch-tab', handler)
    return () => ipcRenderer.removeListener('dashboard:switch-tab', handler)
  },
  onMediaState: (cb: (state: MediaPlaybackState) => void) => {
    const handler = (_e: unknown, state: MediaPlaybackState) => cb(state)
    ipcRenderer.on('media:state', handler)
    return () => ipcRenderer.removeListener('media:state', handler)
  }
}

contextBridge.exposeInMainWorld('dannAPI', api)

