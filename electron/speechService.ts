import { app } from 'electron'
import path from 'node:path'
import type {
  AssistantSettings,
  MediaPlaybackState,
  ModelStatus,
  ShortcutItem
} from '../src/types/assistant'
import { matchWakeWord } from '../src/utils/wakeWord'
import { normalizeSpokenSentence } from './sentenceNormalizer'
import {
  buildIndonesianWhisperPrompt,
  resolveWhisperCppSpec,
  WhisperCppService
} from './whisperCppService'

// Preserve native ESM import() even if compiled to CommonJS (used only for emergency JS fallback)
const importESM = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>

const WHISPER_HALLUCINATIONS = new Set([
  'terima kasih',
  'terima kasih.',
  'terima kasih!',
  'terimakasih',
  'terima kasih sudah menonton',
  'terima kasih telah menonton',
  'jangan lupa subscribe',
  'thank you',
  'thank you.',
  'thanks for watching',
  'subtitle oleh',
  'subtitles by',
  'sampai jumpa',
  'sampai jumpa.',
  '[musik]',
  '[music]',
  '(musik)',
  '(music)',
  '...',
  'you'
])

// Speaker bleed patterns from YouTube videos / ads playing in the background
const SPEAKER_BLEED_PATTERNS = [
  /\blonceng\s+notifikasi\b/i,
  /\bjangan\s+lupa\s+(?:like|subscribe|komen|share)\b/i,
  /\blike\s+(?:dan|and)\s+subscribe\b/i,
  /\bterima\s+kasih\s+(?:sudah|telah)\s+menonton\b/i,
  /\bsampai\s+jumpa\s+di\s+video\b/i
]

export class SpeechService {
  private whisperCpp: WhisperCppService | null = null
  private pipelineInstance: any = null
  private loadedModelId: string | null = null
  private loadingPromise: Promise<any> | null = null
  private modelStatus: ModelStatus = {
    status: 'idle',
    progress: 0,
    model: 'whisper-cpp-small',
    message: 'Belum dimuat'
  }
  private statusListeners: Array<(status: ModelStatus) => void> = []

  private getWhisperCpp(): WhisperCppService {
    if (!this.whisperCpp) {
      this.whisperCpp = new WhisperCppService(app.getPath('userData'), (next) => {
        this.setStatus(next)
      })
    }
    return this.whisperCpp
  }

  public onStatus(cb: (status: ModelStatus) => void): void {
    this.statusListeners.push(cb)
  }

  public getStatus(): ModelStatus {
    return this.modelStatus
  }

  private setStatus(next: Partial<ModelStatus>): void {
    this.modelStatus = { ...this.modelStatus, ...next }
    for (const cb of this.statusListeners) {
      cb(this.modelStatus)
    }
  }

  public isOfflineEngine(engine: AssistantSettings['sttEngine']): boolean {
    return engine !== 'groq-whisper' && engine !== 'openai-whisper'
  }

  /**
   * Preloads 100% offline native C++ whisper.cpp (whisper-server.exe + GGML model)
   * with Indonesian vocabulary prompt conditioning.
   */
  public async preloadOfflineEngine(
    settings: AssistantSettings,
    shortcuts: ShortcutItem[] = []
  ): Promise<ModelStatus> {
    if (!this.isOfflineEngine(settings.sttEngine)) {
      return this.modelStatus
    }

    const spec = resolveWhisperCppSpec(settings.sttEngine)
    const prompt = buildIndonesianWhisperPrompt(settings.wakeWord, shortcuts)

    try {
      await this.getWhisperCpp().ensureReady(spec, prompt)
    } catch (err: any) {
      console.warn('[SpeechService] whisper.cpp preload warning, trying JS fallback:', err)
      await this.ensureLocalTransformersFallback('Xenova/whisper-base')
    }
    return this.modelStatus
  }

  public shutdown(): void {
    this.whisperCpp?.stopServer()
  }

