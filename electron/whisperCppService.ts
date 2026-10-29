import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssistantSettings, ShortcutItem } from '../src/types/assistant'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface WhisperCppModelSpec {
  id: 'whisper-cpp-small' | 'whisper-cpp-base' | 'whisper-cpp-turbo'
  filename: string
  label: string
  sizeMB: number
  downloadUrl: string
}

export const WHISPER_CPP_MODELS: Record<string, WhisperCppModelSpec> = {
  'whisper-cpp-small': {
    id: 'whisper-cpp-small',
    filename: 'ggml-small-q5_1.bin',
    label: 'whisper.cpp Small Q5 (Akurat • Bahasa Indonesia)',
    sizeMB: 181,
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
  },
  'whisper-cpp-base': {
    id: 'whisper-cpp-base',
    filename: 'ggml-base-q8_0.bin',
    label: 'whisper.cpp Base Q8 (Cepat & Ringan)',
    sizeMB: 78,
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin'
  },
  'whisper-cpp-turbo': {
    id: 'whisper-cpp-turbo',
    filename: 'ggml-large-v3-turbo-q5_0.bin',
    label: 'whisper.cpp Large-v3-Turbo Q5 (Akurasi Maksimal)',
    sizeMB: 547,
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
  }
}

const WHISPER_BIN_RELEASE_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'

export function resolveWhisperCppSpec(
  engine: AssistantSettings['sttEngine']
): WhisperCppModelSpec {
  if (engine === 'whisper-cpp-turbo') return WHISPER_CPP_MODELS['whisper-cpp-turbo']
  if (engine === 'whisper-cpp-base' || engine === 'local-whisper-tiny') {
    return WHISPER_CPP_MODELS['whisper-cpp-base']
  }
  return WHISPER_CPP_MODELS['whisper-cpp-small']
}

/**
 * Builds a concise Bahasa Indonesia baku + command vocabulary conditioning prompt
 * (< 160 tokens, well inside Whisper's 224-token prompt window) so unclear syllables
 * decode directly into valid Indonesian words, numbers, and app names.
 */
export function buildIndonesianWhisperPrompt(
  wakeWord = 'Woii Dann',
  shortcuts: ShortcutItem[] = []
): string {
  const customNames = shortcuts
    .filter((s) => !s.builtIn)
    .map((s) => s.name.trim())
    .filter(Boolean)
    .slice(0, 8)
  const extraApps = customNames.length > 0 ? `, ${customNames.join(', ')}` : ''

  return (
    `${wakeWord}, Woi Dan, Halo Dan. ` +
    `Pause, Play, Next, Previous, Jeda musik, Lanjutkan musik, Lagu selanjutnya, Lagu sebelumnya. ` +
    `Buka YouTube, Buka YouTube Music, Buka Spotify, Buka Kalkulator, Buka Notepad, ` +
    `Buka WhatsApp, Buka Visual Studio Code, Buka Google Chrome, Buka File Explorer${extraApps}. ` +
    `Atur timer 5 menit, Pasang pengingat 10 menit, satu, dua, tiga, empat, lima, enam, ` +
    `tujuh, delapan, sembilan, sepuluh, lima belas, dua puluh, tiga puluh menit, detik, jam. ` +
    `Catat jadwal rapat besok pagi, Tambah tugas baru, Lihat daftar tugas, Baca catatan, ` +
    `Lagu apa ini, Matikan lirik, Nyalakan lirik, Jam berapa sekarang, Pergi sana, Minggir dulu, Cabut dulu, Terima kasih.`
  )
}

export class WhisperCppService {
  private serverProc: ChildProcess | null = null
  private serverPort: number | null = null
  private activeModelPath: string | null = null
  private startupPromise: Promise<void> | null = null
  private downloadPromises = new Map<string, Promise<string>>()
  private userDataDir: string

  constructor(
    userDataDir: string,
    private onProgress?: (info: {
      status: 'idle' | 'loading' | 'ready' | 'error'
      progress: number
      model: string
      message: string
    }) => void
  ) {
    this.userDataDir = userDataDir
  }

