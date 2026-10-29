import type { ShortcutItem } from '../src/types/assistant'

export interface NormalizedSentenceResult {
  original: string
  normalized: string
  changed: boolean
  confidence: number
  rule?: string
}

/**
 * Extracts the consonant skeleton of a word ("timer" -> "tmr", "temar" -> "tmr",
 * "taimer" -> "tmr", "catatan" -> "cttn", "pengingat" -> "pgnt") so vowel shifts
 * in unclear speech still align with high structural precision.
 */
export function consonantSkeleton(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/ng/g, 'g')
    .replace(/ny/g, 'n')
    .replace(/sy|sh|z/g, 's')
    .replace(/kh|ch|q/g, 'k')
    .replace(/ph|v/g, 'f')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1')
}

/**
 * Converts an Indonesian / English-loanword string into a compact acoustic/phonetic key
 * so words that sound alike on a microphone ("spotify"/"sportyfy"/"spotifai",
 * "catat"/"catet", "timer"/"taimer"/"temer", "youtube"/"yutub"/"utuk") produce matching keys.
 */
export function phoneticKey(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/ph/g, 'f')
    .replace(/v/g, 'f')
    .replace(/sy|sh|z/g, 's')
    .replace(/kh|ch|q/g, 'k')
    .replace(/ny/g, 'n')
    .replace(/ng/g, 'g')
    .replace(/ai|ay/g, 'e')
    .replace(/au|aw/g, 'o')
    .replace(/oo|ou/g, 'u')
    .replace(/ee|ie/g, 'i')
    .replace(/y/g, 'i')
    .replace(/c(?=[aoukrlt])/g, 'k')
    .replace(/b\b/g, 'p')
    .replace(/d\b/g, 't')
    .replace(/g\b/g, 'k')
    .replace(/h\b/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
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

export function strSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export function phoneticSimilarity(a: string, b: string): number {
  const cleanA = a.toLowerCase().trim()
  const cleanB = b.toLowerCase().trim()
  const rawSim = strSimilarity(cleanA, cleanB)
  const pa = phoneticKey(cleanA)
  const pb = phoneticKey(cleanB)
  const phonSim = strSimilarity(pa, pb)

  let score = Math.max(rawSim, phonSim * 0.97 + rawSim * 0.03)

  // Consonant-skeleton alignment boost for vowel-mumbled words ("temar" <-> "timer")
  const skA = consonantSkeleton(cleanA)
  const skB = consonantSkeleton(cleanB)
  if (skA.length >= 3 && skA === skB && Math.abs(cleanA.length - cleanB.length) <= 2) {
    score = Math.max(score, 0.72 + rawSim * 0.25)
  }

  return Math.min(1, score)
}

// Canonical whole-sentence commands & questions (Bahasa Indonesia Baku)
interface CanonicalSentenceEntry {
  canonical: string
  variants: string[]
}

const CANONICAL_SENTENCES: CanonicalSentenceEntry[] = [
  {
    canonical: 'Jam berapa sekarang?',
    variants: [
      'jam berapa',
      'jam berapa sekarang',
      'sekarang jam berapa',
      'pukul berapa sekarang',
      'pukul berapa',
      'waktu sekarang',
      'jam brapa skarang'
    ]
  },
  {
    canonical: 'Hari ini tanggal berapa?',
    variants: [
      'tanggal berapa',
      'tanggal berapa sekarang',
      'hari ini tanggal berapa',
      'sekarang tanggal berapa'
    ]
  },
  {
    canonical: 'Hari ini hari apa?',
    variants: ['hari apa sekarang', 'hari ini hari apa', 'sekarang hari apa']
  },
  {
    canonical: 'Jeda musik',
    variants: [
      'pause',
      'paus',
      'pos',
      'pause lagu',
      'pause musik',
      'jeda',
      'jeda lagu',
      'jeda musik',
      'hentikan lagu',
      'hentikan musik',
      'stop lagu',
      'stop musik',
      'matikan musik',
      'matikan lagu',
      'berhenti musik'
    ]
  },
  {
    canonical: 'Lanjutkan musik',
    variants: [
      'play',
      'plei',
      'play lagu',
      'play musik',
      'resume',
      'unpause',
      'lanjutkan',
      'lanjutkan lagu',
      'lanjutkan musik',
      'lanjut lagu',
      'lanjut musik',
      'putar lagi',
      'mainkan lagi',
      'nyalakan lagi'
    ]
  },
  {
    canonical: 'Lagu selanjutnya',
    variants: [
      'next',
      'neks',
      'nek',
      'next lagu',
      'next musik',
      'skip',
      'skip lagu',
      'ganti lagu',
      'lewati lagu',
      'lagu selanjutnya',
      'lagu berikutnya',
      'musik selanjutnya',
      'musik berikutnya'
    ]
  },
  {
    canonical: 'Lagu sebelumnya',
    variants: [
      'previous',
      'preverius',
      'previus',
      'privius',
      'prev',
      'pref',
      'previous lagu',
      'lagu sebelumnya',
      'musik sebelumnya',
      'balik lagu',
      'mundur lagu',
      'ulang lagu',
      'kembali ke lagu sebelumnya'
    ]
  },
  {
    canonical: 'Lagu apa ini?',
    variants: [
      'lagu apa ini',
      'judul lagu ini',
      'judul lagu apa ini',
      'sedang putar lagu apa',
      'lagi putar lagu apa',
      'lagi dengerin apa',
      'lagi dengerin lagu apa',
      'musik apa ini',
      'lagu yang diputar'
    ]
  },
  {
    canonical: 'Matikan lirik',
    variants: [
      'matikan lirik',
      'matiin lirik',
      'matikan liriknya',
      'sembunyikan lirik',
      'tutup lirik',
      'nonaktifkan lirik',
      'matikan mode bernyanyi',
      'matiin mode bernyanyi',
      'matikan karaoke',
      'stop lirik'
    ]
  },
  {
    canonical: 'Nyalakan lirik',
    variants: [
      'nyalakan lirik',
      'nyalain lirik',
      'nyalakan liriknya',
      'aktifkan lirik',
      'tampilkan lirik',
      'munculkan lirik',
      'aktifkan mode bernyanyi',
      'nyalakan mode bernyanyi',
      'nyalain mode bernyanyi',
      'nyalakan karaoke'
    ]
  },
  {
    canonical: 'Baca catatan',
    variants: [
      'baca catatan',
      'baca catetan',
      'lihat catatan',
      'liat catatan',
      'cek catatan',
      'daftar catatan',
      'buka catatan',
      'catatan terakhir'
    ]
  },
  {
    canonical: 'Lihat daftar tugas',
    variants: [
      'daftar tugas',
      'lihat daftar tugas',
      'lihat tugas',
      'liat tugas',
      'cek tugas',
      'cek daftar tugas',
      'tugas hari ini',
      'buka tugas'
    ]
  },
  {
    canonical: 'Buka Dashboard',
    variants: [
      'buka dashboard',
      'buka dasbor',
      'tampilkan dashboard',
      'lihat dashboard',
      'buka panel utama',
      'buka menu utama',
      'buka beranda'
    ]
  },
  {
    canonical: 'Buka Pengaturan',
    variants: [
      'buka pengaturan',
      'buka pengaturannya',
      'lihat pengaturan',
      'tampilkan pengaturan',
      'buka setelan',
      'buka setting'
    ]
  },
  {
    canonical: 'Cek info sistem',
    variants: [
      'cek info sistem',
      'info sistem',
      'cek ram',
      'sisa ram',
      'sisa ram berapa',
      'spesifikasi laptop',
      'info komputer',
      'status sistem'
    ]
  },
  {
    canonical: 'Kasih semangat dong!',
    variants: [
      'kasih semangat',
      'kasih semangat dong',
      'beri semangat',
      'minta semangat',
      'motivasi dong',
      'ayo semangat',
      'gas terus'
    ]
  },
  {
    canonical: 'Siapa nama kamu?',
    variants: ['siapa kamu', 'kamu siapa', 'siapa namamu', 'siapa nama kamu']
  },
  {
    canonical: 'Halo!',
    variants: [
      'halo',
      'hai',
      'selamat pagi',
      'selamat siang',
      'selamat sore',
      'selamat malam',
      'apa kabar'
    ]
  },
  {
    canonical: 'Terima kasih',
    variants: [
      'terima kasih',
      'terimakasih',
      'makasih',
      'makasih ya',
      'terima kasih banyak',
      'oke makasih',
      'trims'
    ]
  },
  {
    canonical: 'Pergi dulu',
    variants: [
      'pergi',
      'pergi sana',
      'pergi dulu',
      'pergi aja',
      'pergilah',
      'sana pergi',
      'hus',
      'hush',
      'syuh',
      'hus sana',
      'hush sana',
      'minggir',
      'minggir dulu',
      'minggir sana',
      'geser dulu',
      'turun',
      'turun dulu',
      'turun sana',
      'turun ke bawah',
      'masuk dulu',
      'sembunyi',
      'sembunyi dulu',
      'sembunyi sana',
      'ngumpet',
      'ngumpet dulu',
      'ngumpet sana',
      'cabut',
      'cabut dulu',
      'cabut sana',
      'pulang',
      'pulang sana',
      'udah sana',
      'sudah sana',
      'sana dulu',
      'istirahat dulu',
      'istirahat sana',
      'tidur dulu',
      'tidur sana',
      'jangan ganggu',
      'hilang dulu',
      'sudah cukup',
      'udah cukup',
      'cukup dulu',
      'dadah',
      'bye'
    ]
  }
]

const OPEN_VERBS = new Set([
  'buka',
  'bukar',
  'bukam',
  'bukas',
  'bukak',
  'bukai',
  'bukain',
  'bukakan',
  'bukanya',
  'bukan',
  'muka',
  'puka',
  'jalankan',
  'jalanin',
  'nyalakan',
  'nyalain',
  'aktifkan',
  'hidupkan',
  'open',
  'launch'
])

const TIMER_VERBS = new Set([
  'pasang',
  'pasangkan',
  'pasangin',
  'atur',
  'atau', // common Whisper mishearing of "atur" before "timer"/"temar"
  'atu',
  'tur',
  'ator',
  'hatur',
  'buat',
  'buatin',
  'buatkan',
  'bikin',
  'setel',
  'stel',
  'set',
  'ingatkan',
  'ingetin',
  'ingetkan',
  'ngatkan',
  'kasih',
  'beri'
])

const TIMER_NOUNS = new Set([
  'timer',
  'taimer',
  'temer',
  'temar',
  'timar',
  'teimer',
  'timernya',
  'time',
  'pengingat',
  'penginget',
  'peringat',
  'alarm',
  'alaram',
  'alarem'
])

const SPOKEN_NUMBERS: Array<{ words: string[]; slurred?: string[]; value: number }> = [
  { words: ['setengah'], slurred: ['stengah', 'tengah'], value: 0.5 },
  { words: ['satu', 'suatu'], slurred: ['stu'], value: 1 },
  { words: ['dua', 'duanya'], value: 2 },
  { words: ['tiga', 'tiganya'], value: 3 },
  { words: ['empat', 'pat', 'empatnya'], slurred: ['mpat'], value: 4 },
  {
    words: ['lima', 'selima', 'selimanya', 'limanya', 'limo'],
    slurred: ['ima', 'imam', 'limam', 'lema'],
    value: 5
  },
  { words: ['enam', 'nam'], slurred: ['nem'], value: 6 },
  { words: ['tujuh', 'tuju'], value: 7 },
  { words: ['delapan', 'lapan'], slurred: ['dlapan'], value: 8 },
  { words: ['sembilan', 'smbilan'], slurred: ['mbilan'], value: 9 },
  { words: ['sepuluh', 'sepuluhnya', 'puluh'], slurred: ['spuluh', 'sepulu', 'spulu'], value: 10 },
  { words: ['sebelas'], slurred: ['sbelas'], value: 11 },
  { words: ['duabelas', 'dua belas'], value: 12 },
  { words: ['limabelas', 'lima belas'], slurred: ['imabelas', 'ima belas'], value: 15 },
  { words: ['duapuluh', 'dua puluh'], slurred: ['dua pulu', 'duapulu'], value: 20 },
  { words: ['duapuluh lima', 'dua puluh lima'], slurred: ['dua pulu lima'], value: 25 },
  { words: ['tigapuluh', 'tiga puluh'], slurred: ['tiga pulu', 'tigapulu'], value: 30 },
  { words: ['empatpuluh', 'empat puluh'], slurred: ['empat pulu'], value: 40 },
  { words: ['empatpuluh lima', 'empat puluh lima'], value: 45 },
  { words: ['limapuluh', 'lima puluh'], value: 50 },
  { words: ['enampuluh', 'enam puluh'], value: 60 }
]

const UNIT_PATTERNS: Array<{ unit: 'detik' | 'menit' | 'jam'; forms: string[] }> = [
  {
    unit: 'menit',
    forms: ['menit', 'mnit', 'menet', 'minit', 'men', 'meni', 'menel', 'nel', 'nit', 'mnet']
  },
  {
    unit: 'detik',
    forms: ['detik', 'dtik', 'detk', 'sekon', 'skon', 'tik']
  },
  {
    unit: 'jam',
    forms: ['jam', 'jem', 'jm']
  }
]

// Extra spoken aliases for built-in targets so Whisper mishearings snap cleanly
const TARGET_PHONETIC_BANK: Record<string, { displayName: string; phrases: string[] }> = {
  'builtin-youtube': {
    displayName: 'YouTube',
    phrases: ['youtube', 'yutub', 'yutup', 'yutuk', 'utub', 'utuk', 'yu tub', 'you tube', 'yt']
  },
  'builtin-ytmusic': {
    displayName: 'YouTube Music',
    phrases: [
      'youtube music',
      'yt music',
      'youtube musik',
      'yutub musik',
      'yutup musik',
      'utub musik',
      'musik youtube',
      'musik yutub'
    ]
  },
  'builtin-spotify': {
    displayName: 'Spotify',
    phrases: [
      'spotify',
      'sopotify',
      'sportyfy',
      'sportify',
      'spotifai',
      'spotifi',
      'sepotifai',
      'sport tv',
      'sportivi',
      '45',
      's 45',
      'empat lima',
      'musik',
      'mosek',
      'musiknya'
    ]
  },
  'builtin-notepad': {
    displayName: 'Notepad',
    phrases: ['notepad', 'notped', 'not pet', 'note pad', 'tengad', 'buku catatan windows']
  },
  'builtin-calc': {
    displayName: 'Kalkulator',
    phrases: ['kalkulator', 'kakulator', 'kalkulater', 'karkulator', 'calculator']
  },
  'builtin-explorer': {
    displayName: 'File Explorer',
    phrases: ['file explorer', 'explorer', 'eksplorer', 'eksplor', 'folder', 'berkas']
  },
  'builtin-cmd': {
    displayName: 'Terminal',
    phrases: ['terminal', 'cmd', 'command prompt', 'powershell']
  },
  'builtin-settings': {
    displayName: 'Pengaturan Windows',
    phrases: ['pengaturan windows', 'setelan windows', 'setting windows', 'windows settings']
  },
  'builtin-vscode': {
    displayName: 'Visual Studio Code',
    phrases: ['vscode', 'vs code', 'feskod', 'viscode', 'visual studio code', 'kode editor']
  },
  'builtin-google': {
    displayName: 'Google Chrome',
    phrases: ['chrome', 'krom', 'krum', 'kriptom', 'google', 'gugel', 'gogel', 'browser', 'brosur']
  },
  'builtin-whatsapp': {
    displayName: 'WhatsApp',
    phrases: ['whatsapp', 'whatsap', 'wasap', 'wa', 'wa web', 'we a']
  },
  'builtin-github': {
    displayName: 'GitHub',
    phrases: ['github', 'git hub', 'githab', 'git hap']
  }
}

/**
 * Kamus Kata Tidak Baku / Lisan / Singkatan / Salah Dengar -> Kata Baku Bahasa Indonesia (KBBI)
 */
const INFORMAL_TO_BAKU_MAP: Record<string, string> = {
  // Negasi & keterangan
  gak: 'tidak',
  ga: 'tidak',
  nggak: 'tidak',
  ngga: 'tidak',
  enggak: 'tidak',
  engga: 'tidak',
  kagak: 'tidak',
  ndak: 'tidak',
  udah: 'sudah',
  udh: 'sudah',
  belom: 'belum',
  blum: 'belum',
  blm: 'belum',
  jgn: 'jangan',
  gimana: 'bagaimana',
  gmn: 'bagaimana',
  bgaimana: 'bagaimana',
  bagemana: 'bagaimana',
  kenapa: 'mengapa',
  knp: 'mengapa',
  karna: 'karena',
  krn: 'karena',
  kerna: 'karena',
  kalo: 'kalau',
  klu: 'kalau',
  tapi: 'tetapi',
  tp: 'tetapi',
  cuma: 'hanya',
  cuman: 'hanya',
  kayaknya: 'sepertinya',
  kyknya: 'sepertinya',
  gitu: 'begitu',
  gini: 'begini',
  bgt: 'sekali',
  banget: 'sekali',

  // Waktu & penunjuk
  skarang: 'sekarang',
  sekarng: 'sekarang',
  skrg: 'sekarang',
  kemaren: 'kemarin',
  kmarin: 'kemarin',
  bsok: 'besok',
  malem: 'malam',
  mlm: 'malam',
  bentar: 'sebentar',
  sbentar: 'sebentar',
  ntar: 'nanti',
  entar: 'nanti',
  disini: 'di sini',
  disana: 'di sana',
  disitu: 'di situ',
  kesini: 'ke sini',
  kesana: 'ke sana',
  berapah: 'berapa',
  brapa: 'berapa',
  berape: 'berapa',
  apah: 'apa',
  senen: 'Senin',
  jumaat: 'Jumat',
  pebruari: 'Februari',
  nopember: 'November',

  // Kata kerja lisan -> kata kerja baku
  bukar: 'buka',
  bukam: 'buka',
  bukas: 'buka',
  bukak: 'buka',
  bukai: 'buka',
  bukain: 'bukakan',
  catet: 'catat',
  nyatet: 'catat',
  nyatat: 'catat',
  catetan: 'catatan',
  catetannya: 'catatannya',
  tambahin: 'tambahkan',
  tamba: 'tambah',
  tugaz: 'tugas',
  pasangin: 'pasangkan',
  ator: 'atur',
  hatur: 'atur',
  nyalain: 'nyalakan',
  nyalahin: 'nyalakan',
  idupin: 'hidupkan',
  matiin: 'matikan',
  matikkan: 'matikan',
  taimer: 'timer',
  temer: 'timer',
  temar: 'timer',
  penginget: 'pengingat',
  peringat: 'pengingat',
  mnit: 'menit',
  menet: 'menit',
  minit: 'menit',
  dtik: 'detik',
  sekon: 'detik',
  skon: 'detik',
  bikin: 'buat',
  bikinin: 'buatkan',
  buatin: 'buatkan',
  liat: 'lihat',
  liatin: 'perlihatkan',
  ngeliat: 'melihat',
  denger: 'dengar',
  ndenger: 'dengar',
  dengerin: 'dengarkan',
  pake: 'pakai',
  make: 'memakai',
  inget: 'ingat',
  ingetin: 'ingatkan',
  ingetkan: 'ingatkan',
  puter: 'putar',
  puterin: 'putar',
  stel: 'setel',
  setelin: 'setel',
  cariin: 'carikan',
  nyari: 'mencari',
  belik: 'beli',
  beliin: 'belikan',
  benerin: 'perbaiki',
  betulin: 'perbaiki',
  selesekan: 'selesaikan',
  slesaikan: 'selesaikan',
  selesain: 'selesaikan',
  beresin: 'selesaikan',
  hapusin: 'hapus',
  simpen: 'simpan',
  nyimpen: 'menyimpan',
  kirimin: 'kirimkan',
  bayarin: 'bayarkan',
  kerjain: 'kerjakan',
  bersihin: 'bersihkan',
  rapiin: 'rapikan',
  rapihin: 'rapikan',
  bangunin: 'bangunkan',
  jelasin: 'jelaskan',
  bantuin: 'bantu',
  itung: 'hitung',
  itungin: 'hitungkan',
  ngomong: 'berbicara',
  nanya: 'bertanya',

  // Ejaan KBBI baku (kata benda & serapan)
  ijin: 'izin',
  jadual: 'jadwal',
  jadwel: 'jadwal',
  aktifitas: 'aktivitas',
  kreatifitas: 'kreativitas',
  produktifitas: 'produktivitas',
  efektifitas: 'efektivitas',
  analisa: 'analisis',
  praktek: 'praktik',
  resiko: 'risiko',
  tehnik: 'teknik',
  sistim: 'sistem',
  kwalitas: 'kualitas',
  kwantitas: 'kuantitas',
  apotik: 'apotek',
  antri: 'antre',
  hutang: 'utang',
  nasehat: 'nasihat',
  sekedar: 'sekadar',
  silahkan: 'silakan',
  faham: 'paham',
  fikir: 'pikir',
  rapet: 'rapat',
  istirahet: 'istirahat',
  istrahat: 'istirahat',
  mosek: 'musik',
  kompiter: 'komputer',
  komputr: 'komputer',
  aplikasih: 'aplikasi',
  apk: 'aplikasi',
  setelan: 'pengaturan',
  makasih: 'terima kasih',
  terimakasih: 'terima kasih',
  trims: 'terima kasih',

  // Nama aplikasi & merek populer
  yutub: 'YouTube',
  yutup: 'YouTube',
  yutuk: 'YouTube',
  utub: 'YouTube',
  utuk: 'YouTube',
  sportyfy: 'Spotify',
  sportify: 'Spotify',
  spotifai: 'Spotify',
  spotifi: 'Spotify',
  sepotifai: 'Spotify',
  gugel: 'Google',
  gogel: 'Google',
  krom: 'Chrome',
  krum: 'Chrome',
  whatsap: 'WhatsApp',
  wasap: 'WhatsApp',
  kakulator: 'Kalkulator',
  kalkulater: 'Kalkulator',
  karkulator: 'Kalkulator',
  notped: 'Notepad',
  tengad: 'Notepad'
}

/**
 * Aturan prediksi pasangan kata (Bigram Context Prediction) untuk membedakan makna
 * dan memperbaiki kata kurang jelas berdasarkan kata di sebelahnya.
 */
const BIGRAM_BAKU_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(tidak|belum|sudah|ingin|mau|cari|kasih|beri)\s+tau\b/gi, replacement: '$1 tahu' },
  { pattern: /\b(?:kasih|beri)\s+tahu\b/gi, replacement: 'beri tahu' },
  { pattern: /\b(?:trima|terima)\s+(?:kasi|kasih|kaseh)\b/gi, replacement: 'terima kasih' },
  { pattern: /\b(?:jagan|jangan)\s+(?:lupak|lupa)\b/gi, replacement: 'jangan lupa' },
  { pattern: /\b(?:mata)\s+(?:kulyah|kulya|kuliah)\b/gi, replacement: 'mata kuliah' },
  { pattern: /\b(?:rumah)\s+(?:saket|sakit)\b/gi, replacement: 'rumah sakit' },
  { pattern: /\b(?:daftar)\s+(?:tugaz|tugas)\b/gi, replacement: 'daftar tugas' },
  { pattern: /\b(?:jam|pukul)\s+(?:brapa|berapah|berape|berapa)\b/gi, replacement: '$1 berapa' },
  { pattern: /\b(?:tanggal|hari)\s+(?:brapa|berapah|berape|berapa)\b/gi, replacement: '$1 berapa' },
  { pattern: /\b(?:selamat)\s+(pagi|siang|sore|malam)\b/gi, replacement: 'selamat $1' },
  { pattern: /\bdi\s+mana\b|\bdimana\b/gi, replacement: 'di mana' },
  { pattern: /\bke\s+mana\b|\bkemana\b/gi, replacement: 'ke mana' }
]

