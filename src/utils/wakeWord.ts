export interface WakeMatchResult {
  matched: boolean
  remainderCommand: string
}

const PHONETIC_DANN_VARIANTS = [
  'woii dann',
  'woi dann',
  'woi dan',
  'woii dan',
  'woy dan',
  'woy dann',
  'oi dan',
  'oi dann',
  'wei dan',
  'we dan',
  'wah dan',
  'woi den',
  'woi don',
  'woi dam',
  'woi ndan',
  'woi bang',
  'woidan',
  'widan',
  'wedan',
  'uedan',
  'edan',
  'boi dan',
  'boy dan',
  'hai dan',
  'halo dan',
  'hallo dan',
  'oke dan',
  'ok dan',
  'hey dan',
  'hei dan',
  'hoy dan',
  'eh dan',
  'bang dan',
  'mas dan',
  'kak dan',
  'bro dan',
  'panggil dan',
  'siap dan'
]

function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[,!?.:;'"()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[m][n]
}

/**
 * Matches Indonesian wake word ("Woii Dann" and phonetic / fuzzy variants)
 * and extracts any trailing command spoken in the same breath.
 */
export function matchWakeWord(
  transcript: string,
  primaryWakeWord: string,
  customAliases: string[] = []
): WakeMatchResult {
  const norm = normalizePhrase(transcript)
  if (!norm) return { matched: false, remainderCommand: '' }

  const primaryNorm = normalizePhrase(primaryWakeWord)
  const candidatesSet = new Set<string>([
    primaryNorm,
    primaryNorm.replace(/(.)\1+/g, '$1'),
    ...customAliases.map(normalizePhrase)
  ])

  if (primaryNorm.includes('dan')) {
    for (const v of PHONETIC_DANN_VARIANTS) {
      candidatesSet.add(v)
    }
  }

  const candidates = Array.from(candidatesSet)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  // 1. Direct & filler-prefixed match
  for (const wake of candidates) {
    const escaped = wake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rx = new RegExp(`^(?:eh\\s+|emm\\s+|um\\s+|ya\\s+|oh\\s+)?${escaped}(?:\\b|\\s|$)(.*)$`, 'i')
    const m = norm.match(rx)
    if (m) {
      return {
        matched: true,
        remainderCommand: (m[1] || '').trim()
      }
    }
  }

  // 2. Standalone "Dann" or "Dan + Indonesian command verb" (in case "Woii" got clipped)
  if (primaryNorm.includes('dan')) {
    if (/^(?:dann|dan|nden|ndan)$/.test(norm)) {
      return { matched: true, remainderCommand: '' }
    }
    const directVerbMatch = norm.match(
      /^(?:dann|dan)\s+((?:tolong|coba|pergi|minggir|cabut|ngumpet|sembunyi|turun|hus|hush|syuh|pulang|dadah|bye|pause|paus|jeda|stop|play|plei|resume|lanjut|lanjutkan|next|neks|skip|previous|preverius|previus|privius|prev|ganti|balik|ulang|buka|bukakan|bukar|bukam|bukas|bukak|bukai|bukain|catat|catet|catatkan|buat|tambah|cari|carikan|putar|puter|setel|stel|pasang|atur|tur|ingatkan|ingetin|matikan|matiin|nyalakan|nyalain|lagu|musik|jam|pukul|tanggal|hari|cek|lihat|liat|info|hitung|berapa|salin|kasih|semangat)\b.*)$/i
    )
    if (directVerbMatch) {
      return { matched: true, remainderCommand: directVerbMatch[1].trim() }
    }
  }

  // 3. Fuzzy Levenshtein check on first 1-2 words against primary wake word & "woi dan" / "halo dan"
  // Guard common Indonesian words before "dan" ("aku dan", "dia dan", "kau dan", "itu dan", "ini dan")
  const NON_WAKE_FIRST_WORDS = new Set([
    'aku',
    'dia',
    'kau',
    'itu',
    'ini',
    'apa',
    'ada',
    'ibu',
    'kita',
    'kami',
    'saya',
    'kamu'
  ])

  const words = norm.split(' ')
  const targets = [primaryNorm, 'woi dan', 'halo dan', 'oi dan', 'hei dan', 'oke dan']
  if (words.length >= 1 && !NON_WAKE_FIRST_WORDS.has(words[0])) {
    const firstOne = words[0]
    const firstTwo = words.slice(0, 2).join(' ')

    for (const target of targets) {
      const maxDist = target.length >= 8 ? 2 : 1
      if (firstTwo.length >= 5 && levenshtein(firstTwo, target) <= maxDist) {
        return {
          matched: true,
          remainderCommand: words.slice(2).join(' ').trim()
        }
      }
      const compactTarget = target.replace(/\s+/g, '')
      if (firstOne.length >= 5 && levenshtein(firstOne, compactTarget) <= 1) {
        return {
          matched: true,
          remainderCommand: words.slice(1).join(' ').trim()
        }
      }
    }
  }

  // 4. Mid-sentence Wake-Word Scan (Crucial when music/song lyrics are playing in background!)
  // Matches multi-word wake phrases ("woi dan", "halo dan", "oi dan", etc.) even if preceded by song words!
  for (const wake of candidates) {
    if (!wake.includes(' ') && wake.length < 6) continue // Never match bare "dan" mid-sentence!
    const escaped = wake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const midRx = new RegExp(`(?:^|\\s)${escaped}(?:\\b|\\s|$)(.*)$`, 'i')
    const m = norm.match(midRx)
    if (m) {
      return {
        matched: true,
        remainderCommand: (m[1] || '').trim()
      }
    }
  }

  // Sliding 2-word fuzzy wake check across words[1..n] for speaking over loud music
  if (words.length >= 3) {
    for (let i = 1; i <= words.length - 2; i++) {
      if (NON_WAKE_FIRST_WORDS.has(words[i])) continue
      const pair = `${words[i]} ${words[i + 1]}`
      if (pair.length < 5) continue
      for (const target of targets) {
        if (levenshtein(pair, target) <= 1) {
          return {
            matched: true,
            remainderCommand: words.slice(i + 2).join(' ').trim()
          }
        }
      }
    }
  }

  return { matched: false, remainderCommand: '' }
}
