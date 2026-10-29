import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const UPLOADED_SRC =
  process.argv[2] ||
  'C:/Users/Thin 15-1427/.gemini/antigravity/brain/6aa14e3a-d9ae-42c4-908d-798298f0d590/.user_uploaded/media_1793281695947_f2f23cf1.png'

function buildIcoBuffer(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length
  const headerSize = 6
  const dirEntrySize = 16
  let dataOffset = headerSize + count * dirEntrySize

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // Reserved
  header.writeUInt16LE(1, 2) // Type 1 = ICO
  header.writeUInt16LE(count, 4)

  const dirEntries = []
  const payloads = []

  for (const { size, buf } of pngBuffersWithSizes) {
    const entry = Buffer.alloc(dirEntrySize)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // Width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // Height
    entry.writeUInt8(0, 2) // Palette colors
    entry.writeUInt8(0, 3) // Reserved
    entry.writeUInt16LE(1, 4) // Color planes
    entry.writeUInt16LE(32, 6) // Bits per pixel (RGBA)
    entry.writeUInt32LE(buf.length, 8) // Image byte size
    entry.writeUInt32LE(dataOffset, 12) // Offset in file
    dirEntries.push(entry)
    payloads.push(buf)
    dataOffset += buf.length
  }

  return Buffer.concat([header, ...dirEntries, ...payloads])
}

async function main() {
  const { data, info } = await sharp(UPLOADED_SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const total = w * h
  const cleaned = Buffer.from(data)

  // Connected-components filter: remove tiny stray specks (< 200 px) outside the main head
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)

  for (let i = 0; i < total; i++) {
    if (visited[i] || cleaned[i * 4 + 3] < 16) continue
    const comp = []
    let head = 0
    let tail = 0
    visited[i] = 1
    queue[tail++] = i

    while (head < tail) {
      const cur = queue[head++]
      comp.push(cur)
      const cx = cur % w
      const cy = (cur - cx) / w
      const neighbors = [
        cx > 0 ? cur - 1 : -1,
        cx + 1 < w ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy + 1 < h ? cur + w : -1
      ]
      for (const nb of neighbors) {
        if (nb >= 0 && !visited[nb] && cleaned[nb * 4 + 3] >= 16) {
          visited[nb] = 1
          queue[tail++] = nb
        }
      }
    }

    if (comp.length < 200) {
      for (const idx of comp) {
        cleaned[idx * 4 + 3] = 0
      }
    }
  }

  // Tight bounding box of non-transparent pixels
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cleaned[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1

  const croppedPng = await sharp(cleaned, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .png()
    .toBuffer()

  // Center into a square 512x512 master icon with crisp ~3% padding
  const masterSize = 512
  const innerMax = Math.round(masterSize * 0.94)
  const fittedBuf = await sharp(croppedPng)
    .resize(innerMax, innerMax, {
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    })
    .png()
    .toBuffer()

  const master512 = await sharp({
    create: {
      width: masterSize,
      height: masterSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: fittedBuf, gravity: 'center' }])
    .png()
    .toBuffer()

  // Build multi-resolution ICO frames
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoFrames = []
  for (const sz of icoSizes) {
    const buf = await sharp(master512)
      .resize(sz, sz, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()
    icoFrames.push({ size: sz, buf })
  }
  const icoBuffer = buildIcoBuffer(icoFrames)

  const tray64 = await sharp(master512)
    .resize(64, 64, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()

  fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true })
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(ROOT, 'src', 'assets'), { recursive: true })

  fs.writeFileSync(path.join(ROOT, 'public', 'icon.png'), master512)
  fs.writeFileSync(path.join(ROOT, 'public', 'icon-tray.png'), tray64)
  fs.writeFileSync(path.join(ROOT, 'public', 'icon.ico'), icoBuffer)

  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), master512)
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), icoBuffer)
  fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'icon.png'), master512)

  console.log(
    `[Icon] Generated spotless 512x512 icon.png & multi-size icon.ico (${icoBuffer.length} bytes) from crop ${cropW}x${cropH}`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
