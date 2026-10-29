import os from 'node:os'
import { clipboard } from 'electron'
import type {
  CommandResult,
  MediaControlAction,
  MediaPlaybackState
} from '../src/types/assistant'
import type { StoreManager } from './store'
import {
  executeShortcut,
  findMatchingShortcut,
  openUrlOrSearch,
  playSpotifyDirect,
  playYouTubeDirect
} from './launcher'
import { normalizeSpokenSentence } from './sentenceNormalizer'

const WORD_NUMBERS: Record<string, number> = {
  satu: 1,
  sebuah: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  duabelas: 12,
  lima_belas: 15,
  limabelas: 15,
  duapuluh: 20,
  tigapuluh: 30,
  setengah: 0.5
}

export class AssistantBrain {
  constructor(
    private store: StoreManager,
    private onCreateReminder: (label: string, durationSec: number) => void,
    private getMediaState?: () => MediaPlaybackState,
    private onControlMedia?: (
      action: MediaControlAction
    ) => Promise<{ ok: boolean; action: MediaControlAction }>
  ) {}

  public async handleInput(rawText: string): Promise<CommandResult> {
    const rawTrimmed = rawText.trim()
    if (!rawTrimmed) {
      return {
        reply: 'Eh, gak kedengeran nih. Coba ngomong sekali lagi dong!',
        actionBadge: 'Kurang Jelas',
        shouldContinueConversation: true
      }
    }

    // Snap ASR typos & phonetic mishearings to the closest valid Indonesian sentence!
    const snapped = normalizeSpokenSentence(rawTrimmed, this.store.getData().shortcuts)
    const clean = snapped.normalized || rawTrimmed

    this.store.appendHistory({
      role: 'user',
      text: clean
    })

    const result = await this.routeIntent(clean)
    result.normalizedInput = clean

    this.store.appendHistory({
      role: 'assistant',
      text: result.reply,
      actionBadge: result.actionBadge
    })

    return result
  }