// Core everyday Indonesian vocabulary for safe phonetic + skeleton prediction of garbled words
const CORE_INDONESIAN_VOCAB = [
  'jadwal',
  'kuliah',
  'sekolah',
  'kantor',
  'kerja',
  'pekerjaan',
  'proyek',
  'desain',
  'halaman',
  'laporan',
  'dokumen',
  'berkas',
  'folder',
  'jendela',
  'layar',
  'suara',
  'mikrofon',
  'karakter',
  'asisten',
  'bantuan',
  'informasi',
  'cuaca',
  'berita',
  'harga',
  'makanan',
  'minuman',
  'sarapan',
  'makan',
  'siang',
  'malam',
  'pagi',
  'sore',
  'minggu',
  'senin',
  'selasa',
  'rabu',
  'kamis',
  'jumat',
  'sabtu',
  'tanggal',
  'bulan',
  'tahun',
  'tambah',
  'kurang',
  'dikali',
  'dibagi',
  'hasil',
  'hitung',
  'salin',
  'pesan',
  'kirim',
  'telepon',
  'belanja',
  'bayar',
  'tagihan',
  'listrik',
  'internet',
  'matikan',
  'nyalakan',
  'hidupkan',
  'aktifkan',
  'tampilkan',
  'sembunyikan',
  'bersihkan',
  'hapus',
  'simpan',
  'perbaiki',
  'belajar',
  'olahraga',
  'tidur',
  'bangun',
  'jemuran',
  'kompor',
  'presentasi',
  'ujian',
  'tugas',
  'catatan',
  'pengingat',
  'pengaturan',
  'komputer',
  'perangkat',
  'jaringan',
  'kesehatan',
  'keuangan',
  'tabungan',
  'keluarga',
  'perjalanan',
  'istirahat',
  'semangat',
  'motivasi'
]