  private getOptimalThreads(): number {
    const logical = os.cpus()?.length || 4
    // Sweet spot on modern hybrid Intel/AMD laptop CPUs
    return Math.min(10, Math.max(4, Math.round(logical * 0.62)))
  }

  /**
   * Computes tight 32-aligned Whisper encoder audio_ctx frames (50 frames = 1.0s)
   * from 16kHz 16-bit mono WAV byte length. Cuts self-attention latency ~6x (4s -> ~650ms)
   * and prevents 25s of trailing silence padding from diluting decoder probabilities!
   */
  private computeAudioCtx(wavByteLength: number): number {
    const pcmBytes = Math.max(0, wavByteLength - 44)
    const durationSec = Math.max(1.0, pcmBytes / 32000)
    const neededFrames = Math.ceil(durationSec * 50) + 64
    const aligned32 = Math.ceil(neededFrames / 32) * 32
    return Math.min(1500, Math.max(192, aligned32))
  }

  public resolveBinDir(): string {
    const candidates = [
      path.join(process.cwd(), 'bin', 'whisper-cpp'),
      path.join(__dirname, '..', 'bin', 'whisper-cpp'),
      path.join((process as any).resourcesPath || '', 'bin', 'whisper-cpp'),
      path.join(this.userDataDir, 'whisper-cpp-bin')
    ]

    for (const dir of candidates) {
      if (
        dir &&
        (fs.existsSync(path.join(dir, 'whisper-server.exe')) ||
          fs.existsSync(path.join(dir, 'whisper-cli.exe')))
      ) {
        return dir
      }
    }

    return path.join(this.userDataDir, 'whisper-cpp-bin')
  }