  /**
   * Conditions raw 16kHz microphone audio for maximum consonant clarity & quiet-ending recovery:
   * 1. DC-offset removal
   * 2. Gentle speech pre-emphasis (boosts 2-5kHz Indonesian consonants: t, k, p, s, r, l, m, n)
   * 3. Windowed RMS soft dynamic-range leveling so trailing words ("...lima menit") stay clear
   * 4. Clean 150ms silence padding at start & end so edge phonemes are never clipped
   */
  private conditionSpeechAudio(raw: Float32Array): Float32Array | null {
    if (!raw || raw.length < 2400) return null // < 150ms

    // 1. Remove DC offset
    let sum = 0
    for (let i = 0; i < raw.length; i++) sum += raw[i]
    const mean = sum / raw.length

    const centered = new Float32Array(raw.length)
    let peak = 0
    let sumSq = 0
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i] - mean
      centered[i] = v
      const av = Math.abs(v)
      if (av > peak) peak = av
      sumSq += v * v
    }

    const globalRms = Math.sqrt(sumSq / raw.length)
    if (peak < 0.0038 || globalRms < 0.0011) {
      return null
    }

    // 2. Trim dead outer silence with generous 300ms (4800 samples) guard margin
    const gate = Math.max(peak * 0.025, 0.0018)
    let start = 0
    let end = centered.length - 1
    while (start < centered.length && Math.abs(centered[start]) < gate) start++
    while (end > start && Math.abs(centered[end]) < gate) end--

    start = Math.max(0, start - 4800)
    end = Math.min(centered.length - 1, end + 4800)
    if (end - start < 2400) return null

    const bodyLen = end - start + 1
    const emphasized = new Float32Array(bodyLen)

    // 3. Subtle consonant pre-emphasis (alpha = 0.16 lifts muffled consonants without hiss)
    let prev = centered[start]
    for (let i = 0; i < bodyLen; i++) {
      const cur = centered[start + i]
      emphasized[i] = i === 0 ? cur : cur - 0.16 * prev
      prev = cur
    }

    // 4. Soft RMS envelope leveling (80ms = 1280-sample window) so quiet phrase endings stay audible
    const win = 1280
    const leveled = new Float32Array(bodyLen)
    let envRms = globalRms
    const targetRms = 0.14
    const noiseFloor = Math.max(0.003, globalRms * 0.28)

    for (let i = 0; i < bodyLen; i += win) {
      const chunkEnd = Math.min(bodyLen, i + win)
      let cSq = 0
      for (let j = i; j < chunkEnd; j++) cSq += emphasized[j] * emphasized[j]
      const localRms = Math.sqrt(cSq / (chunkEnd - i))
      envRms = envRms * 0.65 + localRms * 0.35

      // Only lift active speech above the room noise floor (prevents pumping background hiss!)
      let localGain = 1.0
      if (envRms > noiseFloor) {
        localGain = Math.min(14.0, Math.max(0.7, targetRms / (envRms + 0.004)))
      } else {
        localGain = Math.min(4.0, targetRms / (globalRms + 0.01))
      }

      for (let j = i; j < chunkEnd; j++) {
        // Soft tanh-like saturation ceiling at +-0.95
        const amplified = emphasized[j] * localGain
        leveled[j] = Math.tanh(amplified * 1.15) * 0.92
      }
    }

    // 5. Add clean 120ms (1920 samples) zero pad on both sides for Whisper STFT windowing
    const pad = 1920
    const out = new Float32Array(bodyLen + pad * 2)
    out.set(leveled, pad)
    return out
  }

  private encodeFloat32ToWavBuffer(samples: Float32Array, sampleRate = 16000): Buffer {
    const buf = Buffer.allocUnsafe(44 + samples.length * 2)
    buf.write('RIFF', 0, 'ascii')
    buf.writeUInt32LE(36 + samples.length * 2, 4)
    buf.write('WAVE', 8, 'ascii')
    buf.write('fmt ', 12, 'ascii')
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20) // PCM
    buf.writeUInt16LE(1, 22) // Mono
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * 2, 28)
    buf.writeUInt16LE(2, 32)
    buf.writeUInt16LE(16, 34)
    buf.write('data', 36, 'ascii')
    buf.writeUInt32LE(samples.length * 2, 40)

    let offset = 44
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      buf.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), offset)
    }
    return buf
  }

  public async transcribe(
    pcmFloat32: Float32Array,
    wavBase64: string | undefined,
    settings: AssistantSettings,
    shortcuts: ShortcutItem[] = [],
    mediaState?: MediaPlaybackState
  ): Promise<{ text: string; error?: string }> {
    try {
      const prompt = buildIndonesianWhisperPrompt(settings.wakeWord, shortcuts)

      // 1. Optional Cloud Groq Whisper Turbo (only when explicitly chosen or Groq key provided with groq-whisper)
      if (
        (settings.sttEngine === 'groq-whisper' ||
          (!this.isOfflineEngine(settings.sttEngine) && settings.groqApiKey.trim())) &&
        settings.groqApiKey.trim() &&
        wavBase64
      ) {
        try {
          const cloudRes = await this.transcribeCloudWhisper(
            wavBase64,
            'https://api.groq.com/openai/v1/audio/transcriptions',
            settings.groqApiKey.trim(),
            'whisper-large-v3-turbo',
            prompt
          )
          if (this.isSongLyricBleed(cloudRes.text, settings, mediaState)) {
            return { text: '' }
          }
          return { text: this.snapTranscriptWithWakeAware(cloudRes.text, settings, shortcuts) }
        } catch (cloudErr) {
          console.warn('[SpeechService] Groq STT fallback to offline whisper.cpp:', cloudErr)
        }
      }

      // 2. Optional Cloud OpenAI Whisper
      if (settings.sttEngine === 'openai-whisper' && settings.openaiApiKey.trim() && wavBase64) {
        try {
          const cloudRes = await this.transcribeCloudWhisper(
            wavBase64,
            'https://api.openai.com/v1/audio/transcriptions',
            settings.openaiApiKey.trim(),
            'whisper-1',
            prompt
          )
          if (this.isSongLyricBleed(cloudRes.text, settings, mediaState)) {
            return { text: '' }
          }
          return { text: this.snapTranscriptWithWakeAware(cloudRes.text, settings, shortcuts) }
        } catch (cloudErr) {
          console.warn('[SpeechService] OpenAI STT fallback to offline whisper.cpp:', cloudErr)
        }
      }

      // 3. Condition microphone audio for crystal-clear consonants & trailing-word volume
      const rawArray =
        pcmFloat32 instanceof Float32Array ? pcmFloat32 : new Float32Array(pcmFloat32)

      const conditioned = this.conditionSpeechAudio(rawArray)
      if (!conditioned) {
        return { text: '' }
      }

      const conditionedWav = this.encodeFloat32ToWavBuffer(conditioned, 16000)

      // 4. Primary 100% Offline Engine: Native C++ whisper.cpp!
      try {
        const spec = resolveWhisperCppSpec(settings.sttEngine)
        const t0 = Date.now()
        const rawText = await this.getWhisperCpp().transcribeWavBuffer(
          conditionedWav,
          spec,
          prompt
        )
        const elapsed = Date.now() - t0
        const cleaned = this.cleanTranscript(rawText)
        if (this.isSongLyricBleed(cleaned, settings, mediaState)) {
          console.log('[SpeechService] Ignored song lyric bleed from speakers:', JSON.stringify(cleaned))
          return { text: '' }
        }
        const snapped = this.snapTranscriptWithWakeAware(cleaned, settings, shortcuts)
        console.log(
          `[whisper.cpp ${spec.filename} ${elapsed}ms]`,
          JSON.stringify(rawText),
          '=> baku:',
          JSON.stringify(snapped)
        )
        return { text: snapped }
      } catch (cppErr) {
        console.warn('[SpeechService] whisper.cpp failed, using ONNX fallback:', cppErr)
      }

      // 5. Emergency Offline Fallback: @huggingface/transformers ONNX
      const transcriber = await this.ensureLocalTransformersFallback('Xenova/whisper-base')
      const output = await transcriber(conditioned, {
        language: 'indonesian',
        task: 'transcribe',
        chunk_length_s: 15,
        stride_length_s: 3,
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.2,
        max_new_tokens: 64
      })

      const rawText = (output?.text || '').trim()
      const cleaned = this.cleanTranscript(rawText)
      const snapped = this.snapTranscriptWithWakeAware(cleaned, settings, shortcuts)
      return { text: snapped }
    } catch (err: any) {
      console.error('[SpeechService] Transcription error:', err)
      return { text: '', error: err?.message || 'Gagal mengenali suara' }
    }
  }

  private async ensureLocalTransformersFallback(modelId = 'Xenova/whisper-base'): Promise<any> {
    if (this.pipelineInstance && this.loadedModelId === modelId) {
      return this.pipelineInstance
    }
    if (this.loadingPromise && this.loadedModelId === modelId) {
      return this.loadingPromise
    }

    this.loadedModelId = modelId
    this.loadingPromise = (async () => {
      try {
        const transformers = await importESM('@huggingface/transformers')
        const { pipeline, env } = transformers
        env.cacheDir = path.join(app.getPath('userData'), 'whisper-cache')
        env.allowLocalModels = true
        const pipe = await pipeline('automatic-speech-recognition', modelId, { dtype: 'fp32' })
        this.pipelineInstance = pipe
        return pipe
      } finally {
        this.loadingPromise = null
      }
    })()

    return this.loadingPromise
  }

  private async transcribeCloudWhisper(
    wavBase64: string,
    endpoint: string,
    apiKey: string,
    model: string,
    prompt: string
  ): Promise<{ text: string; error?: string }> {
    const buffer = Buffer.from(wavBase64, 'base64')
    const blob = new Blob([buffer], { type: 'audio/wav' })
    const form = new FormData()
    form.append('file', blob, 'speech.wav')
    form.append('model', model)
    form.append('language', 'id')
    form.append('prompt', prompt)

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Cloud STT Error (${res.status}): ${errText.slice(0, 120)}`)
    }

    const data = (await res.json()) as { text?: string }
    return { text: this.cleanTranscript(data.text || '') }
  }

  private snapTranscriptWithWakeAware(
    cleaned: string,
    settings: AssistantSettings,
    shortcuts: ShortcutItem[]
  ): string {
    if (!cleaned) return ''

    // Preserve wake word if spoken at the start, while predicting & normalizing the command remainder!
    const wakeCheck = matchWakeWord(cleaned, settings.wakeWord, settings.wakeAliases)
    if (wakeCheck.matched) {
      if (!wakeCheck.remainderCommand) {
        return settings.wakeWord
      }
      const snappedCmd = normalizeSpokenSentence(wakeCheck.remainderCommand, shortcuts).normalized
      return `${settings.wakeWord} ${snappedCmd}`
    }

    return normalizeSpokenSentence(cleaned, shortcuts).normalized
  }

  /**
   * Filters out active song lyrics bleeding from speakers into the microphone when music is playing,
   * while NEVER blocking wake words ("Woii Dann") or genuine assistant commands!
   */
  private isSongLyricBleed(
    cleaned: string,
    settings: AssistantSettings,
    mediaState?: MediaPlaybackState
  ): boolean {
    if (!cleaned || !mediaState?.active || !mediaState.lyrics?.length) return false

    // Never filter if user spoke the wake word!
    if (matchWakeWord(cleaned, settings.wakeWord, settings.wakeAliases).matched) {
      return false
    }

    // Never filter if utterance starts with or is a known voice command!
    const lower = cleaned.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    if (
      /^(?:tolong|coba|pergi|minggir|cabut|ngumpet|sembunyi|turun|hus|hush|syuh|pulang|dadah|bye|pause|paus|pos|jeda|stop|hentikan|play|plei|resume|lanjut|lanjutkan|next|neks|skip|previous|preverius|previus|privius|prev|ganti|balik|ulang|buka|bukain|bukakan|atur|pasang|setel|timer|pengingat|catat|catet|tambah|cari|putar|matikan|matiin|nyalakan|nyalain|jam|pukul|tanggal|hari|lagu apa|musik apa|cek|lihat|hitung|berapa|salin|halo|hai|terima kasih|makasih)\b/.test(
        lower
      )
    ) {
      return false
    }

    const spokenWords = lower.split(' ').filter((w) => w.length >= 3)
    if (spokenWords.length < 2) return false

    const livePos = mediaState.positionMs
    for (const line of mediaState.lyrics) {
      if (mediaState.isSynced && Math.abs(line.timeMs - livePos) > 20_000) continue
      const lyricTokens = new Set(
        line.text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 3)
      )
      if (lyricTokens.size === 0) continue

      let hits = 0
      for (const sw of spokenWords) {
        if (lyricTokens.has(sw)) hits++
      }
      if (hits / spokenWords.length >= 0.6) {
        return true
      }
    }

    return false
  }

  private cleanTranscript(raw: string): string {
    // Reject pure singing/music-note transcriptions picked up from speakers
    if (/[♪♫♬♩]/.test(raw)) {
      return ''
    }

    const trimmed = raw
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!trimmed) return ''
    if (WHISPER_HALLUCINATIONS.has(trimmed.toLowerCase())) {
      return ''
    }

    for (const bleedRe of SPEAKER_BLEED_PATTERNS) {
      if (bleedRe.test(trimmed)) {
        return ''
      }
    }

    // Reject repetitive Whisper background-noise hallucinations
    const words = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    if (words.length >= 9) {
      const uniqueRatio = new Set(words).size / words.length
      if (uniqueRatio < 0.48) {
        return ''
      }
    }

    return trimmed
  }
}
