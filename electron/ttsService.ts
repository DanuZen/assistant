import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { AssistantSettings } from '../src/types/assistant'

export interface SynthesizedSpeech {
  audioBase64: string
  mimeType: string
}

export class IndonesianTTSService {
  private memoryCache = new Map<string, string>()

  public async warmUp(voice: AssistantSettings['ttsVoice'] = 'id-ID-ArdiNeural'): Promise<void> {
    const commonPhrases = [
      'Iya? Silakan ucapkan perintahmu.',
      'Hadir! Mau dibantu apa hari ini?'
    ]
    for (const phrase of commonPhrases) {
      try {
        await this.synthesize(phrase, voice, 1.05)
      } catch {
        // Ignore warm-up network errors
      }
    }
  }

  public async synthesize(
    text: string,
    voice: AssistantSettings['ttsVoice'] = 'id-ID-ArdiNeural',
    rate = 1.05
  ): Promise<SynthesizedSpeech | null> {
    const clean = text
      .replace(/[*_#`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!clean) return null

    const cacheKey = `${voice}|${rate.toFixed(2)}|${clean}`
    const cached = this.memoryCache.get(cacheKey)
    if (cached) {
      return { audioBase64: cached, mimeType: 'audio/mpeg' }
    }

    // 1. Try Microsoft Edge Neural Indonesian Voice (Ardi / Gadis)
    if (voice === 'id-ID-ArdiNeural' || voice === 'id-ID-GadisNeural') {
      try {
        const mp3Base64 = await this.synthEdgeNeural(clean, voice, rate)
        if (mp3Base64) {
          this.saveCache(cacheKey, mp3Base64)
          return { audioBase64: mp3Base64, mimeType: 'audio/mpeg' }
        }
      } catch (err) {
        console.warn('[TTS] Edge Neural failed, falling back to Google ID TTS:', err)
      }
    }

    // 2. Fast Google Indonesian TTS ("tl=id")
    try {
      const mp3Base64 = await this.synthGoogleId(clean)
      if (mp3Base64) {
        this.saveCache(cacheKey, mp3Base64)
        return { audioBase64: mp3Base64, mimeType: 'audio/mpeg' }
      }
    } catch (err) {
      console.warn('[TTS] Google ID TTS failed:', err)
    }

    return null
  }

  private saveCache(key: string, base64: string): void {
    if (this.memoryCache.size > 60) {
      const firstKey = this.memoryCache.keys().next().value
      if (firstKey) this.memoryCache.delete(firstKey)
    }
    this.memoryCache.set(key, base64)
  }

  private async synthEdgeNeural(
    text: string,
    voiceName: 'id-ID-ArdiNeural' | 'id-ID-GadisNeural',
    rate: number
  ): Promise<string> {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

    const pct = Math.round((rate - 1) * 100)
    const rateStr = pct >= 0 ? `+${pct}%` : `${pct}%`

    const { audioStream } = tts.toStream(text, { rate: rateStr })
    const chunks: Buffer[] = []

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          tts.close()
        } catch {}
        reject(new Error('Edge TTS timeout'))
      }, 6500)

      audioStream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk))
      })
      audioStream.on('end', () => {
        clearTimeout(timer)
        resolve()
      })
      audioStream.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    // Close cleanly in background after stream ends
    setTimeout(() => {
      try {
        tts.close()
      } catch {}
    }, 100)

    const buf = Buffer.concat(chunks)
    if (buf.length < 256) {
      throw new Error('Empty Edge TTS buffer')
    }
    return buf.toString('base64')
  }

  private async synthGoogleId(text: string): Promise<string> {
    // Split long sentences <= 185 chars so Google translate_tts never truncates
    const segments = this.splitTextSegments(text, 185)
    const buffers: Buffer[] = []

    for (const seg of segments) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=id&client=tw-ob&q=${encodeURIComponent(
        seg
      )}`
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
        }
      })
      if (!res.ok) {
        throw new Error(`Google TTS HTTP ${res.status}`)
      }
      const arr = await res.arrayBuffer()
      buffers.push(Buffer.from(arr))
    }

    const combined = Buffer.concat(buffers)
    return combined.toString('base64')
  }

  private splitTextSegments(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text]
    const words = text.split(' ')
    const result: string[] = []
    let current = ''
    for (const w of words) {
      if ((current + ' ' + w).trim().length > maxLen) {
        if (current) result.push(current.trim())
        current = w
      } else {
        current = (current + ' ' + w).trim()
      }
    }
    if (current) result.push(current.trim())
    return result
  }
}

