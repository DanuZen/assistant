import React, { useEffect, useRef, useState } from 'react'
import {
  Bell,
  CheckCircle2,
  Circle,
  Clock,
  Cpu,
  ExternalLink,
  FolderOpen,
  MessageSquare,
  Mic,
  Music,
  Pause,
  Pin,
  Play,
  Plus,
  Rocket,
  Send,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  StickyNote,
  Trash2,
  Volume2
} from 'lucide-react'
import type {
  AppStoreData,
  AssistantSettings,
  MediaPlaybackState,
  ModelStatus,
  OrbStatus
} from '../types/assistant'
import { speakText } from '../utils/tts'
import { CHARACTER_POSES } from '../utils/characterPoses'
import appIcon from '../assets/icon.png'

type TabKey = 'home' | 'notes' | 'reminders' | 'shortcuts' | 'settings'

const QUICK_PROMPTS = [
  'Jam berapa sekarang?',
  'Kasih semangat dong!',
  'Catat beli kopi susu jam 4 sore',
  'Tambah tugas rapikan folder proyek',
  'Pasang timer 5 menit istirahat mata',
  'Buka Kalkulator',
  'Cek info sistem'
]

export const Dashboard: React.FC = () => {
  const [store, setStore] = useState<AppStoreData | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('home')
  const [orbSync, setOrbSync] = useState<{
    status: OrbStatus
    transcript?: string
    reply?: string
  }>({ status: 'standby' })
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [mediaState, setMediaState] = useState<MediaPlaybackState | null>(null)

  // Home chat input
  const [chatInput, setChatInput] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  // Notes state
  const [noteFilter, setNoteFilter] = useState<'all' | 'note' | 'todo'>('all')
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [newNoteContent, setNewNoteContent] = useState('')
  const [newNoteIsTodo, setNewNoteIsTodo] = useState(false)

  // Reminders state
  const [remLabel, setRemLabel] = useState('')
  const [remMinutes, setRemMinutes] = useState('5')
  const [nowTick, setNowTick] = useState(Date.now())

  // Shortcuts state
  const [scName, setScName] = useState('')
  const [scTriggers, setScTriggers] = useState('')
  const [scTarget, setScTarget] = useState('')
  const [scKind, setScKind] = useState<'app' | 'url'>('app')

  // Settings draft state
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('')

  useEffect(() => {
    window.dannAPI.getStore().then((data) => setStore(data))
    window.dannAPI.getModelStatus().then((st) => setModelStatus(st))
    window.dannAPI.getMediaState().then((ms) => setMediaState(ms))

    const unsubStore = window.dannAPI.onStoreUpdated((data) => setStore(data))
    const unsubModel = window.dannAPI.onModelStatus((st) => setModelStatus(st))
    const unsubMedia = window.dannAPI.onMediaState((ms) => setMediaState(ms))
    const unsubOrb = window.dannAPI.onOrbStatusSync((payload) => setOrbSync(payload))
    const unsubTab = window.dannAPI.onDashboardTabRequest((tab) => {
      if (['home', 'notes', 'reminders', 'shortcuts', 'settings'].includes(tab)) {
        setActiveTab(tab as TabKey)
      }
    })

    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)

    return () => {
      unsubStore()
      unsubModel()
      unsubMedia()
      unsubOrb()
      unsubTab()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'home') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [store?.history.length, activeTab])

  if (!store) {
    return (
      <div className="dash-loading">
        <div className="dash-spinner" />
        <p>Memuat Asisten Dann...</p>
      </div>
    )
  }

  const { settings, notes, reminders, shortcuts, history } = store

  const handleSendTextCommand = async (customText?: string) => {
    const text = (customText ?? chatInput).trim()
    if (!text || sendingChat) return
    if (!customText) setChatInput('')
    setSendingChat(true)
    try {
      const res = await window.dannAPI.processCommand(text)
      if (settings.ttsEnabled) {
        speakText(res.reply, settings.ttsRate)
      }
    } finally {
      setSendingChat(false)
    }
  }

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = newNoteContent.trim() || newNoteTitle.trim()
    if (!content) return
    const title = newNoteTitle.trim() || content.slice(0, 40)
    await window.dannAPI.addNote({
      title,
      content,
      isTodo: newNoteIsTodo,
      completed: false,
      pinned: false
    })
    setNewNoteTitle('')
    setNewNoteContent('')
  }

  const handleAddReminderSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const mins = parseFloat(remMinutes)
    if (isNaN(mins) || mins <= 0) return
    await window.dannAPI.addReminder(
      remLabel.trim() || 'Pengingat Dann',
      Math.max(5, Math.round(mins * 60))
    )
    setRemLabel('')
  }

  const handleAddShortcutSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scName.trim() || !scTarget.trim()) return
    const triggers = scTriggers
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (triggers.length === 0) triggers.push(scName.trim().toLowerCase())

    await window.dannAPI.addShortcut({
      name: scName.trim(),
      triggers,
      target: scTarget.trim(),
      kind: scKind
    })
    setScName('')
    setScTriggers('')
    setScTarget('')
  }

  const patchSettings = async (partial: Partial<AssistantSettings>) => {
    await window.dannAPI.updateSettings(partial)
    setSettingsSavedMsg('Tersimpan otomatis ✓')
    window.setTimeout(() => setSettingsSavedMsg(''), 2200)
  }

  const filteredNotes = notes
    .filter((n) => {
      if (noteFilter === 'note') return !n.isTodo
      if (noteFilter === 'todo') return n.isTodo
      return true
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)

  const formatCountdown = (triggerAt: number, fired: boolean) => {
    if (fired) return 'Selesai'
    const diffSec = Math.max(0, Math.ceil((triggerAt - nowTick) / 1000))
    const m = Math.floor(diffSec / 60)
    const s = diffSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="dash-layout">
      {/* Sidebar */}
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <div className={`dash-brand-avatar state-${orbSync.status}`}>
            <img
              src={appIcon}
              alt={settings.assistantName}
              draggable={false}
            />
          </div>
          <div>
            <h1 className="dash-brand-title">{settings.assistantName}</h1>
            <span className="dash-brand-sub">Wake: "{settings.wakeWord}"</span>
          </div>
        </div>

        <button
          className="dash-summon-btn"
          onClick={() => window.dannAPI.toggleOrbVisibility().then(() => {})}
          title="Tampilkan / Sembunyikan Karakter Dann di sudut layar"
        >
          <Mic size={16} />
          <span>
            {orbSync.status === 'awake'
              ? 'Sedang Mendengarkan...'
              : `Karakter: "${settings.wakeWord}"`}
          </span>
        </button>

        <nav className="dash-nav">
          <button
            className={`dash-nav-item ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            <MessageSquare size={18} />
            <span>Beranda & Perintah</span>
          </button>

          <button
            className={`dash-nav-item ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            <StickyNote size={18} />
            <span>Catatan & Tugas</span>
            {notes.length > 0 && <span className="dash-badge">{notes.length}</span>}
          </button>

          <button
            className={`dash-nav-item ${activeTab === 'reminders' ? 'active' : ''}`}
            onClick={() => setActiveTab('reminders')}
          >
            <Bell size={18} />
            <span>Timer & Pengingat</span>
            {reminders.filter((r) => !r.fired).length > 0 && (
              <span className="dash-badge accent">
                {reminders.filter((r) => !r.fired).length}
              </span>
            )}
          </button>

          <button
            className={`dash-nav-item ${activeTab === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            <Rocket size={18} />
            <span>Pintasan Aplikasi</span>
          </button>

          <button
            className={`dash-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            <span>Pengaturan & AI</span>
          </button>
        </nav>

        {/* Model & Singing Status Footer */}
        <div className="dash-sidebar-footer">
          {(mediaState?.active || mediaState?.hasSession) && (
            <div className="nb-sidebar-music-card">
              <div className="nb-sidebar-music-top">
                <Music size={13} strokeWidth={2.6} />
                <span>{mediaState.source || 'Musik'}</span>
                <span className="nb-music-live-dot">
                  {!mediaState.active
                    ? 'JEDA'
                    : mediaState.lyricsStatus === 'ready'
                      ? 'LIRIK'
                      : 'LIVE'}
                </span>
              </div>
              <p className="nb-sidebar-music-title">{mediaState.cleanTitle || mediaState.title}</p>
              {mediaState.cleanArtist && (
                <p className="nb-sidebar-music-artist">{mediaState.cleanArtist}</p>
              )}
              <div className="nb-sidebar-media-controls">
                <button
                  type="button"
                  className="nb-media-ctrl-btn"
                  title="Lagu Sebelumnya (Previous)"
                  onClick={() => window.dannAPI.controlMedia('previous')}
                >
                  <SkipBack size={13} strokeWidth={2.6} />
                </button>
                <button
                  type="button"
                  className={`nb-media-ctrl-btn primary ${mediaState.active ? 'playing' : ''}`}
                  title={mediaState.active ? 'Jeda (Pause)' : 'Putar (Play)'}
                  onClick={() => window.dannAPI.controlMedia('toggle')}
                >
                  {mediaState.active ? (
                    <Pause size={13} strokeWidth={2.6} />
                  ) : (
                    <Play size={13} strokeWidth={2.6} />
                  )}
                  <span>{mediaState.active ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  type="button"
                  className="nb-media-ctrl-btn"
                  title="Lagu Selanjutnya (Next)"
                  onClick={() => window.dannAPI.controlMedia('next')}
                >
                  <SkipForward size={13} strokeWidth={2.6} />
                </button>
              </div>
            </div>
          )}

          <div className="model-status-box">
            <div className="model-status-row">
              <Cpu size={14} />
              <span>Mesin Suara</span>
              <span className={`status-pill ${modelStatus?.status || 'idle'}`}>
                {modelStatus?.status === 'ready'
                  ? 'Siap'
                  : modelStatus?.status === 'loading'
                    ? `${modelStatus.progress}%`
                    : modelStatus?.status === 'error'
                      ? 'Error'
                      : 'Siaga'}
              </span>
            </div>
            <p className="model-status-msg">
              {modelStatus?.message || 'Whisper Offline Lokal'}
            </p>
            {modelStatus?.status === 'loading' && (
              <div className="model-progress-track">
                <div
                  className="model-progress-fill"
                  style={{ width: `${modelStatus.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="dash-main">
        {/* TAB 1: HOME & COMMAND CENTER */}
        {activeTab === 'home' && (
          <div className="tab-container home-tab">
            <header className="tab-header">
              <div>
                <h2>Pusat Komando {settings.assistantName}</h2>
                <p>
                  Ucapkan <strong>"{settings.wakeWord}"</strong> diikuti perintah, tekan{' '}
                  <kbd>{settings.globalHotkey}</kbd>, klik Orb melayang di pojok layar, atau ketik
                  langsung di bawah.
                </p>
              </div>
              {history.length > 1 && (
                <button
                  className="btn-ghost"
                  onClick={() => window.dannAPI.clearHistory()}
                >
                  Bersihkan Riwayat
                </button>
              )}
            </header>

            <div className="quick-chips-bar">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  className="quick-chip"
                  onClick={() => handleSendTextCommand(q)}
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="chat-stream">
              {history.map((msg) => (
                <div key={msg.id} className={`chat-row role-${msg.role}`}>
                  <div className="chat-bubble">
                    <div className="chat-meta">
                      <span className="chat-author">
                        {msg.role === 'user' ? 'Kamu' : settings.assistantName}
                      </span>
                      {msg.actionBadge && (
                        <span className="chat-action-tag">{msg.actionBadge}</span>
                      )}
                      <span className="chat-time">
                        {new Date(msg.timestamp).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <p className="chat-text">{msg.text}</p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form
              className="chat-input-bar"
              onSubmit={(e) => {
                e.preventDefault()
                handleSendTextCommand()
              }}
            >
              <input
                type="text"
                placeholder={`Ketik perintah ke ${settings.assistantName} (misal: "Catat ide buat game RPG", "Buka YouTube")...`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={sendingChat}
              />
              <button type="submit" className="btn-primary" disabled={sendingChat}>
                <Send size={16} />
                <span>{sendingChat ? 'Memproses...' : 'Kirim'}</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: NOTES & TODOS */}
        {activeTab === 'notes' && (
          <div className="tab-container">
            <header className="tab-header">
              <div>
                <h2>Catatan & Daftar Tugas</h2>
                <p>
                  Suara: <em>"{settings.wakeWord} catat rapat jam 2 siang"</em> atau{' '}
                  <em>"{settings.wakeWord} tambah tugas beli makan"</em>
                </p>
              </div>
              <div className="segmented-tabs">
                <button
                  className={noteFilter === 'all' ? 'active' : ''}
                  onClick={() => setNoteFilter('all')}
                >
                  Semua
                </button>
                <button
                  className={noteFilter === 'note' ? 'active' : ''}
                  onClick={() => setNoteFilter('note')}
                >
                  Catatan
                </button>
                <button
                  className={noteFilter === 'todo' ? 'active' : ''}
                  onClick={() => setNoteFilter('todo')}
                >
                  Tugas
                </button>
              </div>
            </header>

            <form className="card-form" onSubmit={handleAddNoteSubmit}>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Judul catatan atau nama tugas..."
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                />
                <label className="checkbox-pill">
                  <input
                    type="checkbox"
                    checked={newNoteIsTodo}
                    onChange={(e) => setNewNoteIsTodo(e.target.checked)}
                  />
                  <span>Jadikan Tugas (To-Do)</span>
                </label>
                <button type="submit" className="btn-primary">
                  <Plus size={16} />
                  <span>Simpan</span>
                </button>
              </div>
              {!newNoteIsTodo && (
                <textarea
                  rows={2}
                  placeholder="Isi detail catatan (opsional)..."
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                />
              )}
            </form>

            <div className="cards-grid">
              {filteredNotes.map((item) => (
                <div
                  key={item.id}
                  className={`item-card ${item.pinned ? 'pinned' : ''} ${
                    item.completed ? 'completed' : ''
                  }`}
                >
                  <div className="item-card-top">
                    <div className="item-title-group">
                      {item.isTodo && (
                        <button
                          className="icon-btn"
                          onClick={() =>
                            window.dannAPI.updateNote(item.id, {
                              completed: !item.completed
                            })
                          }
                        >
                          {item.completed ? (
                            <CheckCircle2 size={18} className="text-emerald" />
                          ) : (
                            <Circle size={18} />
                          )}
                        </button>
                      )}
                      <h3>{item.title}</h3>
                    </div>
                    <div className="item-actions">
                      <button
                        className={`icon-btn ${item.pinned ? 'active-pin' : ''}`}
                        title="Sematkan"
                        onClick={() =>
                          window.dannAPI.updateNote(item.id, { pinned: !item.pinned })
                        }
                      >
                        <Pin size={15} />
                      </button>
                      <button
                        className="icon-btn danger"
                        title="Hapus"
                        onClick={() => window.dannAPI.deleteNote(item.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  {item.content && item.content !== item.title && (
                    <p className="item-card-body">{item.content}</p>
                  )}
                  <div className="item-card-foot">
                    <span className="tag-mini">
                      {item.isTodo ? 'Tugas' : 'Catatan'}
                    </span>
                    <span>
                      {new Date(item.createdAt).toLocaleString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: REMINDERS & TIMERS */}
        {activeTab === 'reminders' && (
          <div className="tab-container">
            <header className="tab-header">
              <div>
                <h2>Timer & Pengingat Suara</h2>
                <p>
                  Suara: <em>"{settings.wakeWord} pasang timer 10 menit angkat jemuran"</em>
                </p>
              </div>
            </header>

            <div className="quick-chips-bar">
              {[
                { label: 'Timer 1 Menit', sec: 60 },
                { label: 'Timer 5 Menit', sec: 300 },
                { label: 'Istirahat 10 Menit', sec: 600 },
                { label: 'Fokus Pomodoro 25m', sec: 1500 }
              ].map((p) => (
                <button
                  key={p.label}
                  className="quick-chip"
                  onClick={() => window.dannAPI.addReminder(p.label, p.sec)}
                >
                  <Clock size={13} />
                  <span>+ {p.label}</span>
                </button>
              ))}
            </div>

            <form className="card-form" onSubmit={handleAddReminderSubmit}>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Nama pengingat (misal: Matikan kompor)..."
                  value={remLabel}
                  onChange={(e) => setRemLabel(e.target.value)}
                />
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  style={{ maxWidth: '130px' }}
                  value={remMinutes}
                  onChange={(e) => setRemMinutes(e.target.value)}
                  placeholder="Menit"
                />
                <span className="unit-label">Menit</span>
                <button type="submit" className="btn-primary">
                  <Plus size={16} />
                  <span>Mulai Timer</span>
                </button>
              </div>
            </form>

            <div className="cards-grid">
              {reminders.length === 0 && (
                <p className="empty-hint">Belum ada timer aktif.</p>
              )}
              {reminders.map((r) => (
                <div key={r.id} className={`item-card ${r.fired ? 'completed' : ''}`}>
                  <div className="item-card-top">
                    <h3>{r.label}</h3>
                    <button
                      className="icon-btn danger"
                      onClick={() => window.dannAPI.deleteReminder(r.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="timer-big-readout">
                    {formatCountdown(r.triggerAt, r.fired)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: SHORTCUTS & LAUNCHER */}
        {activeTab === 'shortcuts' && (
          <div className="tab-container">
            <header className="tab-header">
              <div>
                <h2>Pintasan Aplikasi, Game & Website</h2>
                <p>
                  Ucapkan <em>"{settings.wakeWord} buka [nama pintasan]"</em> untuk membuka secara
                  instan!
                </p>
              </div>
            </header>

            <form className="card-form" onSubmit={handleAddShortcutSubmit}>
              <h4 className="form-subtitle">Tambah Aplikasi / Game / Web Sendiri</h4>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Nama (misal: Discord / Valorant)"
                  value={scName}
                  onChange={(e) => setScName(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Kata pemicu (misal: discord, dc)"
                  value={scTriggers}
                  onChange={(e) => setScTriggers(e.target.value)}
                />
                <select
                  value={scKind}
                  onChange={(e) => setScKind(e.target.value as 'app' | 'url')}
                >
                  <option value="app">Aplikasi / File (.exe)</option>
                  <option value="url">Website (URL)</option>
                </select>
              </div>
              <div className="form-row">
                <input
                  type="text"
                  placeholder={
                    scKind === 'url'
                      ? 'https://discord.com/app'
                      : 'C:\\Path\\Ke\\Aplikasi.exe'
                  }
                  value={scTarget}
                  onChange={(e) => setScTarget(e.target.value)}
                />
                <button type="submit" className="btn-primary">
                  <Plus size={16} />
                  <span>Tambah Pintasan</span>
                </button>
              </div>
            </form>

            <div className="cards-grid shortcuts-grid">
              {shortcuts.map((sc) => (
                <div key={sc.id} className="item-card shortcut-card">
                  <div className="item-card-top">
                    <div className="item-title-group">
                      {sc.kind === 'url' ? (
                        <ExternalLink size={16} className="text-cyan" />
                      ) : (
                        <FolderOpen size={16} className="text-indigo" />
                      )}
                      <h3>{sc.name}</h3>
                    </div>
                    <div className="item-actions">
                      <button
                        className="btn-mini-launch"
                        onClick={() => window.dannAPI.triggerShortcut(sc.id)}
                      >
                        Buka
                      </button>
                      {!sc.builtIn && (
                        <button
                          className="icon-btn danger"
                          onClick={() => window.dannAPI.deleteShortcut(sc.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="shortcut-triggers">
                    Suara: "Buka {sc.triggers.slice(0, 3).join(' / ')}"
                  </p>
                  <span className="shortcut-target">{sc.target}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="tab-container">
            <header className="tab-header">
              <div>
                <h2>Pengaturan Asisten & AI Hybrid</h2>
                <p>Atur kata panggil "Woii Dann", mesin suara lokal/cloud, dan API Key AI.</p>
              </div>
              {settingsSavedMsg && <span className="saved-pill">{settingsSavedMsg}</span>}
            </header>

            <div className="settings-sections">
              {/* Character Pose Preview Card */}
              <section className="settings-card">
                <h3>🎭 Pose Karakter Asisten ({settings.assistantName})</h3>
                <p className="settings-desc">
                  Karakter di pojok layar otomatis berganti pose mengikuti aktivitas suara Anda:
                </p>
                <div className="pose-showcase-grid">
                  <div className="pose-showcase-item">
                    <img src={CHARACTER_POSES.idle.src} alt="Pose Siaga" />
                    <strong>1. Siaga / Santai</strong>
                    <span>Menunggu panggilan "{settings.wakeWord}"</span>
                  </div>
                  <div className="pose-showcase-item">
                    <img src={CHARACTER_POSES.listen.src} alt="Pose Mendengarkan" />
                    <strong>2. Mendengarkan</strong>
                    <span>Pakai headphone saat menerima perintah</span>
                  </div>
                  <div className="pose-showcase-item">
                    <img src={CHARACTER_POSES.idea.src} alt="Pose Ide" />
                    <strong>3. Berpikir & Menjawab</strong>
                    <span>Lampu ide saat memproses & bicara</span>
                  </div>
                  <div className="pose-showcase-item">
                    <img src={CHARACTER_POSES.alert.src} alt="Pose Semangat" />
                    <strong>4. Semangat & Alarm</strong>
                    <span>Saat timer berbunyi atau diminta semangat!</span>
                  </div>
                </div>
              </section>

              {/* Wake Word & Voice Section */}
              <section className="settings-card">
                <h3>🎙️ Panggilan Suara (Wake Word) & Mikrofon</h3>
                <div className="settings-grid">
                  <label>
                    <span>Nama Asisten</span>
                    <input
                      type="text"
                      value={settings.assistantName}
                      onChange={(e) => patchSettings({ assistantName: e.target.value })}
                    />
                  </label>

                  <label>
                    <span>Kata Panggil Utama (Wake Word)</span>
                    <input
                      type="text"
                      value={settings.wakeWord}
                      onChange={(e) => patchSettings({ wakeWord: e.target.value })}
                    />
                  </label>

                  <label>
                    <span>Shortcut Panggil Cepat Global</span>
                    <input
                      type="text"
                      value={settings.globalHotkey}
                      onChange={(e) => patchSettings({ globalHotkey: e.target.value })}
                      placeholder="Alt+Space"
                    />
                  </label>

                  <label>
                    <span>
                      Sensitivitas Mikrofon (Ambang Suara: {settings.micSensitivity.toFixed(3)})
                    </span>
                    <input
                      type="range"
                      min="0.006"
                      max="0.055"
                      step="0.002"
                      value={settings.micSensitivity}
                      onChange={(e) =>
                        patchSettings({ micSensitivity: parseFloat(e.target.value) })
                      }
                    />
                    <small>
                      Geser ke kiri agar lebih peka suara pelan, atau ke kanan jika ruangan berisik.
                    </small>
                  </label>
                </div>

                <div className="toggle-row-group">
                  <label className="checkbox-pill">
                    <input
                      type="checkbox"
                      checked={settings.alwaysListen}
                      onChange={(e) => patchSettings({ alwaysListen: e.target.checked })}
                    />
                    <span>Selalu Dengarkan Panggilan "{settings.wakeWord}"</span>
                  </label>

                  <label className="checkbox-pill">
                    <input
                      type="checkbox"
                      checked={settings.ttsEnabled}
                      onChange={(e) => patchSettings({ ttsEnabled: e.target.checked })}
                    />
                    <Volume2 size={15} />
                    <span>Aktifkan Suara Bahasa Indonesia (TTS)</span>
                  </label>

                  <label className="checkbox-pill">
                    <input
                      type="checkbox"
                      checked={settings.orbAlwaysOnTop}
                      onChange={(e) => patchSettings({ orbAlwaysOnTop: e.target.checked })}
                    />
                    <span>Karakter Selalu di Atas Jendela Lain</span>
                  </label>

                  <label className="checkbox-pill">
                    <input
                      type="checkbox"
                      checked={settings.singAlongLyrics !== false}
                      onChange={(e) => patchSettings({ singAlongLyrics: e.target.checked })}
                    />
                    <Music size={15} />
                    <span>Ikut Bernyanyi (Lirik Spotify, YouTube Music & YouTube)</span>
                  </label>

                  <label className="checkbox-pill">
                    <input
                      type="checkbox"
                      checked={settings.autoHideMascot !== false}
                      onChange={(e) => patchSettings({ autoHideMascot: e.target.checked })}
                    />
                    <span>
                      Muncul Saat Dipanggil "{settings.wakeWord}" & Pergi Jika Tanpa Respon
                    </span>
                  </label>
                </div>

                {settings.autoHideMascot !== false && (
                  <div className="settings-grid" style={{ marginTop: '8px' }}>
                    <label>
                      <span>Waktu Tunggu Sebelum Karakter Pergi Otomatis</span>
                      <select
                        value={String(settings.autoHideMinutes ?? 2)}
                        onChange={(e) =>
                          patchSettings({ autoHideMinutes: Number(e.target.value) })
                        }
                      >
                        <option value="1">1 Menit tanpa respon</option>
                        <option value="2">2 Menit tanpa respon (Bawaan)</option>
                        <option value="3">3 Menit tanpa respon</option>
                        <option value="5">5 Menit tanpa respon</option>
                      </select>
                    </label>
                  </div>
                )}

                <div className="settings-grid" style={{ marginTop: '6px' }}>
                  <label>
                    <span>Pilih Suara Bahasa Indonesia</span>
                    <select
                      value={settings.ttsVoice || 'id-ID-ArdiNeural'}
                      onChange={(e) =>
                        patchSettings({
                          ttsVoice: e.target.value as AssistantSettings['ttsVoice']
                        })
                      }
                    >
                      <option value="id-ID-ArdiNeural">
                        Pria Indonesia — Ardi Neural (Natural & Jelas)
                      </option>
                      <option value="id-ID-GadisNeural">
                        Wanita Indonesia — Gadis Neural (Natural & Ramah)
                      </option>
                      <option value="google-id">
                        Bahasa Indonesia Cepat (Google ID • Instan)
                      </option>
                    </select>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() =>
                        speakText(
                          `Halo! Saya ${settings.assistantName}, siap membantu kamu dalam Bahasa Indonesia.`,
                          settings.ttsRate
                        )
                      }
                    >
                      <Volume2 size={16} />
                      <span>Tes Suara Bahasa Indonesia</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Speech-to-Text Engine */}
              <section className="settings-card">
                <h3>🎧 Mesin Pendengar Suara Bahasa Indonesia (whisper.cpp Offline)</h3>
                <div className="settings-grid">
                  <label>
                    <span>Pilih Model Pengenalan Suara</span>
                    <select
                      value={
                        settings.sttEngine.startsWith('local-whisper')
                          ? 'whisper-cpp-small'
                          : settings.sttEngine
                      }
                      onChange={(e) => {
                        const val = e.target.value as AssistantSettings['sttEngine']
                        patchSettings({ sttEngine: val }).then(() => {
                          if (val !== 'groq-whisper' && val !== 'openai-whisper') {
                            window.dannAPI.preloadWhisper()
                          }
                        })
                      }}
                    >
                      <option value="whisper-cpp-small">
                        whisper.cpp Small Q5 Bahasa Indonesia (Direkomendasikan • C++ 100% Offline)
                      </option>
                      <option value="whisper-cpp-base">
                        whisper.cpp Base Q8 Ringan (~78MB • Super Cepat & 100% Offline)
                      </option>
                      <option value="whisper-cpp-turbo">
                        whisper.cpp Large-v3-Turbo Q5 (~547MB • Akurasi Maksimal 100% Offline)
                      </option>
                      <option value="groq-whisper">
                        Groq Cloud Whisper Large-v3-Turbo (Cloud • Butuh Groq Key)
                      </option>
                      <option value="openai-whisper">
                        OpenAI Whisper-1 Cloud (Cloud • Butuh OpenAI Key)
                      </option>
                    </select>
                  </label>
                </div>
              </section>

              {/* Hybrid AI Brain */}
              <section className="settings-card">
                <h3>🧠 Otak AI Hybrid (Opsional — Tetap Jalan Tanpa API Key!)</h3>
                <p className="settings-desc">
                  Secara bawaan, Dann sudah bisa membuka aplikasi, mencatat, mengatur timer, dan
                  mencari di Google/YouTube secara lokal tanpa API Key. Isi salah satu API Key di
                  bawah jika ingin ngobrol bebas dengan AI!
                </p>
                <div className="settings-grid">
                  <label>
                    <span>Mode Pemrosesan Otak</span>
                    <select
                      value={settings.aiProvider}
                      onChange={(e) =>
                        patchSettings({
                          aiProvider: e.target.value as AssistantSettings['aiProvider']
                        })
                      }
                    >
                      <option value="hybrid-gemini">
                        Hybrid: Lokal + Google Gemini 2.5 Flash
                      </option>
                      <option value="hybrid-groq">
                        Hybrid: Lokal + Groq Llama 3.3 70B
                      </option>
                      <option value="hybrid-openai">
                        Hybrid: Lokal + OpenAI GPT-4o Mini
                      </option>
                      <option value="local-only">Lokal Saja (100% Tanpa Cloud AI)</option>
                    </select>
                  </label>

                  <label>
                    <span>Google Gemini API Key</span>
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      value={settings.geminiApiKey}
                      onChange={(e) => patchSettings({ geminiApiKey: e.target.value })}
                    />
                  </label>

                  <label>
                    <span>Groq API Key (Bisa untuk AI Chat + Whisper Turbo!)</span>
                    <input
                      type="password"
                      placeholder="gsk_..."
                      value={settings.groqApiKey}
                      onChange={(e) => patchSettings({ groqApiKey: e.target.value })}
                    />
                  </label>

                  <label>
                    <span>OpenAI API Key</span>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={settings.openaiApiKey}
                      onChange={(e) => patchSettings({ openaiApiKey: e.target.value })}
                    />
                  </label>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