  private async routeIntent(text: string): Promise<CommandResult> {
    const lower = text
      .toLowerCase()
      .replace(/[?!.,]+$/g, '')
      .trim()

    // 1. Sapaan & Perkenalan Bahasa Indonesia
    if (
      /^(halo|hai|hei|woi|woii|oy|oi|tes|test|cek|selamat pagi|selamat siang|selamat sore|selamat malam|apa kabar|siapa kamu|kamu siapa|siapa namamu)$/.test(
        lower
      )
    ) {
      if (lower.includes('siapa')) {
        return {
          reply:
            'Halo! Nama saya Dann, asisten desktop pribadi kamu. Saya bisa membantu membuka aplikasi, mencatat ide atau daftar tugas, memasang pengingat waktu, hingga mencari informasi di Google dan YouTube.',
          actionBadge: 'Perkenalan'
        }
      }
      return {
        reply:
          'Halo! Kabar baik dan siap membantu. Mau buka aplikasi, catat sesuatu, atau pasang pengingat?',
        shouldContinueConversation: true
      }
    }

    // Ucapan terima kasih
    if (/^(terima kasih|makasih|makasih ya|terima kasih banyak|mantap|keren|oke makasih)$/.test(lower)) {
      return {
        reply: 'Sama-sama! Senang bisa membantu kamu. Panggil saja lagi kalau butuh bantuan.',
        actionBadge: 'Sama-sama'
      }
    }

    // Perintah mengusir / menyuruh karakter pergi atau turun bersembunyi
    if (
      /^(?:pergi(?:\s+(?:dulu|sana|aja|deh))?|sana\s+(?:pergi|dulu)|hus+|hush+|syuh+|(?:hus+|hush+)\s+sana|minggir(?:\s+(?:dulu|sana))?|geser\s+dulu|turun(?:\s+(?:dulu|sana|ke\s+bawah))?|masuk\s+dulu|sembunyi(?:\s+(?:dulu|sana))?|ngumpet(?:\s+(?:dulu|sana))?|cabut(?:\s+(?:dulu|sana))?|pulang(?:\s+sana)?|(?:udah|sudah)\s+(?:sana|pergi|cukup)|cukup\s+dulu|istirahat(?:\s+(?:dulu|sana))?|tidur(?:\s+(?:dulu|sana))?|jangan\s+ganggu(?:\s+dulu)?|hilang\s+dulu|dadah|bye(?:\s+bye)?)$/.test(
        lower
      )
    ) {
      const dismissReplies = [
        'Oke siap bos, aku cabut ke bawah dulu ya!',
        'Siap, aku minggir dulu. Panggil aja kalau butuh lagi!',
        'Oke deh, aku ngumpet dulu di bawah. Dadah!',
        'Siap bos, pamit turun dulu ya!'
      ]
      const picked = dismissReplies[Math.floor(Math.random() * dismissReplies.length)]
      return {
        reply: picked,
        actionBadge: '👋 Cabut Dulu',
        dismissMascot: true
      }
    }

    // 1b. Kasih semangat / motivasi (Pose 3!)
    if (/\b(semangat|kasih semangat|motivasi|gas terus|ayo semangat)\b/.test(lower)) {
      return {
        reply:
          'Ayo tetap semangat! Fokus selangkah demi selangkah, pekerjaan hari ini pasti tuntas dengan hasil terbaik!',
        actionBadge: '🔥 Semangat!',
        triggerPose: 'alert'
      }
    }

    // 1c. Kontrol Pemutar Musik (Pause, Play/Lanjutkan, Next, Previous)
    if (
      /^(?:jeda(?:\s+(?:musik|lagu))?|pause(?:\s+(?:musik|lagu))?|paus|hentikan\s+(?:musik|lagu)|stop\s+(?:musik|lagu)|matikan\s+(?:musik|lagu))$/.test(
        lower
      )
    ) {
      await this.onControlMedia?.('pause')
      return {
        reply: 'Oke, musiknya dijeda dulu.',
        actionBadge: '⏸️ Jeda Musik'
      }
    }

    if (
      /^(?:lanjutkan(?:\s+(?:musik|lagu))?|lanjut\s+(?:musik|lagu)|play(?:\s+(?:musik|lagu))?|plei|resume|unpause|putar\s+lagi|mainkan\s+lagi)$/.test(
        lower
      )
    ) {
      await this.onControlMedia?.('play')
      return {
        reply: 'Sip, lanjut muter lagunya!',
        actionBadge: '▶️ Lanjut Musik'
      }
    }

    if (
      /^(?:lagu\s+(?:selanjutnya|berikutnya)|musik\s+(?:selanjutnya|berikutnya)|next(?:\s+(?:lagu|musik))?|neks|skip(?:\s+lagu)?|ganti\s+lagu|lewati\s+lagu)$/.test(
        lower
      )
    ) {
      await this.onControlMedia?.('next')
      return {
        reply: 'Oke, lanjut ke lagu berikutnya!',
        actionBadge: '⏭️ Next Lagu'
      }
    }

    if (
      /^(?:lagu\s+sebelumnya|musik\s+sebelumnya|previous(?:\s+(?:lagu|musik))?|preverius|previus|privius|prev|balik\s+lagu|mundur\s+lagu|ulang\s+lagu|kembali\s+ke\s+lagu\s+sebelumnya)$/.test(
        lower
      )
    ) {
      await this.onControlMedia?.('previous')
      return {
        reply: 'Siap, balik ke lagu sebelumnya!',
        actionBadge: '⏮️ Lagu Sebelumnya'
      }
    }

    // 1d. Kontrol Lirik & Info Lagu yang Sedang Diputar
    if (/\b(matikan|sembunyikan|tutup|nonaktifkan)\s+(lirik|mode bernyanyi|karaoke)\b/.test(lower)) {
      this.store.updateSettings({ singAlongLyrics: false })
      return {
        reply: 'Siap, bubble lirik bernyanyi sudah saya matikan sementara.',
        actionBadge: '🎵 Lirik Off'
      }
    }
    if (/\b(nyalakan|aktifkan|tampilkan|munculkan)\s+(lirik|mode bernyanyi|karaoke)\b/.test(lower)) {
      this.store.updateSettings({ singAlongLyrics: true })
      return {
        reply: 'Asyik! Mode ikut bernyanyi dan bubble lirik sudah aktif kembali.',
        actionBadge: '🎵 Lirik On'
      }
    }
    if (
      /\b(lagu apa ini|judul lagu ini|sedang putar lagu apa|lagi dengerin apa|musik apa ini|lagu yang diputar)\b/.test(
        lower
      )
    ) {
      const media = this.getMediaState?.()
      if (media?.active && media.title) {
        const song = media.cleanTitle || media.title
        const by = media.cleanArtist || media.artist
        return {
          reply: by
            ? `Sekarang kamu sedang memutar lagu "${song}" dari ${by} di ${media.source || 'pemutar musik'}.`
            : `Sekarang kamu sedang memutar "${song}" di ${media.source || 'pemutar musik'}.`,
          actionBadge: `🎵 ${media.source || 'Musik'}`
        }
      }
      return {
        reply: 'Saat ini belum ada lagu yang sedang diputar di Spotify, YouTube Music, atau YouTube.',
        actionBadge: '🎵 Info Musik'
      }
    }

    // 2. Buka Dashboard / Pengaturan
    if (/\b(buka|tampilkan|lihat)\s+(dashboard|panel|menu utama|beranda)\b/.test(lower)) {
      return {
        reply: 'Baik, membuka halaman utama Dashboard Dann.',
        actionBadge: 'Buka Dashboard',
        openDashboardTab: 'home'
      }
    }
    if (
      /\b(buka|tampilkan)\s+(pengaturan|setting|setelan)\b/.test(lower) &&
      !lower.includes('windows')
    ) {
      return {
        reply: 'Baik, membuka pengaturan asisten.',
        actionBadge: 'Pengaturan',
        openDashboardTab: 'settings'
      }
    }

    // 3. Jam & Tanggal Bahasa Indonesia
    if (/\b(jam berapa|pukul berapa|waktu sekarang|sekarang jam berapa)\b/.test(lower)) {
      const now = new Date()
      const jam = now.getHours()
      const menit = now.getMinutes()
      const waktuStr =
        menit === 0 ? `pukul ${jam} tepat` : `pukul ${jam} lewat ${menit} menit`
      return {
        reply: `Sekarang ${waktuStr}.`,
        actionBadge: 'Waktu'
      }
    }

    if (
      /\b(tanggal berapa|hari apa sekarang|hari ini hari apa|hari ini tanggal berapa|sekarang tanggal berapa)\b/.test(
        lower
      )
    ) {
      const dateStr = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(new Date())
      return {
        reply: `Hari ini adalah hari ${dateStr}.`,
        actionBadge: 'Tanggal'
      }
    }

    // 4. Mencatat (Notes) — termasuk variasi lisan "catet", "tulis", dll.
    const noteMatch = text.match(
      /^(?:tolong\s+|coba\s+)?(?:catat|catet|catatkan|buat catatan|simpan catatan|tulis catatan|tulis)[\s,:;.!-]+(?:bahwa\s+|kalau\s+)?(.+)$/i
    )
    if (noteMatch && noteMatch[1]) {
      const content = noteMatch[1].trim()
      const words = content.split(/\s+/)
      const title = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '')
      this.store.addNote({
        title: title.charAt(0).toUpperCase() + title.slice(1),
        content,
        isTodo: false,
        completed: false,
        pinned: false
      })
      return {
        reply: `Baik, sudah saya catat: "${content}".`,
        actionBadge: 'Catatan Disimpan'
      }
    }

