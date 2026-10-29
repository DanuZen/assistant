let sharedToneCtx: AudioContext | null = null
let activeAudioElement: HTMLAudioElement | null = null

function getToneCtx(): AudioContext {
  if (!sharedToneCtx) {
    sharedToneCtx = new AudioContext()
  }
  if (sharedToneCtx.state === 'suspended') {
    sharedToneCtx.resume().catch(() => {})
  }
  return sharedToneCtx
}

export function playWakeChime(): void {
  try {
    const ctx = getToneCtx()
    const now = ctx.currentTime

    const freqs = [523.25, 783.99]
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(f, now + idx * 0.09)

      gain.gain.setValueAtTime(0.001, now + idx * 0.09)
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.09 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.22)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + idx * 0.09)
      osc.stop(now + idx * 0.09 + 0.24)
    })
  } catch {
    // Ignore audio context restrictions
  }
}

export function playSuccessChime(): void {
  try {
    const ctx = getToneCtx()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(659.25, now)
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12)

    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.22)
  } catch {
    // Ignore
  }
}

export function stopSpeaking(): void {
  if (activeAudioElement) {
    try {
      activeAudioElement.pause()
      activeAudioElement.src = ''
    } catch {}
    activeAudioElement = null
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

/**
 * Speaks Indonesian text using Electron's Native Bahasa Indonesia Neural TTS
 * (id-ID-ArdiNeural / id-ID-GadisNeural / Google ID), never falling back to English voices!
 */
export async function speakText(
  text: string,
  rate = 1.05,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  if (!text.trim()) {
    onEnd?.()
    return
  }

  stopSpeaking()

  try {
    const synth = await window.dannAPI.synthesizeSpeech(text)
    if (synth && synth.audioBase64) {
      const audio = new Audio(`data:${synth.mimeType};base64,${synth.audioBase64}`)
      activeAudioElement = audio

      audio.onplay = () => onStart?.()
      audio.onended = () => {
        if (activeAudioElement === audio) activeAudioElement = null
        onEnd?.()
      }
      audio.onerror = () => {
        if (activeAudioElement === audio) activeAudioElement = null
        onEnd?.()
      }

      await audio.play()
      return
    }
  } catch (err) {
    console.warn('[TTS] Indonesian neural playback error:', err)
  }

  // Offline-only fallback ONLY if a real Indonesian SAPI voice ('id-ID') exists on Windows
  if ('speechSynthesis' in window) {
    const voices = window.speechSynthesis.getVoices()
    const indoVoice = voices.find((v) => v.lang.toLowerCase().startsWith('id'))
    if (indoVoice) {
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = 'id-ID'
      utter.voice = indoVoice
      utter.rate = rate
      utter.onstart = () => onStart?.()
      utter.onend = () => onEnd?.()
      utter.onerror = () => onEnd?.()
      window.speechSynthesis.speak(utter)
      return
    }
  }

  onEnd?.()
}
