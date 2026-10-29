export interface AudioRecorderCallbacks {
  onLevel: (level: number) => void
  onUtterance: (pcm16k: Float32Array, wavBase64: string) => void
  onError: (err: string) => void
}

export class VoiceActivityRecorder {
  private stream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private recHighpassNode: BiquadFilterNode | null = null
  private vadHighpassNode: BiquadFilterNode | null = null
  private vadLowpassNode: BiquadFilterNode | null = null
  private mergerNode: ChannelMergerNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private resumeWatchdog: number | null = null

  private isPaused = false
  private isMusicPlaying = false
  private threshold = 0.013
  private ambientFloor = 0.0045
  private utterancePeakRms = 0
  private silenceTimeoutMs = 750
  private maxUtteranceMs = 5200

  private preRollChunks: Float32Array[] = []
  private maxPreRollChunks = 12 // ~510ms pre-roll at 2048 buffer so first consonant is NEVER clipped!
  private activeChunks: Float32Array[] = []
  private isSpeaking = false
  private silenceStart = 0
  private speechStart = 0

  constructor(private callbacks: AudioRecorderCallbacks) {}

  public setThreshold(val: number): void {
    this.threshold = Math.max(0.005, Math.min(0.08, val))
  }

  public setSilenceTimeout(ms: number): void {
    this.silenceTimeoutMs = ms
  }

  public setMaxUtteranceMs(ms: number): void {
    this.maxUtteranceMs = ms
  }