// Known valid everyday Indonesian words that should NEVER be fuzzy-overwritten into a different word
const VALID_INDONESIAN_GUARD = new Set<string>([
  ...CORE_INDONESIAN_VOCAB,
  ...Object.values(INFORMAL_TO_BAKU_MAP).map((w) => w.toLowerCase()),
  'saya',
  'aku',
  'kamu',
  'anda',
  'kita',
  'kami',
  'mereka',
  'dia',
  'ini',
  'itu',
  'yang',
  'dan',
  'atau',
  'dari',
  'untuk',
  'pada',
  'dengan',
  'dalam',
  'ke',
  'di',
  'oleh',
  'karena',
  'jika',
  'kalau',
  'tetapi',
  'namun',
  'agar',
  'supaya',
  'seperti',
  'sudah',
  'belum',
  'sedang',
  'akan',
  'bisa',
  'dapat',
  'harus',
  'perlu',
  'ingin',
  'mau',
  'tidak',
  'bukan',
  'jangan',
  'hanya',
  'sangat',
  'sekali',
  'lebih',
  'paling',
  'semua',
  'banyak',
  'sedikit',
  'baru',
  'lama',
  'besar',
  'kecil',
  'cepat',
  'lambat',
  'baik',
  'benar',
  'salah',
  'jelas',
  'mudah',
  'sulit',
  'penting',
  'buku',
  'buka',
  'rumah',
  'jalan',
  'air',
  'kopi',
  'teh',
  'nasi',
  'roti',
  'susu',
  'buah',
  'sayur',
  'ayam',
  'ikan',
  'telur',
  'tahu',
  'tempe',
  'obat',
  'uang',
  'barang',
  'paket',
  'surat',
  'kunci',
  'meja',
  'kursi',
  'kamar',
  'pintu',
  'lampu',
  'lagu',
  'musik',
  'video',
  'film',
  'foto',
  'gambar',
  'warna',
  'suara',
  'waktu',
  'menit',
  'detik',
  'jam',
  'hari',
  'besok',
  'kemarin',
  'sekarang',
  'nanti',
  'tadi',
  'selalu',
  'sering',
  'kadang',
  'makin',
  'nama',
  'sama',
  'lima',
  'satu',
  'dua',
  'tiga',
  'empat',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
  'sepuluh',
  'ratus',
  'ribu',
  'juta'
])

