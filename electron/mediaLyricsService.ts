import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import type {
  LyricLine,
  MediaControlAction,
  MediaPlaybackState,
  MediaSourceKind
} from '../src/types/assistant'

interface RawSmtcPayload {
  active: boolean
  hasSession?: boolean
  app?: string
  winHint?: string
  status?: string
  title?: string
  artist?: string
  album?: string
  posMs?: number
  endMs?: number
  updatedMs?: number
}

interface LrcLibItem {
  id?: number
  name?: string
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

interface ResolvedLyrics {
  status: 'ready' | 'not-found'
  isSynced: boolean
  lyrics: LyricLine[]
  matchedTitle?: string
  matchedArtist?: string
}

const LRCLIB_HEADERS = {
  'User-Agent': 'DannDesktopAssistant/2.0 (Windows Desktop Mascot)'
}

const VERSION_TAG_REGEX =
  /\b(version|versi|remaster|remastered|acoustic|akustik|live|demo|edit|mix|remix| sped up|slowed|reverb|ost|soundtrack|mono|stereo|folk|piano|stripped|deluxe|bonus|\d{4})\b/i

const YT_NOISE_BRACKETS =
  /[\(\[\{][^\)\]\}]*\b(official|music video|lyric|lyrics|lirik|audio|video|mv|visualizer|live|performance|hd|4k|hq|karaoke|sub indo|terjemahan|ost|color coded|topic)\b[^\)\]\}]*[\)\]\}]/gi

const YT_NOISE_TRAILING =
  /\s*(?:\||\/\/)\s*.*$|\s*[-–—]\s*(?:official\s+(?:music\s+)?video|official\s+lyric\s+video|official\s+audio|lyric\s+video|music\s+video|lirik(?:\s+lagu)?|mv|visualizer)\s*$/gi

function normalizeCompare(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlapScore(a: string, b: string): number {
  const ta = normalizeCompare(a).split(' ').filter((w) => w.length >= 2)
  const tb = normalizeCompare(b).split(' ').filter((w) => w.length >= 2)
  if (!ta.length || !tb.length) return 0
  const setB = new Set(tb)
  let hits = 0
  for (const w of ta) {
    if (setB.has(w)) hits++
    else {
      for (const bw of tb) {
        if (bw.length >= 4 && w.length >= 4 && (bw.includes(w) || w.includes(bw))) {
          hits += 0.8
          break
        }
      }
    }
  }
  return hits / Math.min(ta.length, tb.length)
}

export function cleanArtistName(rawArtist: string): string {
  if (!rawArtist) return ''
  return rawArtist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s+Official(?:\s+Channel|\s+Music)?$/i, '')
    .replace(/\s+Music$/i, '')
    .trim()
}

