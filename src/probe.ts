/**
 * Minimal, dependency-free image dimension probing for PNG, JPEG, WebP and
 * GIF headers — used to enrich saved image metadata for the browser card.
 * Returns `undefined` for anything unrecognized instead of guessing.
 * @module dsh-imagen/probe
 */

export interface ImageDimensions {
  width: number
  height: number
}

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0
}

function u32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index]!)
  }
  return out
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return undefined
  }
  if (ascii(bytes, 12, 4) !== 'IHDR') return undefined
  return { width: u32(bytes, 16), height: u32(bytes, 20) }
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]!
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return undefined
    const length = u16(bytes, offset + 2)
    if (length < 2) return undefined
    const sof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    if (sof && offset + 9 < bytes.length) {
      return { height: u16(bytes, offset + 5), width: u16(bytes, offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: u16(bytes, 26) & 0x3fff, height: u16(bytes, 28) & 0x3fff }
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const bits = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16) | (bytes[27]! << 24)) >>> 0
    return { width: (bits & 0xffffff) + 1, height: ((bits >> 24) & 0xffffff) + 1 }
  }
  return undefined
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'GIF') return undefined
  return { width: u16(bytes, 6), height: u16(bytes, 8) }
}

/** Probe image dimensions from header bytes; `undefined` when unrecognized. */
export function probeDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 12) return undefined
  return pngDimensions(bytes)
    ?? jpegDimensions(bytes)
    ?? webpDimensions(bytes)
    ?? gifDimensions(bytes)
}

/** Best-effort media type from header bytes; defaults to `application/octet-stream`. */
export function sniffMediaType(bytes: Uint8Array): string {
  if (bytes.length >= 8) {
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png'
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
    if (ascii(bytes, 0, 3) === 'GIF') return 'image/gif'
  }
  return 'application/octet-stream'
}

/** Map an output format to its media type. */
export function mediaTypeOf(format: 'png' | 'jpeg' | 'webp'): 'image/png' | 'image/jpeg' | 'image/webp' {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}
