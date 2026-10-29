import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ASSETS_DIR = path.join(ROOT, 'assets')
const OUT_DIR = path.join(ROOT, 'public', 'character')

fs.mkdirSync(OUT_DIR, { recursive: true })

const JOBS = [
  { src: '1.jpg', out: 'pose-idle.png', extraSeeds: [] },
  // 2.jpg has an enclosed background gap between the raised right arm, headphone, and shoulder
  { src: '2.jpg', out: 'pose-listen.png', extraSeeds: [[0.35, 0.55]] },
  { src: '3.jpg', out: 'pose-alert.png', extraSeeds: [] },
  { src: '4.jpg', out: 'pose-idea.png', extraSeeds: [] }
]

function isBackgroundCandidate(r, g, b) {
  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  const diff = maxC - minC
  // Pure white, near-white JPEG artifacts, and the faint pale-blue guide circle
  if (minC >= 205 && diff <= 34) return true
  // Slightly darker anti-alias grey right next to white
  if (minC >= 185 && diff <= 18) return true
  return false
}

async function processImage({ src, out, extraSeeds }) {
  const inputPath = path.join(ASSETS_DIR, src)
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const total = w * h
  const visited = new Uint8Array(total)
  const isBg = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0

  const tryPush = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return
    const idx = y * w + x
    if (visited[idx]) return
    visited[idx] = 1
    const p = idx * 4
    if (isBackgroundCandidate(data[p], data[p + 1], data[p + 2])) {
      isBg[idx] = 1
      queue[tail++] = idx
    }
  }

  // Seed outer borders
  for (let x = 0; x < w; x++) {
    tryPush(x, 0)
    tryPush(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y)
    tryPush(w - 1, y)
  }

  // Seed known enclosed background holes (e.g. under raised arm in 2.jpg)
  for (const [nx, ny] of extraSeeds) {
    const sx = Math.round(nx * w)
    const sy = Math.round(ny * h)
    const sIdx = sy * w + sx
    const sp = sIdx * 4
    console.log(
      `[${src}] Extra seed (${sx},${sy}) RGB=(${data[sp]},${data[sp + 1]},${data[sp + 2]})`
    )
    tryPush(sx, sy)
  }

  // BFS flood-fill
  while (head < tail) {
    const curr = queue[head++]
    const cx = curr % w
    const cy = (curr - cx) / w
    if (cx > 0) tryPush(cx - 1, cy)
    if (cx + 1 < w) tryPush(cx + 1, cy)
    if (cy > 0) tryPush(cx, cy - 1)
    if (cy + 1 < h) tryPush(cx, cy + 1)
  }

  // Apply transparency + clean white fringe on 1px silhouette edge
  const outBuf = Buffer.from(data)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const p = idx * 4
      if (isBg[idx]) {
        outBuf[p + 3] = 0
      } else {
        // Check how many immediate 8-neighbors are background
        let bgNeighbors = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h || isBg[ny * w + nx]) {
              bgNeighbors++
            }
          }
        }
        if (bgNeighbors > 0) {
          const r = outBuf[p]
          const g = outBuf[p + 1]
          const b = outBuf[p + 2]
          const lum = (r + g + b) / 3
          const diff = Math.max(r, g, b) - Math.min(r, g, b)
          // Soften bright neutral edge pixels so there is zero white halo on dark desktop!
          if (lum > 140 && diff < 35) {
            const factor = Math.max(0, (215 - lum) / 75)
            outBuf[p + 3] = Math.round(255 * factor)
          } else if (bgNeighbors >= 4 && lum > 110 && diff < 25) {
            outBuf[p + 3] = 150
          }
        }
      }
    }
  }

  // Find bounding box of opaque pixels so we crop cleanly while keeping bottom torso aligned
  let minX = w,
    maxX = 0,
    minY = h,
    maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (outBuf[(y * w + x) * 4 + 3] > 15) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  const padTop = Math.max(0, minY - 16)
  const padLeft = Math.max(0, minX - 16)
  const padRight = Math.min(w - 1, maxX + 16)
  const padBottom = maxY // Keep bottom flush with torso!

  const cropW = padRight - padLeft + 1
  const cropH = padBottom - padTop + 1

  const outPath = path.join(OUT_DIR, out)
  await sharp(outBuf, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: padLeft, top: padTop, width: cropW, height: cropH })
    .resize({ height: 520, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toFile(outPath)

  console.log(`✓ Saved ${out} (${cropW}x${cropH} -> resized height 520)`)
}

for (const job of JOBS) {
  await processImage(job)
}