export function extractSongCandidates(
  rawTitle: string,
  rawArtist: string,
  source: MediaSourceKind
): {
  cleanTitle: string
  cleanArtist: string
  queries: Array<{ artist: string; track: string }>
} {
  const cleanedArtist = cleanArtistName(rawArtist)

  // Remove YouTube prefixes like "[MV]" or "MV |" and noise tags like "(Official Music Video)"
  let cleanedTitle = rawTitle
    .replace(/^\s*[\[\(]\s*(?:mv|official|lirik|lyrics|audio)\s*[\]\)]\s*/i, '')
    .replace(YT_NOISE_BRACKETS, '')
    .replace(YT_NOISE_TRAILING, '')
    .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+[^-\(\[\|]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleanedTitle) cleanedTitle = rawTitle.trim()

  const queries: Array<{ artist: string; track: string }> = []
  const pushUnique = (artist: string, track: string) => {
    const a = artist.trim()
    const t = track.trim()
    if (!t) return
    const key = `${a.toLowerCase()}::${t.toLowerCase()}`
    if (!queries.some((q) => `${q.artist.toLowerCase()}::${q.track.toLowerCase()}` === key)) {
      queries.push({ artist: a, track: t })
    }
  }

  let displayTitle = cleanedTitle
  let displayArtist = cleanedArtist || rawArtist.trim()

  // Check if title has "Artist - Track" or "Track - Version"
  const dashMatch = cleanedTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dashMatch) {
    const left = dashMatch[1].trim()
    const right = dashMatch[2].trim()
    const rightIsVersion = VERSION_TAG_REGEX.test(right)

    if (source === 'Spotify' || source === 'YouTube Music') {
      // On Spotify / YT Music, rawArtist is already accurate; dash is usually "- folk Version" or "- Remastered"
      pushUnique(cleanedArtist || rawArtist, rawTitle.trim())
      if (rightIsVersion) {
        displayTitle = left
        pushUnique(cleanedArtist || rawArtist, left)
      } else {
        pushUnique(cleanedArtist || rawArtist, cleanedTitle)
        pushUnique(cleanedArtist || rawArtist, left)
      }
    } else {
      // On YouTube, "Artist - Track" is the #1 most common format!
      if (rightIsVersion) {
        displayTitle = left
        pushUnique(cleanedArtist || rawArtist, cleanedTitle)
        pushUnique(cleanedArtist || rawArtist, left)
      } else {
        displayArtist = left
        displayTitle = right
        // Strip any remaining version suffix on right (e.g. "Artist - Track (Acoustic)")
        const baseRight = right.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, '').trim()
        pushUnique(left, right)
        if (baseRight && baseRight !== right) pushUnique(left, baseRight)
        if (cleanedArtist) pushUnique(cleanedArtist, right)
        // Also try reversed ("Track - Artist")
        pushUnique(right, left)
      }
    }
  } else {
    const strippedParens = cleanedTitle.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, '').trim()
    if (cleanedArtist || rawArtist) {
      pushUnique(cleanedArtist || rawArtist, cleanedTitle)
      if (strippedParens && strippedParens !== cleanedTitle) {
        pushUnique(cleanedArtist || rawArtist, strippedParens)
      }
    }
    pushUnique('', strippedParens || cleanedTitle)
  }

  return {
    cleanTitle: displayTitle || rawTitle.trim(),
    cleanArtist: displayArtist || rawArtist.trim(),
    queries
  }
}

export function parseLrcLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  const rawLines = lrc.split(/\r?\n/)
  const timeTagRegex = /\[(\d{1,3}):(\d{2})(?:[\.:](\d{1,3}))?\]/g

  for (const raw of rawLines) {
    const matches = [...raw.matchAll(timeTagRegex)]
    if (matches.length === 0) continue

    const text = raw
      .replace(timeTagRegex, '')
      .replace(/^[\s♪♫♬]+|[\s♪♫♬]+$/g, '')
      .trim()

    // Skip LRC credit/metadata lines
    if (
      /^(?:lirik\s+oleh|lyrics?\s+by|synced\s+by|transcribed\s+by|composer|arranger|www\.|http)/i.test(
        text
      )
    ) {
      continue
    }

    for (const m of matches) {
      const mins = parseInt(m[1], 10)
      const secs = parseInt(m[2], 10)
      let ms = 0
      if (m[3]) {
        const frac = m[3]
        if (frac.length === 1) ms = parseInt(frac, 10) * 100
        else if (frac.length === 2) ms = parseInt(frac, 10) * 10
        else ms = parseInt(frac.slice(0, 3), 10)
      }
      const timeMs = mins * 60_000 + secs * 1000 + ms
      lines.push({
        timeMs,
        text: text || '...'
      })
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs)
  return lines
}