/**
 * Strips self-corrections spoken mid-utterance:
 * - "Buka Notepad, eh maksudnya buka Kalkulator" -> "buka Kalkulator"
 * - "Bukanya utuk, bukan buka yang penah" -> "Bukanya utuk"
 */
function resolveSpokenSelfCorrection(raw: string): string {
  const meanMatch = raw.match(
    /^.+?\b(?:eh\s+maksudnya|maksud\s+saya|maksudnya|ralat|eh\s+ganti)\s+(.+)$/i
  )
  if (meanMatch?.[1]?.trim()) {
    return meanMatch[1].trim()
  }

  const notMatch = raw.match(/^(.+?)[,\s]+\b(?:bukan|bukannya|eh\s+bukan)\b\s+.+$/i)
  if (notMatch?.[1]?.trim() && notMatch[1].trim().length >= 3) {
    return notMatch[1].trim()
  }

  return raw
}

function matchShortcutDisplayName(
  phrase: string,
  shortcuts: ShortcutItem[]
): { name: string; score: number } | null {
  const cleaned = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(yang|dong|ya|sekarang|tolong|aplikasi|app|web|situs|itu|ini)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null

  let best: { name: string; score: number } | null = null

  for (const sc of shortcuts) {
    const bank = TARGET_PHONETIC_BANK[sc.id]
    const displayName = bank?.displayName || sc.name
    const candidates = new Set<string>([
      sc.name.toLowerCase(),
      ...sc.triggers.map((t) => t.toLowerCase()),
      ...(bank?.phrases || [])
    ])

    const gluedInput = cleaned.replace(/\s+/g, '')
    for (const cand of candidates) {
      if (!cand) continue
      if (cleaned === cand || (gluedInput.length >= 4 && gluedInput === cand.replace(/\s+/g, ''))) {
        return { name: displayName, score: 1 }
      }
      const simSpaced = phoneticSimilarity(cleaned, cand)
      const simGlued =
        gluedInput.length >= 4 ? phoneticSimilarity(gluedInput, cand.replace(/\s+/g, '')) : 0
      const sim = Math.max(simSpaced, simGlued)
      const threshold = cand.length <= 3 ? 0.88 : 0.72
      if (sim >= threshold && (!best || sim > best.score)) {
        best = { name: displayName, score: sim }
      }
    }
  }

  return best
}