  public async ensureBinaries(modelLabel: string): Promise<string> {
    const dir = this.resolveBinDir()
    const serverExe = path.join(dir, 'whisper-server.exe')
    const cliExe = path.join(dir, 'whisper-cli.exe')
    if (fs.existsSync(serverExe) || fs.existsSync(cliExe)) {
      return dir
    }

    // Auto-download official prebuilt Windows x64 whisper.cpp binaries if missing
    fs.mkdirSync(dir, { recursive: true })
    const zipPath = path.join(dir, 'whisper-bin-x64.zip')
    this.onProgress?.({
      status: 'loading',
      progress: 5,
      model: modelLabel,
      message: 'Mengunduh mesin native C++ whisper.cpp (8 MB)...'
    })

    const res = await fetch(WHISPER_BIN_RELEASE_URL)
    if (!res.ok) {
      throw new Error(`Gagal mengunduh binary whisper.cpp (HTTP ${res.status})`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(zipPath, buf)

    await new Promise<void>((resolve, reject) => {
      execFile('tar.exe', ['-xf', zipPath, '-C', dir], { windowsHide: true }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    try {
      fs.unlinkSync(zipPath)
    } catch {}

    const relDir = path.join(dir, 'Release')
    if (fs.existsSync(relDir)) {
      for (const f of fs.readdirSync(relDir)) {
        if (/^(whisper-server\.exe|whisper-cli\.exe|whisper\.dll|ggml.*\.dll|SDL2\.dll)$/i.test(f)) {
          fs.renameSync(path.join(relDir, f), path.join(dir, f))
        } else {
          try {
            fs.unlinkSync(path.join(relDir, f))
          } catch {}
        }
      }
      try {
        fs.rmdirSync(relDir)
      } catch {}
    }

    return dir
  }

  public getModelsDir(): string {
    const dir = path.join(this.userDataDir, 'whisper-cpp-models')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  public async ensureModelFile(spec: WhisperCppModelSpec): Promise<string> {
    const dest = path.join(this.getModelsDir(), spec.filename)
    const minBytes = Math.floor(spec.sizeMB * 0.9 * 1024 * 1024)

    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size
      if (size >= minBytes) {
        return dest
      }
    }

    const existingJob = this.downloadPromises.get(spec.id)
    if (existingJob) return existingJob

    const job = (async () => {
      const partPath = `${dest}.part`
      try {
        this.onProgress?.({
          status: 'loading',
          progress: 2,
          model: spec.id,
          message: `Mengunduh model offline ${spec.label} (0%)...`
        })

        const res = await fetch(spec.downloadUrl)
        if (!res.ok || !res.body) {
          throw new Error(`Gagal mengunduh model ${spec.filename} (HTTP ${res.status})`)
        }

        const total = Number(res.headers.get('content-length') || spec.sizeMB * 1024 * 1024)
        const out = fs.createWriteStream(partPath)
        const reader = res.body.getReader()
        let downloaded = 0
        let lastReportedPct = -1

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            out.write(Buffer.from(value))
            downloaded += value.byteLength
            const pct = Math.min(98, Math.max(1, Math.round((downloaded / total) * 100)))
            if (pct !== lastReportedPct) {
              lastReportedPct = pct
              const mbDone = (downloaded / 1048576).toFixed(0)
              const mbTotal = (total / 1048576).toFixed(0)
              this.onProgress?.({
                status: 'loading',
                progress: pct,
                model: spec.id,
                message: `Mengunduh ${spec.filename} (${mbDone}/${mbTotal} MB • ${pct}%)...`
              })
            }
          }
        }

        await new Promise<void>((resolve, reject) => {
          out.end((err?: Error | null) => (err ? reject(err) : resolve()))
        })

        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest)
        }
        fs.renameSync(partPath, dest)
        return dest
      } catch (err) {
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
        } catch {}
        throw err
      } finally {
        this.downloadPromises.delete(spec.id)
      }
    })()

    this.downloadPromises.set(spec.id, job)
    return job
  }

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.unref()
      srv.on('error', reject)
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        srv.close(() => resolve(port))
      })
    })
  }

  private async isServerHealthy(port: number): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 900)
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ctrl.signal })
      clearTimeout(timer)
      // whisper-server returns 200 or 404 HTML when HTTP listener is up
      return res.status < 500
    } catch {
      return false
    }
  }

  public async ensureReady(
    spec: WhisperCppModelSpec,
    initialPrompt: string
  ): Promise<void> {
    const binDir = await this.ensureBinaries(spec.id)
    const modelPath = await this.ensureModelFile(spec)

    if (
      this.serverProc &&
      !this.serverProc.killed &&
      this.serverPort &&
      this.activeModelPath === modelPath &&
      (await this.isServerHealthy(this.serverPort))
    ) {
      return
    }

    if (this.startupPromise && this.activeModelPath === modelPath) {
      return this.startupPromise
    }

    this.stopServer()
    this.activeModelPath = modelPath

    const serverExe = path.join(binDir, 'whisper-server.exe')
    if (!fs.existsSync(serverExe)) {
      // CLI-only mode ready
      this.onProgress?.({
        status: 'ready',
        progress: 100,
        model: spec.id,
        message: `Siap • ${spec.label} (100% Offline)`
      })
      return
    }

    this.startupPromise = (async () => {
      try {
        this.onProgress?.({
          status: 'loading',
          progress: 96,
          model: spec.id,
          message: `Memuat ${spec.label} ke memori C++...`
        })

        const port = await this.findFreePort()
        const threads = String(this.getOptimalThreads())
        const args = [
          '-m',
          modelPath,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '-t',
          threads,
          '-mc',
          '64',
          '-bo',
          '1',
          '-bs',
          '1',
          '-l',
          'id',
          '-nt',
          '-sns',
          '-fa',
          '--prompt',
          initialPrompt,
          '--carry-initial-prompt'
        ]

        const child = spawn(serverExe, args, {
          cwd: binDir,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let stderrLog = ''
        child.stderr?.on('data', (chunk) => {
          if (stderrLog.length < 2000) stderrLog += chunk.toString()
        })

        child.on('exit', () => {
          if (this.serverProc === child) {
            this.serverProc = null
            this.serverPort = null
          }
        })

        this.serverProc = child
        this.serverPort = port

        // Wait up to 12s for whisper-server HTTP socket to become ready
        const deadline = Date.now() + 12000
        let ready = false
        while (Date.now() < deadline) {
          if (child.exitCode !== null) {
            throw new Error(`whisper-server keluar lebih awal: ${stderrLog.slice(-240)}`)
          }
          if (await this.isServerHealthy(port)) {
            ready = true
            break
          }
          await new Promise((r) => setTimeout(r, 140))
        }

        if (!ready) {
          throw new Error('Waktu tunggu inisialisasi whisper-server habis')
        }

        this.onProgress?.({
          status: 'ready',
          progress: 100,
          model: spec.id,
          message: `Siap • ${spec.label} (100% Offline)`
        })
      } catch (err: any) {
        console.warn('[WhisperCpp] Server daemon fallback to CLI:', err?.message || err)
        this.stopServer()
        // Even if server daemon couldn't bind, CLI binary is ready offline!
        this.onProgress?.({
          status: 'ready',
          progress: 100,
          model: spec.id,
          message: `Siap • ${spec.label} (CLI Offline)`
        })
      } finally {
        this.startupPromise = null
      }
    })()

    return this.startupPromise
  }

  public async transcribeWavBuffer(
    wavBuffer: Buffer,
    spec: WhisperCppModelSpec,
    prompt: string
  ): Promise<string> {
    await this.ensureReady(spec, prompt)

    const audioCtx = String(this.computeAudioCtx(wavBuffer.length))

    // 1. Fast path: persistent in-memory whisper-server.exe (~550-750ms, zero model reload!)
    if (this.serverProc && this.serverPort) {
      try {
        const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' })
        const form = new FormData()
        form.append('file', blob, 'utterance.wav')
        form.append('language', 'id')
        form.append('temperature', '0.0')
        form.append('temperature_inc', '0.4')
        form.append('audio_ctx', audioCtx)
        form.append('response_format', 'json')
        form.append('prompt', prompt)

        const ctrl = new AbortController()
        const timeout = setTimeout(() => ctrl.abort(), 15000)
        const res = await fetch(`http://127.0.0.1:${this.serverPort}/inference`, {
          method: 'POST',
          body: form,
          signal: ctrl.signal
        })
        clearTimeout(timeout)

        if (res.ok) {
          const data = (await res.json()) as { text?: string }
          return this.dedupeLoop((data.text || '').trim())
        }
      } catch (srvErr) {
        console.warn('[WhisperCpp] HTTP inference error, retrying via whisper-cli.exe:', srvErr)
      }
    }

    // 2. Guaranteed offline fallback: direct whisper-cli.exe invocation
    return this.transcribeViaCli(wavBuffer, spec, prompt)
  }

  private async transcribeViaCli(
    wavBuffer: Buffer,
    spec: WhisperCppModelSpec,
    prompt: string
  ): Promise<string> {
    const binDir = await this.ensureBinaries(spec.id)
    const modelPath = await this.ensureModelFile(spec)
    const cliExe = path.join(binDir, 'whisper-cli.exe')

    const tmpWav = path.join(
      os.tmpdir(),
      `dann-utt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`
    )
    fs.writeFileSync(tmpWav, wavBuffer)

    try {
      const threads = String(this.getOptimalThreads())
      const audioCtx = String(this.computeAudioCtx(wavBuffer.length))
      const args = [
        '-m',
        modelPath,
        '-f',
        tmpWav,
        '-l',
        'id',
        '-t',
        threads,
        '-mc',
        '64',
        '-ac',
        audioCtx,
        '-bo',
        '1',
        '-bs',
        '1',
        '-nt',
        '-np',
        '-sns',
        '-fa',
        '--prompt',
        prompt
      ]

      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          cliExe,
          args,
          { cwd: binDir, windowsHide: true, timeout: 20000, encoding: 'utf8' },
          (err, out) => {
            if (err) reject(err)
            else resolve(out || '')
          }
        )
      })

      const joined = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
      return this.dedupeLoop(joined)
    } finally {
      try {
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav)
      } catch {}
    }
  }

  private dedupeLoop(text: string): string {
    if (!text) return ''
    // Collapse repeated sentence/clause loops (e.g. "Buka Kaku later. Buka Kaku later...") -> "Buka Kaku later."
    const collapsed = text.replace(/^(.{3,50}?[.!?]?)(?:\s+\1){2,}.*$/i, '$1')
    return collapsed.trim()
  }

  public stopServer(): void {
    if (this.serverProc) {
      try {
        this.serverProc.kill()
      } catch {}
      this.serverProc = null
      this.serverPort = null
    }
  }
}