function buildEstimatedLyrics(plainLyrics: string, durationMs: number): LyricLine[] {
  const cleanLines = plainLyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l))

  if (cleanLines.length === 0) return []

  const totalMs = durationMs > 30_000 ? durationMs : 210_000
  const startMs = Math.min(12_000, Math.round(totalMs * 0.06))
  const endMs = Math.max(startMs + 20_000, Math.round(totalMs * 0.91))
  const stepMs = (endMs - startMs) / Math.max(1, cleanLines.length)

  return cleanLines.map((text, idx) => ({
    timeMs: Math.round(startMs + idx * stepMs),
    text
  }))
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 6500): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: LRCLIB_HEADERS,
      signal: ctrl.signal
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export class MediaLyricsService {
  private psProc: ChildProcess | null = null
  private stopped = false
  private restartTimer: NodeJS.Timeout | null = null
  private cmdFilePath = path.join(os.tmpdir(), `dann-smtc-cmd-${process.pid}.txt`)
  private listeners: Array<(state: MediaPlaybackState) => void> = []
  private lyricsCache = new Map<string, ResolvedLyrics>()
  private activeFetchId = 0

  private lastTrackKey = ''
  private localFallbackPosMs = 0
  private localFallbackWallMs = 0
  private lastBroadcastAt = 0

  private state: MediaPlaybackState = {
    active: false,
    isPlaying: false,
    hasSession: false,
    source: '',
    title: '',
    artist: '',
    cleanTitle: '',
    cleanArtist: '',
    positionMs: 0,
    durationMs: 0,
    updatedAt: Date.now(),
    lyricsStatus: 'idle',
    isSynced: false,
    lyrics: []
  }

  public onStateChange(cb: (state: MediaPlaybackState) => void): void {
    this.listeners.push(cb)
  }

  public getState(): MediaPlaybackState {
    if (!this.state.active) return this.state
    const elapsed = Math.max(0, Date.now() - this.state.updatedAt)
    const livePos =
      this.state.durationMs > 0
        ? Math.min(this.state.durationMs, this.state.positionMs + elapsed)
        : this.state.positionMs + elapsed
    return {
      ...this.state,
      positionMs: livePos,
      updatedAt: Date.now()
    }
  }

  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastBroadcastAt < 2400) {
      return
    }
    this.lastBroadcastAt = now
    const snapshot = this.getState()
    for (const cb of this.listeners) {
      cb(snapshot)
    }
  }

  public start(): void {
    if (process.platform !== 'win32') return
    this.stopped = false
    this.spawnWatcher()
  }

  public stop(): void {
    this.stopped = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.psProc) {
      try {
        this.psProc.kill()
      } catch {
        // ignore
      }
      this.psProc = null
    }
    try {
      if (fs.existsSync(this.cmdFilePath)) fs.unlinkSync(this.cmdFilePath)
    } catch {}
  }

  public async control(action: MediaControlAction): Promise<{ ok: boolean; action: MediaControlAction }> {
    if (process.platform !== 'win32') {
      return { ok: false, action }
    }

    // Optimistic UI feedback so Play/Pause button toggles instantaneously
    const now = Date.now()
    if (action === 'pause' && this.state.active) {
      this.state = {
        ...this.state,
        active: false,
        isPlaying: false,
        hasSession: true,
        positionMs: this.getState().positionMs,
        updatedAt: now
      }
      this.emit(true)
    } else if (action === 'play' && this.state.hasSession && !this.state.active) {
      this.state = {
        ...this.state,
        active: true,
        isPlaying: true,
        updatedAt: now
      }
      this.localFallbackPosMs = this.state.positionMs
      this.localFallbackWallMs = now
      this.emit(true)
    } else if (action === 'toggle' && this.state.hasSession) {
      const nextPlaying = !this.state.active
      this.state = {
        ...this.state,
        active: nextPlaying,
        isPlaying: nextPlaying,
        positionMs: this.getState().positionMs,
        updatedAt: now
      }
      this.localFallbackPosMs = this.state.positionMs
      this.localFallbackWallMs = now
      this.emit(true)
    }

    try {
      fs.writeFileSync(this.cmdFilePath, action, 'utf8')
      return { ok: true, action }
    } catch {
      return { ok: false, action }
    }
  }

  private buildPowerShellScript(): string {
    const escapedCmdPath = this.cmdFilePath.replace(/'/g, "''")
    return `
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$cmdFile = '${escapedCmdPath}'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DannMediaKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
  }
}
"@

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]

function Await-WinRT($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  if (-not $netTask.Wait(1500)) { return $null }
  return $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

$mgr = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if ($null -eq $mgr) { exit 1 }

function Find-BestSession($manager) {
  $sessions = $manager.GetSessions()
  $best = $null
  $bestScore = -1
  foreach ($s in $sessions) {
    $appId = [string]$s.SourceAppUserModelId
    if (-not $appId) { continue }
    $isSpotify = $appId -match '(?i)spotify'
    $isYtMusicPwa = $appId -match '(?i)(cinhimbnkk[a-z]*lkffjgod|youtube\s*music|ytmusic|pear-desktop|th-ch)'
    $isYtPwa = $appId -match '(?i)(agimnkijca[a-z]*ooml)'
    $isBrowser = $appId -match '(?i)(chrome|msedge|brave|firefox|opera|vivaldi|arc|zen|waterfox)'
    if (-not ($isSpotify -or $isYtMusicPwa -or $isYtPwa -or $isBrowser)) { continue }

    $info = $s.GetPlaybackInfo()
    if ($null -eq $info) { continue }
    $st = $info.PlaybackStatus.ToString()
    if ($st -ne 'Playing' -and $st -ne 'Paused') { continue }

    $prio = 1
    if ($isSpotify -or $isYtMusicPwa) { $prio = 3 }
    elseif ($isYtPwa) { $prio = 2 }
    if ($st -eq 'Playing') { $prio += 10 }

    if ($prio -gt $bestScore) {
      $best = $s
      $bestScore = $prio
    }
  }
  return $best
}

function Invoke-MediaAction($manager, [string]$act) {
  $target = Find-BestSession $manager
  $handled = $false
  if ($null -ne $target) {
    switch ($act) {
      'pause'    { $handled = [bool](Await-WinRT ($target.TryPauseAsync()) ([bool])) }
      'play'     { $handled = [bool](Await-WinRT ($target.TryPlayAsync()) ([bool])) }
      'toggle'   { $handled = [bool](Await-WinRT ($target.TryTogglePlayPauseAsync()) ([bool])) }
      'next'     { $handled = [bool](Await-WinRT ($target.TrySkipNextAsync()) ([bool])) }
      'previous' { $handled = [bool](Await-WinRT ($target.TrySkipPreviousAsync()) ([bool])) }
    }
  }
  if (-not $handled) {
    switch ($act) {
      'pause'    { [DannMediaKeys]::Tap(0xB3) }
      'play'     { [DannMediaKeys]::Tap(0xB3) }
      'toggle'   { [DannMediaKeys]::Tap(0xB3) }
      'next'     { [DannMediaKeys]::Tap(0xB0) }
      'previous' { [DannMediaKeys]::Tap(0xB1) }
    }
  }
}

$tick = 0
$winHint = ''

while ($true) {
  try {
    $forcePoll = $false
    if ([System.IO.File]::Exists($cmdFile)) {
      $act = ([System.IO.File]::ReadAllText($cmdFile)).Trim().ToLowerInvariant()
      [System.IO.File]::Delete($cmdFile)
      if ($act) {
        Invoke-MediaAction $mgr $act
        Start-Sleep -Milliseconds 120
        $forcePoll = $true
      }
    }

    if ($forcePoll -or (($tick % 4) -eq 0)) {
      if (($tick % 12) -eq 0) {
        $titles = Get-Process chrome,msedge,brave,firefox,opera,vivaldi -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowTitle } |
          Select-Object -ExpandProperty MainWindowTitle
        $joined = ($titles -join ' | ')
        if ($joined -match 'YouTube Music') { $winHint = 'YouTube Music' }
        elseif ($joined -match 'Spotify') { $winHint = 'Spotify' }
        elseif ($joined -match 'YouTube') { $winHint = 'YouTube' }
        else { $winHint = '' }
      }

      $chosen = Find-BestSession $mgr
      if ($null -eq $chosen) {
        Write-Output 'SMTC:{"active":false,"hasSession":false}'
      } else {
        $info = $chosen.GetPlaybackInfo()
        $st = if ($info) { $info.PlaybackStatus.ToString() } else { 'Paused' }
        $isPlaying = ($st -eq 'Playing')
        $tl = $chosen.GetTimelineProperties()
        $props = Await-WinRT ($chosen.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ($null -eq $props -or [string]::IsNullOrWhiteSpace($props.Title)) {
          Write-Output 'SMTC:{"active":false,"hasSession":false}'
        } else {
          $out = @{
            active = $isPlaying
            hasSession = $true
            app = [string]$chosen.SourceAppUserModelId
            winHint = $winHint
            status = $st
            title = [string]$props.Title
            artist = [string]$props.Artist
            album = [string]$props.AlbumTitle
            posMs = if ($tl) { [math]::Round($tl.Position.TotalMilliseconds) } else { 0 }
            endMs = if ($tl) { [math]::Round($tl.EndTime.TotalMilliseconds) } else { 0 }
            updatedMs = if ($tl) { $tl.LastUpdatedTime.ToUnixTimeMilliseconds() } else { 0 }
          }
          Write-Output ('SMTC:' + ($out | ConvertTo-Json -Compress))
        }
      }
    }
    $tick++
  } catch {
    Write-Output 'SMTC:{"active":false,"hasSession":false}'
  }
  Start-Sleep -Milliseconds 180
}
`
  }

  private spawnWatcher(): void {
    if (this.stopped) return
    const script = this.buildPowerShellScript()
    const encoded = Buffer.from(script, 'utf16le').toString('base64')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    )
    this.psProc = child

    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('SMTC:')) return
        try {
          const payload = JSON.parse(trimmed.slice(5)) as RawSmtcPayload
          this.handleSmtcTick(payload)
        } catch {
          // ignore malformed line
        }
      })
    }

    child.on('exit', () => {
      this.psProc = null
      if (!this.stopped) {
        this.restartTimer = setTimeout(() => this.spawnWatcher(), 3000)
      }
    })
  }

  private detectSource(appId: string, winHint: string): MediaSourceKind {
    if (/spotify/i.test(appId)) return 'Spotify'
    if (/(cinhimbnkk[a-z]*lkffjgod|youtube\s*music|ytmusic|pear-desktop|th-ch)/i.test(appId)) {
      return 'YouTube Music'
    }
    if (/agimnkijca[a-z]*ooml/i.test(appId)) return 'YouTube'
    if (winHint === 'YouTube Music') return 'YouTube Music'
    if (winHint === 'Spotify') return 'Spotify'
    return 'YouTube'
  }

  private handleSmtcTick(raw: RawSmtcPayload): void {
    const now = Date.now()

    if (!raw.hasSession || !raw.title?.trim()) {
      if (this.state.active || this.state.hasSession) {
        this.state = {
          ...this.state,
          active: false,
          isPlaying: false,
          hasSession: false,
          updatedAt: now
        }
        this.emit(true)
      }
      return
    }

    const source = this.detectSource(raw.app || '', raw.winHint || '')
    const title = raw.title.trim()
    const artist = (raw.artist || '').trim()
    const isPlaying = Boolean(raw.active && raw.status === 'Playing')
    const durationMs = Math.max(0, raw.endMs || 0)
    const rawPosMs = Math.max(0, raw.posMs || 0)
    const rawUpdatedMs = raw.updatedMs || 0
    const trackKey = `${source}::${title.toLowerCase()}::${artist.toLowerCase()}`

    // When paused, preserve static position without advancing wall clock
    if (!isPlaying) {
      const changedPlayState = this.state.active || !this.state.hasSession || trackKey !== this.lastTrackKey
      const { cleanTitle, cleanArtist } = extractSongCandidates(title, artist, source)
      this.state = {
        ...this.state,
        active: false,
        isPlaying: false,
        hasSession: true,
        source,
        title,
        artist,
        cleanTitle: this.state.cleanTitle && trackKey === this.lastTrackKey ? this.state.cleanTitle : cleanTitle,
        cleanArtist: this.state.cleanArtist && trackKey === this.lastTrackKey ? this.state.cleanArtist : cleanArtist,
        positionMs: rawPosMs > 0 ? rawPosMs : this.state.positionMs,
        durationMs,
        updatedAt: now
      }
      if (changedPlayState) {
        this.emit(true)
      }
      return
    }

    // Compute accurate sub-second live position
    let livePosMs = 0
    const hasValidUpdatedClock =
      rawUpdatedMs > 1_600_000_000_000 &&
      now - rawUpdatedMs >= -4000 &&
      now - rawUpdatedMs <= Math.max(durationMs + 60_000, 900_000)

    if (hasValidUpdatedClock) {
      livePosMs = rawPosMs + Math.max(0, now - rawUpdatedMs)
      this.localFallbackPosMs = livePosMs
      this.localFallbackWallMs = now
    } else if (trackKey !== this.lastTrackKey) {
      livePosMs = rawPosMs
      this.localFallbackPosMs = rawPosMs
      this.localFallbackWallMs = now
    } else {
      livePosMs = this.localFallbackPosMs + Math.max(0, now - this.localFallbackWallMs)
    }

    if (durationMs > 0) {
      livePosMs = Math.min(durationMs, livePosMs)
    }

    const isNewTrack = trackKey !== this.lastTrackKey
    const wasInactive = !this.state.active

    // Detect if user scrubbed/seeked more than 1.4s away from expected timeline
    const expectedPosMs = this.state.positionMs + Math.max(0, now - this.state.updatedAt)
    const didSeek = !isNewTrack && !wasInactive && Math.abs(livePosMs - expectedPosMs) > 1400

    this.state.active = true
    this.state.isPlaying = true
    this.state.hasSession = true
    this.state.source = source
    this.state.title = title
    this.state.artist = artist
    this.state.positionMs = livePosMs
    this.state.durationMs = durationMs
    this.state.updatedAt = now

    if (isNewTrack) {
      this.lastTrackKey = trackKey
      const { cleanTitle, cleanArtist, queries } = extractSongCandidates(title, artist, source)
      this.state.cleanTitle = cleanTitle
      this.state.cleanArtist = cleanArtist

      const cached = this.lyricsCache.get(trackKey)
      if (cached) {
        this.state.lyricsStatus = cached.status
        this.state.isSynced = cached.isSynced
        this.state.lyrics = cached.lyrics
        if (cached.matchedTitle) this.state.cleanTitle = cached.matchedTitle
        if (cached.matchedArtist) this.state.cleanArtist = cached.matchedArtist
        this.emit(true)
        return
      }

      this.state.lyricsStatus = 'loading'
      this.state.isSynced = false
      this.state.lyrics = []
      this.emit(true)

      const fetchId = ++this.activeFetchId
      this.resolveLyrics(trackKey, title, artist, source, durationMs, queries).then((resolved) => {
        this.lyricsCache.set(trackKey, resolved)
        if (this.lyricsCache.size > 120) {
          const oldest = this.lyricsCache.keys().next().value
          if (oldest) this.lyricsCache.delete(oldest)
        }
        if (this.activeFetchId !== fetchId || this.lastTrackKey !== trackKey) return
        this.state.lyricsStatus = resolved.status
        this.state.isSynced = resolved.isSynced
        this.state.lyrics = resolved.lyrics
        if (resolved.matchedTitle) this.state.cleanTitle = resolved.matchedTitle
        if (resolved.matchedArtist) this.state.cleanArtist = resolved.matchedArtist
        this.emit(true)
      })
      return
    }

    if (wasInactive || didSeek) {
      this.emit(true)
    } else {
      this.emit(false)
    }
  }

  public async resolveLyrics(
    _trackKey: string,
    rawTitle: string,
    rawArtist: string,
    source: MediaSourceKind,
    durationMs: number,
    queries: Array<{ artist: string; track: string }>
  ): Promise<ResolvedLyrics> {
    const durationSec = durationMs > 0 ? Math.round(durationMs / 1000) : 0

    // Skip non-music long videos (> 16 minutes) unless explicitly labeled lyric/lirik
    if (durationSec > 960 && !/\b(lyric|lyrics|lirik)\b/i.test(rawTitle)) {
      return { status: 'not-found', isSynced: false, lyrics: [] }
    }

    let plainFallback: { lines: LyricLine[]; title?: string; artist?: string } | null = null

    // 1. Fast exact lookup on LRCLIB (/api/get)
    for (const q of queries) {
      if (!q.artist || !q.track) continue
      const params = new URLSearchParams({
        artist_name: q.artist,
        track_name: q.track
      })
      const item = await fetchJsonWithTimeout<LrcLibItem>(
        `https://lrclib.net/api/get?${params.toString()}`
      )
      if (!item || item.instrumental) continue

      const itemDur = item.duration || 0
      const durOk =
        durationSec <= 25 || itemDur <= 25 || Math.abs(itemDur - durationSec) <= 65

      if (item.syncedLyrics && durOk) {
        const parsed = parseLrcLyrics(item.syncedLyrics)
        if (parsed.length >= 2) {
          return {
            status: 'ready',
            isSynced: true,
            lyrics: parsed,
            matchedTitle: item.trackName || q.track,
            matchedArtist: item.artistName || q.artist
          }
        }
      }

      if (!plainFallback && item.plainLyrics && durOk) {
        const est = buildEstimatedLyrics(item.plainLyrics, durationMs)
        if (est.length >= 2) {
          plainFallback = {
            lines: est,
            title: item.trackName || q.track,
            artist: item.artistName || q.artist
          }
        }
      }
    }

    // 2. Structured LRCLIB search (/api/search?track_name=...&artist_name=...)
    const searchCandidates = [...queries]
    for (const q of queries) {
      const coreWords = normalizeCompare(q.track).split(' ').filter(Boolean)
      if (q.artist && coreWords.length >= 2) {
        const shortTrack = coreWords.slice(0, 2).join(' ')
        if (shortTrack.toLowerCase() !== q.track.toLowerCase()) {
          searchCandidates.push({ artist: q.artist, track: shortTrack })
        }
      }
    }

    for (const q of searchCandidates) {
      if (!q.track) continue
      const params = new URLSearchParams({ track_name: q.track })
      if (q.artist) params.set('artist_name', q.artist)

      const items = await fetchJsonWithTimeout<LrcLibItem[]>(
        `https://lrclib.net/api/search?${params.toString()}`
      )
      if (!Array.isArray(items) || items.length === 0) continue

      let bestSynced: { item: LrcLibItem; score: number } | null = null

      for (const item of items) {
        if (item.instrumental) continue
        const itemDur = item.duration || 0
        // Filter out broken 4-second entries in LRCLIB
        if (itemDur > 0 && itemDur < 25) continue

        const trackSim = tokenOverlapScore(q.track, item.trackName || item.name || '')
        const artistSim = q.artist
          ? tokenOverlapScore(q.artist, item.artistName || '')
          : tokenOverlapScore(rawTitle + ' ' + rawArtist, item.artistName || '')

        if (trackSim < 0.45) continue
        if (source === 'YouTube' && artistSim < 0.35 && trackSim < 0.85) continue

        if (durationSec > 30 && itemDur > 30) {
          const diff = Math.abs(itemDur - durationSec)
          if (diff > 65) continue
        }

        let score = trackSim * 45 + artistSim * 35
        if (durationSec > 30 && itemDur > 30) {
          const diff = Math.abs(itemDur - durationSec)
          if (diff <= 4) score += 35
          else if (diff <= 12) score += 22
          else if (diff <= 25) score += 10
        }

        if (item.syncedLyrics) {
          score += 100
          if (!bestSynced || score > bestSynced.score) {
            bestSynced = { item, score }
          }
        } else if (!plainFallback && item.plainLyrics && score >= 55) {
          const est = buildEstimatedLyrics(item.plainLyrics, durationMs)
          if (est.length >= 2) {
            plainFallback = {
              lines: est,
              title: item.trackName || q.track,
              artist: item.artistName || q.artist
            }
          }
        }
      }

      if (bestSynced?.item.syncedLyrics) {
        const parsed = parseLrcLyrics(bestSynced.item.syncedLyrics)
        if (parsed.length >= 2) {
          return {
            status: 'ready',
            isSynced: true,
            lyrics: parsed,
            matchedTitle: bestSynced.item.trackName || q.track,
            matchedArtist: bestSynced.item.artistName || q.artist
          }
        }
      }
    }

    if (plainFallback) {
      return {
        status: 'ready',
        isSynced: false,
        lyrics: plainFallback.lines,
        matchedTitle: plainFallback.title,
        matchedArtist: plainFallback.artist
      }
    }

    return { status: 'not-found', isSynced: false, lyrics: [] }
  }
}