    // Baca catatan
    if (/\b(baca catatan|lihat catatan|daftar catatan|catatan terakhir|cek catatan|buka catatan)\b/.test(lower)) {
      const notes = this.store.getData().notes.filter((n) => !n.isTodo)
      if (notes.length === 0) {
        return {
          reply: 'Belum ada catatan tersimpan. Ucapkan kata "Catat" diikuti isi catatan untuk membuat baru.',
          openDashboardTab: 'notes'
        }
      }
      const latest = notes
        .slice(0, 2)
        .map((n) => n.content)
        .join('. Selanjutnya: ')
      return {
        reply: `Kamu memiliki ${notes.length} catatan. Catatan terbaru: ${latest}.`,
        actionBadge: 'Baca Catatan',
        openDashboardTab: 'notes'
      }
    }

    // 5. Daftar Tugas (Todo)
    const todoMatch = text.match(
      /^(?:tolong\s+)?(?:tambah tugas|tambahkan tugas|buat tugas|tambah daftar tugas|masukkan tugas)\s*(?::)?\s+(.+)$/i
    )
    if (todoMatch && todoMatch[1]) {
      const taskText = todoMatch[1].trim()
      this.store.addNote({
        title: taskText.charAt(0).toUpperCase() + taskText.slice(1),
        content: taskText,
        isTodo: true,
        completed: false,
        pinned: false
      })
      return {
        reply: `Siap, tugas "${taskText}" sudah ditambahkan ke daftar tugas.`,
        actionBadge: 'Tugas Baru'
      }
    }