  public setMusicPlaying(playing: boolean): void {
    this.isMusicPlaying = playing
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused
    if (paused) {
      this.resetUtterance(false)
      this.callbacks.onLevel(0)
    } else if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {})
    }
  }

  private resetUtterance(preserveBoundaryOverlap = false): void {
    if (preserveBoundaryOverlap && this.activeChunks.length > 0) {
      // Keep last ~430ms in preRoll so a wake word spoken right across a chunk split stays whole!
      this.preRollChunks = this.activeChunks.slice(-10)
    }
    this.isSpeaking = false
    this.activeChunks = []
    this.utterancePeakRms = 0
    this.silenceStart = 0
    this.speechStart = 0
  }

  public async start(): Promise<boolean> {
    if (this.stream) return true
    try {
      // Chromium hardware loopback echoCancellation subtracts speaker music (Spotify/YouTube) in real time!
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1
        }
      })

      this.audioCtx = new AudioContext()
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {})
      }

      this.resumeWatchdog = window.setInterval(() => {
        if (!this.isPaused && this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {})
        }
      }, 1500)

      const inputSampleRate = this.audioCtx.sampleRate
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream)

      // Branch 0 (Recording -> Whisper): Clean 95Hz highpass removes bass rumble while keeping speech crisp
      this.recHighpassNode = this.audioCtx.createBiquadFilter()
      this.recHighpassNode.type = 'highpass'
      this.recHighpassNode.frequency.value = 95

      // Branch 1 (VAD Detector -> Speech-Over-Music Gate): Tight 220Hz - 3400Hz human vocal formant band!
      // Rejects kick drums (<180Hz) & cymbals (>3800Hz) so music doesn't hold VAD stuck open!
      this.vadHighpassNode = this.audioCtx.createBiquadFilter()
      this.vadHighpassNode.type = 'highpass'
      this.vadHighpassNode.frequency.value = 220

      this.vadLowpassNode = this.audioCtx.createBiquadFilter()
      this.vadLowpassNode.type = 'lowpass'
      this.vadLowpassNode.frequency.value = 3400

      this.mergerNode = this.audioCtx.createChannelMerger(2)
      this.processorNode = this.audioCtx.createScriptProcessor(2048, 2, 1)

      this.processorNode.onaudioprocess = (event) => {
        if (this.isPaused) return
        const recInput = event.inputBuffer.getChannelData(0)
        const vadInput = event.inputBuffer.getChannelData(1)

        const chunk = new Float32Array(recInput.length)
        chunk.set(recInput)

        let vadSumSq = 0
        for (let i = 0; i < vadInput.length; i++) {
          vadSumSq += vadInput[i] * vadInput[i]
        }
        const vadRms = Math.sqrt(vadSumSq / vadInput.length)
        this.callbacks.onLevel(Math.min(1, vadRms * 18))

        const now = performance.now()
        const startMultiplier = this.isMusicPlaying ? 1.25 : 1.65
        const startGate = Math.max(
          this.threshold * 0.82,
          Math.min(0.026, this.ambientFloor * startMultiplier)
        )
        const baseStopGate = Math.max(
          this.threshold * 0.6,
          Math.min(0.02, this.ambientFloor * 1.15)
        )

        if (!this.isSpeaking) {
          // Track ambient room / residual music baseline smoothly
          if (vadRms < startGate * 1.05) {
            this.ambientFloor = this.ambientFloor * 0.94 + vadRms * 0.06
          } else if (this.isMusicPlaying) {
            // Keep ambient floor bounded so it NEVER locks out speech!
            this.ambientFloor = Math.min(0.016, this.ambientFloor * 0.98 + vadRms * 0.02)
          }

          this.preRollChunks.push(chunk)
          if (this.preRollChunks.length > this.maxPreRollChunks) {
            this.preRollChunks.shift()
          }

          if (vadRms >= startGate) {
            this.isSpeaking = true
            this.speechStart = now
            this.silenceStart = 0
            this.utterancePeakRms = vadRms
            this.activeChunks = [...this.preRollChunks, chunk]
            this.preRollChunks = []
          }
        } else {
          this.activeChunks.push(chunk)
          if (vadRms > this.utterancePeakRms) {
            this.utterancePeakRms = vadRms
          }

          // Speech-over-music dropoff: when voice stops and level drops back below 38% of vocal peak,
          // close the utterance cleanly even if background music is still playing!
          const speechDropGate = this.isMusicPlaying
            ? Math.min(0.035, this.utterancePeakRms * 0.38)
            : 0
          const effectiveStopGate = Math.max(baseStopGate, speechDropGate)
          const effectiveSilenceMs = this.isMusicPlaying
            ? Math.min(this.silenceTimeoutMs, 650)
            : this.silenceTimeoutMs
          const effectiveMaxMs =
            this.isMusicPlaying && this.maxUtteranceMs <= 5000 ? 3600 : this.maxUtteranceMs

          if (vadRms < effectiveStopGate) {
            if (this.silenceStart === 0) {
              this.silenceStart = now
            } else if (now - this.silenceStart >= effectiveSilenceMs) {
              void this.finalizeUtterance(inputSampleRate, now - this.speechStart, false)
            }
          } else {
            this.silenceStart = 0
          }

          if (this.isSpeaking && now - this.speechStart >= effectiveMaxMs) {
            // Adapt ambient floor gently if max duration was reached during steady music
            if (this.isMusicPlaying) {
              this.ambientFloor = Math.min(0.042, this.ambientFloor * 0.8 + vadRms * 0.2)
            }
            void this.finalizeUtterance(inputSampleRate, now - this.speechStart, true)
          }
        }
      }

      // Wire Branch 0 (clean speech) & Branch 1 (vocal-band VAD)
      this.sourceNode.connect(this.recHighpassNode)
      this.recHighpassNode.connect(this.mergerNode, 0, 0)

      this.sourceNode.connect(this.vadHighpassNode)
      this.vadHighpassNode.connect(this.vadLowpassNode)
      this.vadLowpassNode.connect(this.mergerNode, 0, 1)

      this.mergerNode.connect(this.processorNode)
      this.processorNode.connect(this.audioCtx.destination)
      return true
    } catch (err: any) {
      console.error('[AudioRecorder] Mic error:', err)
      this.callbacks.onError(
        err?.message || 'Tidak dapat mengakses mikrofon. Pastikan mikrofon diizinkan di Windows.'
      )
      return false
    }
  }

  private async finalizeUtterance(
    inputSampleRate: number,
    durationMs: number,
    hitMaxCap: boolean
  ): Promise<void> {
    const chunks = this.activeChunks
    this.resetUtterance(hitMaxCap)

    if (durationMs < 260 || chunks.length < 3) {
      return
    }

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
    const merged = new Float32Array(totalLen)
    let offset = 0
    for (const c of chunks) {
      merged.set(c, offset)
      offset += c.length
    }

    const pcm16k = await resampleAntiAliased16kHz(merged, inputSampleRate)
    const wavBase64 = encodeWavBase64(pcm16k, 16000)
    this.callbacks.onUtterance(pcm16k, wavBase64)
  }

  public stop(): void {
    this.resetUtterance(false)
    if (this.resumeWatchdog) {
      window.clearInterval(this.resumeWatchdog)
      this.resumeWatchdog = null
    }
    if (this.processorNode) {
      this.processorNode.disconnect()
      this.processorNode = null
    }
    if (this.mergerNode) {
      this.mergerNode.disconnect()
      this.mergerNode = null
    }
    if (this.vadLowpassNode) {
      this.vadLowpassNode.disconnect()
      this.vadLowpassNode = null
    }
    if (this.vadHighpassNode) {
      this.vadHighpassNode.disconnect()
      this.vadHighpassNode = null
    }
    if (this.recHighpassNode) {
      this.recHighpassNode.disconnect()
      this.recHighpassNode = null
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
  }
}

/**
 * Hardware-grade anti-aliased Sinc downsampling via Chromium's native OfflineAudioContext.
 */
async function resampleAntiAliased16kHz(
  samples: Float32Array,
  fromRate: number
): Promise<Float32Array> {
  const targetRate = 16000
  if (fromRate === targetRate) return samples

  try {
    const targetLength = Math.max(1, Math.ceil((samples.length * targetRate) / fromRate))
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate)
    const audioBuffer = offlineCtx.createBuffer(1, samples.length, fromRate)
    audioBuffer.getChannelData(0).set(samples)

    const src = offlineCtx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(offlineCtx.destination)
    src.start(0)

    const rendered = await offlineCtx.startRendering()
    const out = new Float32Array(rendered.length)
    out.set(rendered.getChannelData(0))
    return out
  } catch {
    const ratio = fromRate / targetRate
    const newLength = Math.round(samples.length / ratio)
    const result = new Float32Array(newLength)
    for (let i = 0; i < newLength; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.min(samples.length, Math.ceil((i + 1) * ratio))
      let sum = 0
      for (let j = start; j < end; j++) sum += samples[j]
      result[i] = end > start ? sum / (end - start) : 0
    }
    return result
  }
}

function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  const gain = peak > 0.004 ? Math.min(20, 0.88 / peak) : 1

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