function tryReconstructOpenCommand(
  clause: string,
  shortcuts: ShortcutItem[]
): NormalizedSentenceResult | null {
  const clean = clause
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/^(?:tolong|coba|mohon)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = clean.split(' ').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 5) return null

  // Single-word or two-word direct app name (e.g. "Sportyfy", "Yutub Musik")
  if (tokens.length <= 2 && !OPEN_VERBS.has(tokens[0].toLowerCase())) {
    const direct = matchShortcutDisplayName(clean, shortcuts)
    if (direct && direct.score >= 0.82) {
      const sentence = `Buka ${direct.name}`
      return {
        original: clause,
        normalized: sentence,
        changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
        confidence: direct.score,
        rule: 'open-direct-target'
      }
    }
  }

  if (tokens.length < 2) return null

  const firstLower = tokens[0].toLowerCase()
  const isKnownOpenVerb =
    OPEN_VERBS.has(firstLower) || phoneticSimilarity(firstLower, 'buka') >= 0.72

  if (!isKnownOpenVerb) return null

  const restRaw = tokens.slice(1).join(' ')
  const withDetachedS = firstLower === 'bukas' && restRaw === '45' ? 's 45' : restRaw

  const matched = matchShortcutDisplayName(withDetachedS, shortcuts)
  if (matched && matched.score >= 0.72) {
    const sentence = `Buka ${matched.name}`
    return {
      original: clause,
      normalized: sentence,
      changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
      confidence: matched.score,
      rule: 'open-shortcut-template'
    }
  }

  return null
}

/**
 * Predicts spoken duration (<amount> <unit>) even when syllables are slurred or merged
 * across word boundaries (e.g. "imam nel" -> "5 menit", "sepulu mnit" -> "10 menit").
 */