    if (/\b(daftar tugas|cek tugas|lihat tugas|tugas hari ini|buka tugas)\b/.test(lower)) {
      const todos = this.store.getData().notes.filter((n) => n.isTodo && !n.completed)
      if (todos.length === 0) {
        return {
          reply: 'Semua tugas sudah selesai! Belum ada tugas baru yang tertunda.',
          openDashboardTab: 'notes'
        }
      }
      const summary = todos
        .slice(0, 3)
        .map((t) => t.title)
        .join(', ')
      return {
        reply: `Masih ada ${todos.length} tugas yang belum selesai, yaitu: ${summary}.`,
        actionBadge: 'Daftar Tugas',
        openDashboardTab: 'notes'
      }
    }

    // 6. Timer & Pengingat
    const reminderParsed = this.parseTimerOrReminder(text)
    if (reminderParsed) {
      this.onCreateReminder(reminderParsed.label, reminderParsed.durationSec)
      const humanDur = this.formatDuration(reminderParsed.durationSec)
      return {
        reply: `Baik, pengingat "${reminderParsed.label}" sudah diatur untuk ${humanDur} ke depan.`,
        actionBadge: `Timer ${humanDur}`
      }
    }

    // 7a. Buka / Putar Lagu Langsung di Spotify
    const spotifyPlayMatch = text.match(
      /^(?:tolong\s+)?(?:putar|putarkan|stel|setel|mainkan|cari|buka(?:\s+(?:musik|lagu))?)[\s,:;.!-]+(.+?)\s+(?:di\s+)?(?:spotify|sopotify|sportyfy|sportify|spotifai|spotifi)$/i
    )
    if (spotifyPlayMatch && spotifyPlayMatch[1]) {
      const query = spotifyPlayMatch[1].replace(/^(?:lagu|musik|musiknya|lagunya)\s+/i, '').trim()
      const spRes = await playSpotifyDirect(query)
      return {
        reply:
          spRes.mode === 'desktop'
            ? `Siap, membuka Spotify dan langsung memutar "${query}"!`
            : `Siap, membuka "${query}" di Spotify Web!`,
        actionBadge: '🎵 Spotify'
      }
    }

    // 7b. Buka / Putar Lagu Langsung di YouTube Music
    const ytMusicPlayMatch = text.match(
      /^(?:tolong\s+)?(?:putar|putarkan|stel|setel|mainkan|cari|buka(?:\s+(?:musik|lagu))?)[\s,:;.!-]+(.+?)\s+(?:di\s+)?(?:youtube\s+music|yt\s+music|youtube\s+musik|yutub\s+musik)$/i
    )
    if (ytMusicPlayMatch && ytMusicPlayMatch[1]) {
      const query = ytMusicPlayMatch[1].replace(/^(?:lagu|musik|musiknya|lagunya)\s+/i, '').trim()
      const ytRes = await playYouTubeDirect(query, true)
      return {
        reply: ytRes.title
          ? `Siap, langsung memutar "${ytRes.title}" di YouTube Music!`
          : `Siap, memutar "${query}" di YouTube Music!`,
        actionBadge: '🎵 YT Music'
      }
    }

    // 7c. Pencarian (Cari ...) vs Putar Video Langsung (Putar / Buka ...) di YouTube
    const ytSearchOnlyMatch = text.match(
      /^(?:tolong\s+)?(?:cari|carikan|cariin)[\s,:;.!-]+(.+?)\s+(?:di\s+)?(?:youtube|yt|yutub)$/i
    )
    if (ytSearchOnlyMatch && ytSearchOnlyMatch[1]) {
      const query = ytSearchOnlyMatch[1].trim()
      await openUrlOrSearch(query, 'youtube')
      return {
        reply: `Siap, mencari "${query}" di YouTube sekarang.`,
        actionBadge: 'YouTube'
      }
    }

