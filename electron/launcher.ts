import { shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ShortcutItem } from '../src/types/assistant'

const PHONETIC_SHORTCUT_ALIASES: Record<string, string[]> = {
  'builtin-youtube': [
    'youtube',
    'yt',
    'video',
    'yutub',
    'yutup',
    'yutuk',
    'utub',
    'utuk',
    'yu tub',
    'you tube'
  ],
  'builtin-ytmusic': [
    'youtube music',
    'yt music',
    'youtube musik',
    'yutub musik',
    'yutup musik',
    'musik youtube'
  ],
  'builtin-spotify': [
    'spotify',
    'sopotify',
    'sportyfy',
    'sportify',
    'spotifai',
    'spotifi',
    'sepotifai',
    '45',
    'empat lima',
    'musik',
    'mosek',
    'musiknya',
    'lagu',
    'lagunya',
    'music'
  ],
  'builtin-notepad': [
    'notepad',
    'notped',
    'note pad',
    'not pet',
    'tengad',
    'buku catatan windows',
    'teks editor'
  ],
  'builtin-calc': ['kalkulator', 'kakulator', 'kalkulater', 'calculator', 'hitung'],
  'builtin-explorer': [
    'file explorer',
    'explorer',
    'eksplorer',
    'eksplor',
    'folder',
    'berkas'
  ],
  'builtin-cmd': ['terminal', 'cmd', 'command prompt', 'powershell'],
  'builtin-settings': ['pengaturan windows', 'windows settings', 'setelan windows'],
  'builtin-vscode': ['vscode', 'vs code', 'visual studio code', 'kode editor'],
  'builtin-google': [
    'google chrome',
    'browser',
    'brosur',
    'google',
    'gugel',
    'gogel',
    'chrome',
    'krom',
    'krum',
    'internet'
  ],
  'builtin-whatsapp': ['whatsapp', 'whatsap', 'wasap', 'wa', 'wa web'],
  'builtin-github': ['github', 'git hub', 'githab', 'git hap']
}

function normalizeIndoPhonetic(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/ph/g, 'f')
    .replace(/v/g, 'f')
    .replace(/ch/g, 'k')
    .replace(/sh/g, 's')
    .replace(/oo/g, 'u')
    .replace(/ou/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/y/g, 'i')
    .replace(/c(?=[aoukrlt])/g, 'k')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export function isSpotifyDesktopInstalled(): boolean {
  const appDataExe = path.join(process.env.APPDATA || '', 'Spotify', 'Spotify.exe')
  const storeExe = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WindowsApps',
    'Spotify.exe'
  )
  return fs.existsSync(appDataExe) || fs.existsSync(storeExe)
}

export async function executeShortcut(
  shortcut: ShortcutItem
): Promise<{ ok: boolean; message: string }> {
  try {
    if (
      shortcut.id === 'builtin-spotify' &&
      shortcut.target === 'https://open.spotify.com' &&
      isSpotifyDesktopInstalled()
    ) {
      await shell.openExternal('spotify:')
      return { ok: true, message: 'Membuka Spotify Desktop' }
    }

    if (shortcut.kind === 'url') {
      await shell.openExternal(shortcut.target)
      return { ok: true, message: `Membuka ${shortcut.name}` }
    }

    if (shortcut.kind === 'system') {
      const child = spawn('cmd.exe', ['/c', 'start', '', shortcut.target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
      return { ok: true, message: `Menjalankan ${shortcut.name}` }
    }

    if (shortcut.target.startsWith('http://') || shortcut.target.startsWith('https://')) {
      await shell.openExternal(shortcut.target)
      return { ok: true, message: `Membuka ${shortcut.name}` }
    }

    const err = await shell.openPath(shortcut.target)
    if (err) {
      const child = spawn('cmd.exe', ['/c', 'start', '', shortcut.target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
    }
    return { ok: true, message: `Membuka ${shortcut.name}` }
  } catch (error) {
    console.error('[Launcher] Error launching shortcut:', error)
    return { ok: false, message: `Gagal membuka ${shortcut.name}` }
  }
}

export async function openUrlOrSearch(
  queryOrUrl: string,
  mode: 'url' | 'google' | 'youtube'
): Promise<void> {
  if (mode === 'url') {
    const normalized =
      queryOrUrl.startsWith('http://') || queryOrUrl.startsWith('https://')
        ? queryOrUrl
        : `https://${queryOrUrl}`
    await shell.openExternal(normalized)
    return
  }

  if (mode === 'youtube') {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(queryOrUrl)}`
    await shell.openExternal(url)
    return
  }

  const url = `https://www.google.com/search?q=${encodeURIComponent(queryOrUrl)}`
  await shell.openExternal(url)
}

/**
 * Mencari videoId teratas langsung dari halaman pencarian YouTube lalu membuka
 * URL `/watch?v=<videoId>` sehingga video/musik langsung terbuka dan otomatis diputar.
 */
export async function playYouTubeDirect(
  query: string,
  useMusic = false
): Promise<{ ok: boolean; direct: boolean; videoId?: string; title?: string }> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    await shell.openExternal(useMusic ? 'https://music.youtube.com' : 'https://www.youtube.com')
    return { ok: true, direct: false }
  }

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8'
      },
      signal: AbortSignal.timeout(3500)
    })

    if (res.ok) {
      const html = await res.text()
      const videoMatch = html.match(
        /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"(?:.*?"title":\{"runs":\[\{"text":"([^"]+)"\})?/
      )
      const fallbackMatch = !videoMatch ? html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) : null
      const videoId = videoMatch?.[1] || fallbackMatch?.[1]
      const title = videoMatch?.[2]

      if (videoId) {
        const watchUrl = useMusic
          ? `https://music.youtube.com/watch?v=${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`
        await shell.openExternal(watchUrl)
        return { ok: true, direct: true, videoId, title }
      }
    }
  } catch (err) {
    console.warn('[Launcher] Direct YouTube lookup fallback to search:', err)
  }

  const fallbackUrl = useMusic
    ? `https://music.youtube.com/search?q=${encodeURIComponent(cleanQuery)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`
  await shell.openExternal(fallbackUrl)
  return { ok: true, direct: false }
}