function predictSpokenDuration(afterNoun: string): {
  amount: number
  unit: 'detik' | 'menit' | 'jam'
  remainder: string
} | null {
  const trimmed = afterNoun.trim()
  if (!trimmed) return null

  // 1. Special glued Indonesian durations
  if (/\bselimanya\b/i.test(trimmed)) {
    return { amount: 5, unit: 'menit', remainder: trimmed.replace(/\bselimanya\b/i, '').trim() }
  }
  if (/\bsemenit\b/i.test(trimmed)) {
    return { amount: 1, unit: 'menit', remainder: trimmed.replace(/\bsemenit\b/i, '').trim() }
  }
  if (/\bsejam\b/i.test(trimmed)) {
    return { amount: 1, unit: 'jam', remainder: trimmed.replace(/\bsejam\b/i, '').trim() }
  }
  if (/\bsetengah\s+jam\b/i.test(trimmed)) {
    return { amount: 30, unit: 'menit', remainder: trimmed.replace(/\bsetengah\s+jam\b/i, '').trim() }
  }
  if (/\bsetengah\s+menit\b/i.test(trimmed)) {
    return { amount: 30, unit: 'detik', remainder: trimmed.replace(/\bsetengah\s+menit\b/i, '').trim() }
  }

  const allUnitForms = UNIT_PATTERNS.flatMap((u) => u.forms).join('|')

  // 2. Digit match e.g. "5 menit" / "10 mnit" / "5"
  const digitRe = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${allUnitForms})?\\b(.*)$`, 'i')
  const digitMatch = trimmed.match(digitRe)
  if (digitMatch) {
    const amount = parseFloat(digitMatch[1].replace(',', '.'))
    const rawU = (digitMatch[2] || '').toLowerCase()
    let unit: 'detik' | 'menit' | 'jam' = 'menit'
    if (UNIT_PATTERNS[1].forms.includes(rawU)) unit = 'detik'
    else if (UNIT_PATTERNS[2].forms.includes(rawU)) unit = 'jam'
    return { amount, unit, remainder: (digitMatch[3] || '').trim() }
  }

  // 3. Exact & slurred spoken number + unit regex match ("lima menit", "imam nel", "sepulu mnit")
  for (const entry of SPOKEN_NUMBERS) {
    const allNumForms = [...entry.words, ...(entry.slurred || [])]
    for (const w of allNumForms) {
      const re = new RegExp(`^${w}\\b(?:\\s*(${allUnitForms})\\b)?(.*)$`, 'i')
      const m = trimmed.match(re)
      if (m) {
        const rawU = (m[1] || '').toLowerCase()
        let unit: 'detik' | 'menit' | 'jam' = 'menit'
        if (UNIT_PATTERNS[1].forms.includes(rawU)) unit = 'detik'
        else if (UNIT_PATTERNS[2].forms.includes(rawU)) unit = 'jam'
        return { amount: entry.value, unit, remainder: (m[2] || '').trim() }
      }
    }
  }

  // 4. Acoustic Glued-Syllable Predictor on the first 1-3 words after "timer"/"pengingat"
  // Handles severely muffled speech where word boundaries shifted (e.g. "imam nel", "tiga pulu men")
  const words = trimmed.split(/\s+/).filter(Boolean)
  let bestPred: {
    amount: number
    unit: 'detik' | 'menit' | 'jam'
    consumedWords: number
    score: number
  } | null = null

  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const chunk = words.slice(0, take).join(' ')
    const gluedChunk = chunk.replace(/\s+/g, '')

    for (const numEntry of SPOKEN_NUMBERS) {
      const numForms = [numEntry.words[0], ...(numEntry.slurred || [])]
      for (const uEntry of UNIT_PATTERNS) {
        for (const nf of numForms) {
          const targetPhrase = `${nf} ${uEntry.unit}`
          const targetGlued = `${nf}${uEntry.unit}`
          const simPhrase = phoneticSimilarity(chunk, targetPhrase)
          const simGlued = phoneticSimilarity(gluedChunk, targetGlued)
          const score = Math.max(simPhrase, simGlued)

          if (score >= 0.72 && (!bestPred || score > bestPred.score)) {
            bestPred = {
              amount: numEntry.value,
              unit: uEntry.unit,
              consumedWords: take,
              score
            }
          }
        }
      }
    }
  }

  if (bestPred) {
    return {
      amount: bestPred.amount,
      unit: bestPred.unit,
      remainder: words.slice(bestPred.consumedWords).join(' ').trim()
    }
  }

  return null
}

function tryReconstructTimerCommand(clause: string): NormalizedSentenceResult | null {
  const clean = clause
    .toLowerCase()
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/^(?:tolong|coba|mohon)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = clean.split(' ').filter(Boolean)
  if (tokens.length < 2) return null

  // Check if any token in slots 0..3 is a timer/reminder noun ("timer", "temar", "taimer", "pengingat", "alarm")
  let timerNounIdx = -1
  let canonicalNoun: 'timer' | 'pengingat' = 'timer'
  for (let i = 0; i < Math.min(tokens.length, 4); i++) {
    const tk = tokens[i]
    const sk = consonantSkeleton(tk)
    const isTimerLike =
      TIMER_NOUNS.has(tk) ||
      phoneticSimilarity(tk, 'timer') >= 0.74 ||
      (sk === 'tmr' && tk.length >= 4 && tk.length <= 6)
    const isReminderLike =
      phoneticSimilarity(tk, 'pengingat') >= 0.74 || phoneticSimilarity(tk, 'alarm') >= 0.78

    if (isTimerLike || isReminderLike) {
      timerNounIdx = i
      canonicalNoun =
        isReminderLike || tk.startsWith('peng') || tk.startsWith('per') ? 'pengingat' : 'timer'
      break
    }
  }

  // Note: "atau" only acts as a misheard "atur" when paired with a timer noun ("Atau temar...")!
  const firstToken = tokens[0]
  const firstIsTimerVerb =
    (TIMER_VERBS.has(firstToken) && (firstToken !== 'atau' || timerNounIdx >= 1)) ||
    phoneticSimilarity(firstToken, 'atur') >= 0.74 ||
    phoneticSimilarity(firstToken, 'pasang') >= 0.75 ||
    phoneticSimilarity(firstToken, 'ingatkan') >= 0.75

  if (timerNounIdx === -1 && !firstIsTimerVerb) return null
  if (
    timerNounIdx === -1 &&
    !/\b(menit|mnit|menet|detik|sekon|jam|semenit|sejam|selimanya)\b/.test(clean)
  ) {
    return null
  }

  const afterNoun =
    timerNounIdx >= 0 ? tokens.slice(timerNounIdx + 1).join(' ') : tokens.slice(1).join(' ')

  const predicted = predictSpokenDuration(afterNoun)
  if (!predicted || isNaN(predicted.amount) || predicted.amount <= 0) {
    return null
  }

  const rawRemainder = predicted.remainder
    .replace(/^(?:untuk|buat|agar|supaya|lagi|ke\s+depan)\s+/i, '')
    .trim()
  const cleanLabel = rawRemainder ? normalizeToBakuWords(rawRemainder) : ''

  const isAturStyle =
    firstToken === 'tur' ||
    firstToken === 'atau' ||
    firstToken === 'atu' ||
    phoneticSimilarity(firstToken, 'atur') >= 0.74
  const verbDisplay = isAturStyle ? 'Atur' : 'Pasang'

  const sentence = cleanLabel
    ? `${verbDisplay} ${canonicalNoun} ${predicted.amount} ${predicted.unit} ${cleanLabel}`
    : `${verbDisplay} ${canonicalNoun} ${predicted.amount} ${predicted.unit}`

  return {
    original: clause,
    normalized: sentence,
    changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
    confidence: 0.92,
    rule: 'timer-template'
  }
}

const FILLER_TAIL_ONLY = /^(?:dong|ya|sekarang|dulu|aja|saja|deh|nih|tolong)$/i

function cleanMediaQueryConnectors(rawQuery: string): string {
  return rawQuery
    .replace(/^(?:(?:sambil|sekalian|lalu|terus|dan|langsung)\s+)+/i, '')
    .replace(/^(?:buka|bukain|bukakan|putar|puter|putarkan|setel|stel|mainkan|cari)\s+/i, '')
    .replace(/^(?:video|videonya|musik|musiknya|lagu|lagunya)\s+/i, '')
    .replace(/[?!.,;:]+$/g, '')
    .trim()
}

/**
 * Menangkap pola seperti:
 * - "Buka YouTube sambil langsung buka video Windah Basudara"
 * - "Buka YouTube Hindia Kita Ke Sana"
 * - "Buka YouTube Music Evaluasi"
 * - "Buka Sopotify musik Tulus Hati-Hati di Jalan"
 */
function tryReconstructMediaOpenWithQuery(clause: string): NormalizedSentenceResult | null {
  const clean = clause
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/^(?:tolong|coba|mohon)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const openVerbPrefix =
    /^(?:buka|bukar|bukam|bukas|bukak|bukai|bukain|bukakan|bukanya|jalankan|nyalakan|setel|stel|putar|puter|putarkan|mainkan|open)\s+/i
  if (!openVerbPrefix.test(clean)) return null

  const afterVerb = clean.replace(openVerbPrefix, '').trim()

  // 1. YouTube Music + judul lagu
  const ytmMatch = afterVerb.match(
    /^(?:youtube\s+music|yt\s+music|youtube\s+musik|yutub\s+musik|yutup\s+musik|utub\s+musik)\s+(.+)$/i
  )
  if (ytmMatch?.[1]) {
    const q = cleanMediaQueryConnectors(ytmMatch[1])
    if (q.length >= 2 && !FILLER_TAIL_ONLY.test(q)) {
      const sentence = `Putar ${q} di YouTube Music`
      return {
        original: clause,
        normalized: sentence,
        changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
        confidence: 0.93,
        rule: 'open-ytmusic-with-query'
      }
    }
  }

  // 2. YouTube + judul video/lagu
  const ytMatch = afterVerb.match(
    /^(?:youtube|yutub|yutup|yutuk|utub|utuk|yu\s+tub|you\s+tube|yt)\s+(.+)$/i
  )
  if (ytMatch?.[1]) {
    const q = cleanMediaQueryConnectors(ytMatch[1])
    if (q.length >= 2 && !FILLER_TAIL_ONLY.test(q)) {
      const sentence = `Putar ${q} di YouTube`
      return {
        original: clause,
        normalized: sentence,
        changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
        confidence: 0.93,
        rule: 'open-youtube-with-query'
      }
    }
  }

  // 3. Spotify + judul lagu/musik
  const spMatch = afterVerb.match(
    /^(?:spotify|sopotify|sportyfy|sportify|spotifai|spotifi|sepotifai|sportivi)\s+(.+)$/i
  )
  if (spMatch?.[1]) {
    const q = cleanMediaQueryConnectors(spMatch[1])
    if (q.length >= 2 && !FILLER_TAIL_ONLY.test(q)) {
      const sentence = `Putar ${q} di Spotify`
      return {
        original: clause,
        normalized: sentence,
        changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
        confidence: 0.93,
        rule: 'open-spotify-with-query'
      }
    }
  }

  return null
}

function tryReconstructSearchOrPlay(clause: string): NormalizedSentenceResult | null {
  const clean = clause.replace(/[?!.]+$/g, '').trim()

  // "[Putar/Puter/Setel/Buka video] [lagu ...] [di spotify / youtube music / youtube]"
  const playMatch = clean.match(
    /^(?:tolong\s+)?(putar|puter|puterin|putarkan|setel|stel|mainkan|buka\s+video|buka\s+lagu|buka\s+musik)\s+(.+)$/i
  )
  if (playMatch) {
    let body = playMatch[2].trim()
    let platformSuffix = ''
    if (/\bdi\s+(?:youtube\s+music|yt\s+music|yutub\s+musik|youtube\s+musik|utub\s+musik)$/i.test(body)) {
      body = body.replace(
        /\s*\bdi\s+(?:youtube\s+music|yt\s+music|yutub\s+musik|youtube\s+musik|utub\s+musik)$/i,
        ''
      )
      platformSuffix = ' di YouTube Music'
    } else if (
      /\bdi\s+(?:spotify|sopotify|sportyfy|sportify|spotifai|spotifi|sepotifai|sportivi)$/i.test(body)
    ) {
      body = body.replace(
        /\s*\bdi\s+(?:spotify|sopotify|sportyfy|sportify|spotifai|spotifi|sepotifai|sportivi)$/i,
        ''
      )
      platformSuffix = ' di Spotify'
    } else if (/\bdi\s+(?:youtube|yutub|yutup|utub|utuk|yt)$/i.test(body)) {
      body = body.replace(/\s*\bdi\s+(?:youtube|yutub|yutup|utub|utuk|yt)$/i, '')
      platformSuffix = ' di YouTube'
    }
    const cleanTitle = body.replace(/^(?:lagu|musik|video)\s+/i, '').trim() || body.trim()
    const sentence = `Putar ${cleanTitle}${platformSuffix}`
    return {
      original: clause,
      normalized: sentence,
      changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
      confidence: 0.9,
      rule: 'play-media-template'
    }
  }

  // "[Cari/Carikan/Cariin] [...] [di gugel/yutub]"
  const searchMatch = clean.match(/^(?:tolong\s+)?(cari|carikan|cariin|nyari|googling)\s+(.+)$/i)
  if (searchMatch) {
    let body = searchMatch[2].trim()
    body = body
      .replace(/\bdi\s+(?:youtube|yutub|yutup|utub|utuk|yt)$/i, 'di YouTube')
      .replace(/\bdi\s+(?:google|gugel|gogel|internet|browser|brosur)$/i, 'di Google')
    const sentence = `Cari ${normalizeToBakuWords(body)}`
    return {
      original: clause,
      normalized: sentence,
      changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
      confidence: 0.88,
      rule: 'search-template'
    }
  }

  // "[Catat/Catet] [...]"
  const noteMatch = clean.match(
    /^(?:tolong\s+|coba\s+)?(catat|catet|catatkan|catatin|nyatet|nyatat|buat\s+catatan|bikin\s+catatan|tulis\s+catatan)\s+(.+)$/i
  )
  if (noteMatch) {
    const content = normalizeToBakuWords(noteMatch[2].trim())
    const sentence = `Catat ${content}`
    return {
      original: clause,
      normalized: sentence,
      changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
      confidence: 0.92,
      rule: 'note-template'
    }
  }

  // "[Tambah tugas / Bikin tugas] [...]"
  const todoMatch = clean.match(
    /^(?:tolong\s+|coba\s+)?(tambah\s+tugas|tamba\s+tugas|tambahin\s+tugas|tambahkan\s+tugas|buat\s+tugas|bikin\s+tugas|masukkan\s+tugas)\s+(.+)$/i
  )
  if (todoMatch) {
    const content = normalizeToBakuWords(todoMatch[2].trim())
    const sentence = `Tambah tugas ${content}`
    return {
      original: clause,
      normalized: sentence,
      changed: sentence.toLowerCase() !== clause.trim().toLowerCase(),
      confidence: 0.92,
      rule: 'todo-template'
    }
  }

  return null
}

/**
 * Converts informal/slang/abbreviated words to standard KBBI Bahasa Indonesia Baku
 * AND predicts garbled/mumbled out-of-vocabulary words using phonetic + consonant-skeleton matching.
 */
export function normalizeToBakuWords(text: string): string {
  // Step 1: Word-level informal -> baku + unclear-word vocabulary prediction
  const mapped = text
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part
      const prefixPunct = (part.match(/^[^a-zA-Z0-9]+/) || [''])[0]
      const suffixPunct = (part.match(/[^a-zA-Z0-9]+$/) || [''])[0]
      const stripped = part.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
      if (!stripped || stripped.length < 2 || /^\d+$/.test(stripped)) return part
      const lower = stripped.toLowerCase()

      // 1. Direct Informal / Tidak Baku / Typo -> Kata Baku KBBI
      const directBaku = INFORMAL_TO_BAKU_MAP[lower]
      if (directBaku) {
        return `${prefixPunct}${directBaku}${suffixPunct}`
      }

      // 2. Guard: if already a known valid Indonesian word, keep intact!
      if (VALID_INDONESIAN_GUARD.has(lower)) {
        return part
      }

      // 3. Unclear/garbled word prediction against Core Baku Vocabulary (length >= 5)
      if (lower.length >= 5) {
        const pk = phoneticKey(lower)
        const sk = consonantSkeleton(lower)
        let bestWord: string | null = null
        let bestScore = 0

        for (const vocabWord of CORE_INDONESIAN_VOCAB) {
          if (Math.abs(vocabWord.length - lower.length) > 2) continue
          const dist = levenshtein(lower, vocabWord)
          if (dist > 2) continue

          const samePhonetic = pk === phoneticKey(vocabWord)
          const sameSkeleton = sk.length >= 3 && sk === consonantSkeleton(vocabWord)
          const sim = phoneticSimilarity(lower, vocabWord)

          const qualifies =
            (samePhonetic && dist <= 2) ||
            (sameSkeleton && dist <= 2 && lower[0] === vocabWord[0]) ||
            (lower.length >= 6 && dist === 1 && lower[0] === vocabWord[0])

          if (qualifies && sim > bestScore) {
            bestScore = sim
            bestWord = vocabWord
          }
        }

        if (bestWord) {
          return `${prefixPunct}${bestWord}${suffixPunct}`
        }
      }

      return part
    })
    .join('')

  // Step 2: Contextual Bigram Prediction ("tidak tau" -> "tidak tahu", "mata kulyah" -> "mata kuliah", etc.)
  let result = mapped
  for (const rule of BIGRAM_BAKU_RULES) {
    result = result.replace(rule.pattern, rule.replacement)
  }

  return result.replace(/\s+/g, ' ').trim()
}

/**
 * Main entry point: takes raw Whisper / user transcript and predicts + normalizes it
 * into a clean, accurate, Bahasa Indonesia Baku sentence!
 */
export function normalizeSpokenSentence(
  rawText: string,
  shortcuts: ShortcutItem[] = []
): NormalizedSentenceResult {
  const trimmed = rawText.trim()
  if (!trimmed) {
    return { original: rawText, normalized: '', changed: false, confidence: 0 }
  }

  // 1. Resolve spoken mid-sentence self-corrections ("Bukanya utuk, bukan buka yang penah")
  const resolved = resolveSpokenSelfCorrection(trimmed)
  const cleanLower = resolved
    .toLowerCase()
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const inputWords = cleanLower.split(' ').filter(Boolean)

  // 2. Match against Canonical Whole-Sentence Bank (high-confidence whole-sentence snapping)
  let bestCanonical: { sentence: string; score: number } | null = null
  for (const entry of CANONICAL_SENTENCES) {
    for (const variant of entry.variants) {
      const varWords = variant.split(' ').filter(Boolean)
      if (Math.abs(inputWords.length - varWords.length) > 2) continue

      const sim = phoneticSimilarity(cleanLower, variant)
      const minScore = varWords.length === 1 ? 0.86 : 0.76
      if (sim >= minScore && (!bestCanonical || sim > bestCanonical.score)) {
        bestCanonical = { sentence: entry.canonical, score: sim }
      }
    }
  }

  if (bestCanonical && bestCanonical.score >= 0.8) {
    return {
      original: rawText,
      normalized: bestCanonical.sentence,
      changed: bestCanonical.sentence.toLowerCase() !== trimmed.toLowerCase(),
      confidence: bestCanonical.score,
      rule: 'canonical-sentence'
    }
  }

  // 2b. Try Open YouTube / YouTube Music / Spotify WITH direct video/song query
  const mediaOpenRes = tryReconstructMediaOpenWithQuery(resolved)
  if (mediaOpenRes) return mediaOpenRes

  // 3. Try Open App / Website Template ("Bukai YouTube", "Bukas 45", "buka yang tengad")
  const openRes = tryReconstructOpenCommand(resolved, shortcuts)
  if (openRes) return openRes

  // 4. Try Timer / Reminder Template ("Atau temar, imam nel", "Tur timer selimanya", "Pasang taimer 5 mnit")
  const timerRes = tryReconstructTimerCommand(resolved)
  if (timerRes) return timerRes

  // 5. Try Search / Play / Note / Todo Templates (with Baku body normalization!)
  const actionRes = tryReconstructSearchOrPlay(resolved)
  if (actionRes) return actionRes

  // 6. Slightly looser canonical sentence match if 0.76..0.80
  if (bestCanonical) {
    return {
      original: rawText,
      normalized: bestCanonical.sentence,
      changed: bestCanonical.sentence.toLowerCase() !== trimmed.toLowerCase(),
      confidence: bestCanonical.score,
      rule: 'canonical-sentence-soft'
    }
  }

  // 7. General sentence: Informal -> Baku KBBI + Bigram Context + Unclear-Word Prediction
  const bakuSentence = normalizeToBakuWords(resolved)
  const capitalized =
    bakuSentence.length > 0
      ? bakuSentence.charAt(0).toUpperCase() + bakuSentence.slice(1)
      : bakuSentence

  return {
    original: rawText,
    normalized: capitalized,
    changed: capitalized !== trimmed,
    confidence: 0.75,
    rule: 'baku-prediction'
  }
}