    const ytDirectPlayMatch = text.match(
      /^(?:tolong\s+)?(?:putar|putarkan|stel|setel|mainkan|buka(?:\s+video)?)[\s,:;.!-]+(.+?)\s+(?:di\s+)?(?:youtube|yt|yutub)$/i
    )
    if (ytDirectPlayMatch && ytDirectPlayMatch[1]) {
      const query = ytDirectPlayMatch[1].replace(/^(?:video|videonya|lagu|musik)\s+/i, '').trim()
      const ytRes = await playYouTubeDirect(query, false)
      return {
        reply: ytRes.title
          ? `Siap, membuka YouTube dan langsung memutar "${ytRes.title}"!`
          : `Siap, langsung membuka video "${query}" di YouTube!`,
        actionBadge: '▶️ YouTube'
      }
    }

    // 7d. Putar lagu / video langsung tanpa harus menyebut "di YouTube"
    // Catatan: "nyalakan" hanya dihitung sebagai perintah musik jika diikuti kata "musik" atau "lagu"!
    const playMusicMatch = text.match(
      /^(?:tolong\s+)?(?:(?:putar|putarkan|stel|setel|mainkan|buka\s+video|buka\s+lagu)[\s,:;.!-]+(?:lagu|musik|video)?\s*(.*)|nyalakan\s+(?:musik|lagu)\s*(.*))$/i
    )
    if (playMusicMatch) {
      const rawSong = playMusicMatch[1] ?? playMusicMatch[2] ?? ''
      const songQuery = rawSong.replace(/^(nya|lagunya|musiknya|videonya)$/i, '').trim()
      if (songQuery.length >= 2) {
        const ytRes = await playYouTubeDirect(songQuery, false)
        return {
          reply: ytRes.title
            ? `Siap, langsung memutar "${ytRes.title}" di YouTube!`
            : `Siap, langsung memutar "${songQuery}" di YouTube!`,
          actionBadge: '▶️ Putar Langsung'
        }
      } else {
        const spotify = findMatchingShortcut('spotify', this.store.getData().shortcuts)
        if (spotify) {
          await executeShortcut(spotify)
          return {
            reply: 'Siap, membuka pemutar musik Spotify untuk kamu.',
            actionBadge: 'Musik'
          }
        }
      }
    }

    // 8. Pencarian Google
    const googleMatch = text.match(
      /^(?:tolong\s+)?(?:cari|carikan|cariin|googling|cari tahu|cari informasi)[\s,:;.!-]+(?:tentang\s+)?(.+?)(?:\s+di\s+(?:google|gugel|internet|browser))?$/i
    )
    if (
      googleMatch &&
      googleMatch[1] &&
      !lower.startsWith('cari catatan') &&
      !lower.includes('di youtube')
    ) {
      const query = googleMatch[1].trim()
      await openUrlOrSearch(query, 'google')
      return {
        reply: `Baik, mencari "${query}" di Google.`,
        actionBadge: 'Pencarian Google'
      }
    }

    // 9. Buka Aplikasi / Website / Pintasan (Tahan typo lisan Whisper: bukar, bukam, bukas, bukak, bukanya, dll.)
    const openMatch = text.match(
      /^(?:tolong\s+|coba\s+)?(?:buka|bukar|bukam|bukas|bukak|bukain|bukakan|bukanya|jalankan|nyalakan|aktifkan|hidupkan|open|launch)[\s,:;.!-]+(.+)$/i
    )
    if (openMatch && openMatch[1]) {
      // Ambil klausa pertama jika ada koreksi lisan seperti "Bukanya utuk, bukan buka yang..."
      const rawClause = openMatch[1].split(/\b(?:bukan|eh bukan)\b/i)[0].trim()
      const targetPhrase = rawClause || openMatch[1].trim()
      const shortcuts = this.store.getData().shortcuts
      const matched = findMatchingShortcut(targetPhrase, shortcuts)
      if (matched) {
        const res = await executeShortcut(matched)
        return {
          reply: res.ok
            ? `Siap, membuka ${matched.name} sekarang.`
            : `Maaf, gagal membuka ${matched.name}. Pastikan aplikasinya sudah terpasang.`,
          actionBadge: matched.name
        }
      }

      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(targetPhrase.replace(/^situs\s+/i, ''))) {
        const cleanDomain = targetPhrase.replace(/^situs\s+/i, '').trim()
        await openUrlOrSearch(cleanDomain, 'url')
        return {
          reply: `Membuka situs ${cleanDomain} di peramban.`,
          actionBadge: 'Buka Situs'
        }
      }