/**
 * Membuka Spotify (Desktop App jika terpasang via protokol `spotify:search:`, atau Spotify Web)
 * dan menekan tombol Play pada hasil lagu teratas secara otomatis via Windows UI Automation.
 */
export async function playSpotifyDirect(
  query: string
): Promise<{ ok: boolean; mode: 'desktop' | 'web' }> {
  const cleanQuery = query.trim()
  const hasDesktop = isSpotifyDesktopInstalled()

  if (!cleanQuery) {
    await shell.openExternal(hasDesktop ? 'spotify:' : 'https://open.spotify.com')
    return { ok: true, mode: hasDesktop ? 'desktop' : 'web' }
  }

  if (hasDesktop) {
    await shell.openExternal(`spotify:search:${encodeURIComponent(cleanQuery)}`)

    // Klik tombol Play pada lagu hasil pencarian teratas di jendela Spotify Desktop via UI Automation
    const psAutoPlay = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$btnCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)

for ($attempt = 0; $attempt -lt 14; $attempt++) {
  Start-Sleep -Milliseconds 450
  $procs = Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  if (-not $procs) { continue }

  foreach ($p in $procs) {
    $spWin = $root.FindFirst(
      [System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        [int]$p.Id
      ))
    )
    if (-not $spWin) { continue }

    $buttons = $spWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
    for ($i = 0; $i -lt $buttons.Count; $i++) {
      $b = $buttons.Item($i)
      $bName = $b.Current.Name
      # Tombol Play pada kartu lagu/Top Result memiliki nama "Play <Judul>" atau "Putar <Judul>"
      if ($bName -and ($bName -match '^(Play|Putar)\\s+.+')) {
        $inv = $null
        if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$inv)) {
          $inv.Invoke()
          exit 0
        }
      }
    }
  }
}
`
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psAutoPlay], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
    } catch {
      // Ignore if PowerShell helper fails; Spotify search page is already open
    }

    return { ok: true, mode: 'desktop' }
  }

  await shell.openExternal(`https://open.spotify.com/search/${encodeURIComponent(cleanQuery)}`)
  return { ok: true, mode: 'web' }
}

export function findMatchingShortcut(
  text: string,
  shortcuts: ShortcutItem[]
): ShortcutItem | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(dong|ya|sekarang|tolong|aplikasi|app|dulu|aja|saja)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null
  const cleanedWords = cleaned.split(' ').filter(Boolean)
  const cleanedPhonetic = normalizeIndoPhonetic(cleaned)

  let bestExact: { item: ShortcutItem; len: number } | null = null
  let bestFuzzy: { item: ShortcutItem; score: number } | null = null

  for (const s of shortcuts) {
    const extra = PHONETIC_SHORTCUT_ALIASES[s.id] || []
    const candidates = [s.name.toLowerCase(), ...s.triggers.map((t) => t.toLowerCase()), ...extra]

    for (const trig of candidates) {
      const cleanTrig = trig.trim()
      if (!cleanTrig) continue
      const trigWords = cleanTrig.split(' ').filter(Boolean)

      // Jangan telan judul lagu/video panjang jika pengguna menyebut "YouTube <judul>" atau "Spotify <lagu>"
      if (cleanedWords.length > trigWords.length + 1) continue

      // 1. Direct exact / word-boundary substring match
      if (
        cleaned === cleanTrig ||
        (cleanedWords.length === trigWords.length && cleaned.includes(cleanTrig))
      ) {
        if (!bestExact || cleanTrig.length > bestExact.len) {
          bestExact = { item: s, len: cleanTrig.length }
        }
      }

      // 2. Phonetic & Fuzzy Levenshtein similarity (catches "sportyfy", "mosek", "notped", "yutub", etc.)
      if (cleanTrig.length >= 4) {
        const rawSim = similarity(cleaned.replace(/\s+/g, ''), cleanTrig.replace(/\s+/g, ''))
        const phonSim = similarity(
          cleanedPhonetic.replace(/\s+/g, ''),
          normalizeIndoPhonetic(cleanTrig).replace(/\s+/g, '')
        )
        const bestSim = Math.max(rawSim, phonSim)
        if (bestSim >= 0.75 && (!bestFuzzy || bestSim > bestFuzzy.score)) {
          bestFuzzy = { item: s, score: bestSim }
        }
      }
    }
  }

  if (bestExact) return bestExact.item
  if (bestFuzzy) return bestFuzzy.item
  return null
}