      if (
        targetPhrase.toLowerCase().startsWith('situs ') ||
        targetPhrase.toLowerCase().startsWith('web ')
      ) {
        const siteQuery = targetPhrase.replace(/^(situs|web)\s+/i, '').trim()
        await openUrlOrSearch(siteQuery, 'google')
        return {
          reply: `Mencari situs ${siteQuery} di Google.`,
          actionBadge: 'Browser'
        }
      }
    }

    // 9b. Jika pengguna langsung menyebut nama aplikasi singkat (1-2 kata, misal "YouTube" / "Kalkulator" / "Spotify")
    const wordCount = lower.split(/\s+/).filter(Boolean).length
    if (wordCount >= 1 && wordCount <= 2) {
      const directShortcut = findMatchingShortcut(lower, this.store.getData().shortcuts)
      if (directShortcut) {
        const res = await executeShortcut(directShortcut)
        return {
          reply: res.ok
            ? `Siap, membuka ${directShortcut.name} sekarang.`
            : `Maaf, gagal membuka ${directShortcut.name}.`,
          actionBadge: directShortcut.name
        }
      }
    }

    // 10. Info Sistem
    if (/\b(cek ram|sisa ram|info sistem|spesifikasi laptop|info komputer|status sistem)\b/.test(lower)) {
      const totalGB = (os.totalmem() / 1024 ** 3).toFixed(1)
      const freeGB = (os.freemem() / 1024 ** 3).toFixed(1)
      const usedPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
      return {
        reply: `Sistem berjalan lancar. Penggunaan memori RAM saat ini ${usedPct} persen, tersisa ${freeGB} gigabita dari total ${totalGB} gigabita.`,
        actionBadge: 'Info Sistem'
      }
    }

    // 11. Hitungan Matematika Cepat
    const mathAnswer = this.tryEvaluateMath(lower)
    if (mathAnswer !== null) {
      return {
        reply: `Hasil perhitungannya adalah ${mathAnswer}.`,
        actionBadge: 'Kalkulasi'
      }
    }

    // 12. Salin ke Clipboard
    const copyMatch = text.match(/^(?:salin|copy)\s+(?:teks\s+)?(.+)$/i)
    if (copyMatch && copyMatch[1]) {
      clipboard.writeText(copyMatch[1].trim())
      return {
        reply: `Teks "${copyMatch[1].trim()}" sudah disalin ke papan klip.`,
        actionBadge: 'Clipboard'
      }
    }

    // 13. Hybrid Cloud AI (Gemini / Groq / OpenAI) dalam Bahasa Indonesia
    const aiReply = await this.tryCloudAI(text)
    if (aiReply) {
      return aiReply
    }

    // 14. Balasan singkat & gaul saat suara kurang kedengaran / perintah belum dikenali
    const casualFallbackReplies = [
      'Hah, gimana tuh? Kurang kedengeran nih, coba ulangi lagi dong!',
      'Eh sori, suaranya gak kedengeran jelas barusan. Coba ulang lagi ya!',
      'Waduh, kurang ketangkep nih omongannya. Mau minta tolong apa tadi?',
      'Hmm, agak samar suaranya nih. Coba ngomong sekali lagi dong!'
    ]
    const pickedReply =
      casualFallbackReplies[Math.floor(Math.random() * casualFallbackReplies.length)]

    return {
      reply: pickedReply,
      actionBadge: 'Kurang Jelas'
    }
  }

  private parseTimerOrReminder(text: string): { label: string; durationSec: number } | null {
    const lower = text.toLowerCase()
    if (!/\b(timer|pengingat|ingatkan|ingat|alarm|waktu)\b/.test(lower)) {
      return null
    }

    const regex =
      /(\d+(?:[.,]\d+)?|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|limabelas|duapuluh|tigapuluh|setengah)\s*(detik|sekon|menit|jam)/i
    const m = lower.match(regex)
    if (!m) return null

    const rawNum = m[1].replace(',', '.')
    const num = WORD_NUMBERS[rawNum] ?? parseFloat(rawNum)
    if (isNaN(num) || num <= 0) return null

    const unit = m[2].toLowerCase()
    let mul = 60
    if (unit.startsWith('detik') || unit.startsWith('sekon')) {
      mul = 1
    } else if (unit.startsWith('jam')) {
      mul = 3600
    }

    const durationSec = Math.max(3, Math.round(num * mul))

    let label = text
      .replace(
        /^(?:tolong\s+)?(?:pasang\s+|buat\s+|set\s+|atur\s+)?(?:timer|pengingat|alarm|ingatkan\s+(?:aku|saya)?)\s*/i,
        ''
      )
      .replace(m[0], '')
      .replace(/\b(lagi|ke depan|untuk|selama|dalam)\b/gi, '')
      .trim()

    if (!label) {
      label = 'Waktu pengingat selesai!'
    } else {
      label = label.charAt(0).toUpperCase() + label.slice(1)
    }

    return { label, durationSec }
  }

  private formatDuration(sec: number): string {
    if (sec < 60) return `${sec} detik`
    if (sec < 3600) {
      const m = Math.floor(sec / 60)
      const s = sec % 60
      return s > 0 ? `${m} menit ${s} detik` : `${m} menit`
    }
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return m > 0 ? `${h} jam ${m} menit` : `${h} jam`
  }

  private tryEvaluateMath(lower: string): string | null {
    const cleaned = lower
      .replace(/^(berapa\s+hasil\s+dari|berapa|hitung|kalkulasi)\s+/i, '')
      .replace(/\b(ditambah|tambah|plus)\b/g, '+')
      .replace(/\b(dikurangi|kurang|minus)\b/g, '-')
      .replace(/\b(dikali|kali|x)\b/g, '*')
      .replace(/\b(dibagi|bagi)\b/g, '/')
      .replace(/,/g, '.')
      .trim()

    if (!/^[\d\s+\-*/().]+$/.test(cleaned) || !/[+\-*/]/.test(cleaned)) {
      return null
    }

    try {
      const fn = new Function(`return (${cleaned})`)
      const val = fn()
      if (typeof val === 'number' && isFinite(val)) {
        return Number.isInteger(val) ? String(val) : val.toFixed(2)
      }
    } catch {
      return null
    }
    return null
  }

  private async tryCloudAI(userText: string): Promise<CommandResult | null> {
    const { settings, shortcuts } = this.store.getData()
    if (settings.aiProvider === 'local-only') return null

    const shortcutNames = shortcuts.map((s) => s.name).join(', ')
    const systemPrompt = `Kamu adalah "${settings.assistantName}" (dipanggil "${settings.wakeWord}"), asisten desktop pribadi di Windows yang selalu berbicara dalam Bahasa Indonesia yang alami, ramah, sopan, dan ringkas (1-3 kalimat agar nyaman didengar lewat suara).
Kamu punya kemampuan aksi desktop. Balas HANYA dalam format JSON valid berikut tanpa markdown:
{
  "reply": "jawaban singkat alami dalam Bahasa Indonesia",
  "action": "NONE" | "ADD_NOTE" | "ADD_TODO" | "SET_TIMER" | "OPEN_SHORTCUT" | "SEARCH_GOOGLE" | "SEARCH_YOUTUBE" | "PLAY_YOUTUBE" | "PLAY_SPOTIFY" | "DISMISS_MASCOT",
  "param": "isi catatan / nama shortcut (${shortcutNames}) / judul lagu atau video / kata kunci pencarian / durasi detik untuk SET_TIMER",
  "label": "label pengingat jika SET_TIMER"
}`

    try {
      let rawJson = ''
      if (settings.aiProvider === 'hybrid-gemini' && settings.geminiApiKey.trim()) {
        rawJson = await this.callGemini(settings.geminiApiKey.trim(), systemPrompt, userText)
      } else if (settings.aiProvider === 'hybrid-groq' && settings.groqApiKey.trim()) {
        rawJson = await this.callOpenAICompatible(
          'https://api.groq.com/openai/v1/chat/completions',
          settings.groqApiKey.trim(),
          'llama-3.3-70b-versatile',
          systemPrompt,
          userText
        )
      } else if (settings.aiProvider === 'hybrid-openai' && settings.openaiApiKey.trim()) {
        rawJson = await this.callOpenAICompatible(
          'https://api.openai.com/v1/chat/completions',
          settings.openaiApiKey.trim(),
          'gpt-4o-mini',
          systemPrompt,
          userText
        )
      } else if (settings.geminiApiKey.trim()) {
        rawJson = await this.callGemini(settings.geminiApiKey.trim(), systemPrompt, userText)
      } else if (settings.groqApiKey.trim()) {
        rawJson = await this.callOpenAICompatible(
          'https://api.groq.com/openai/v1/chat/completions',
          settings.groqApiKey.trim(),
          'llama-3.3-70b-versatile',
          systemPrompt,
          userText
        )
      } else if (settings.openaiApiKey.trim()) {
        rawJson = await this.callOpenAICompatible(
          'https://api.openai.com/v1/chat/completions',
          settings.openaiApiKey.trim(),
          'gpt-4o-mini',
          systemPrompt,
          userText
        )
      } else {
        return null
      }

      const cleaned = rawJson.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned) as {
        reply?: string
        action?: string
        param?: string
        label?: string
      }

      let badge = 'AI Dann'
      const action = parsed.action || 'NONE'
      const param = (parsed.param || '').trim()

      if (action === 'ADD_NOTE' && param) {
        this.store.addNote({
          title: param.slice(0, 36),
          content: param,
          isTodo: false,
          completed: false,
          pinned: false
        })
        badge = 'AI • Catatan'
      } else if (action === 'ADD_TODO' && param) {
        this.store.addNote({
          title: param,
          content: param,
          isTodo: true,
          completed: false,
          pinned: false
        })
        badge = 'AI • Tugas'
      } else if (action === 'SET_TIMER' && param) {
        const sec = Math.max(5, parseInt(param, 10) || 60)
        this.onCreateReminder(parsed.label || 'Pengingat AI', sec)
        badge = 'AI • Timer'
      } else if (action === 'OPEN_SHORTCUT' && param) {
        const match = findMatchingShortcut(param, shortcuts)
        if (match) {
          await executeShortcut(match)
          badge = `Buka ${match.name}`
        }
      } else if (action === 'SEARCH_GOOGLE' && param) {
        await openUrlOrSearch(param, 'google')
        badge = 'Pencarian Google'
      } else if (action === 'SEARCH_YOUTUBE' && param) {
        await openUrlOrSearch(param, 'youtube')
        badge = 'YouTube'
      } else if (action === 'PLAY_YOUTUBE' && param) {
        await playYouTubeDirect(param, false)
        badge = '▶️ YouTube'
      } else if (action === 'PLAY_SPOTIFY' && param) {
        await playSpotifyDirect(param)
        badge = '🎵 Spotify'
      } else if (action === 'DISMISS_MASCOT') {
        return {
          reply: parsed.reply || 'Siap bos, aku cabut dulu ya!',
          actionBadge: '👋 Cabut Dulu',
          dismissMascot: true
        }
      }

      return {
        reply: parsed.reply || 'Baik, sudah saya jalankan!',
        actionBadge: badge
      }
    } catch (err) {
      console.error('[Brain] Cloud AI error:', err)
      return null
    }
  }

  private async callGemini(apiKey: string, systemPrompt: string, userText: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json'
        }
      })
    })
    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}`)
    }
    const data = (await res.json()) as any
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
  }

  private async callOpenAICompatible(
    endpoint: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userText: string
  ): Promise<string> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role:"system", content: systemPrompt },
          { role:"user", content: userText }
        ]
      })
    })
    if (!res.ok) {
      throw new Error(`AI HTTP ${res.status}`)
    }
    const data = (await res.json()) as any
    return data?.choices?.[0]?.message?.content || '{}'
  }
}
