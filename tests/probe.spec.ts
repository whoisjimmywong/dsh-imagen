import { describe, expect, it } from 'vitest'
import { probeDimensions, sniffMediaType } from '../src/probe.ts'

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0) // signature
  bytes.set([0, 0, 0, 13], 8) // IHDR length
  bytes.set([73, 72, 68, 82], 12) // 'IHDR'
  bytes[16] = (width >>> 24) & 0xff
  bytes[17] = (width >>> 16) & 0xff
  bytes[18] = (width >>> 8) & 0xff
  bytes[19] = width & 0xff
  bytes[20] = (height >>> 24) & 0xff
  bytes[21] = (height >>> 16) & 0xff
  bytes[22] = (height >>> 8) & 0xff
  bytes[23] = height & 0xff
  return bytes
}

describe('probeDimensions', () => {
  it('parses PNG dimensions', () => {
    const bytes = pngBytes(1024, 768)
    expect(probeDimensions(bytes)).toEqual({ width: 1024, height: 768 })
    expect(sniffMediaType(bytes)).toBe('image/png')
  })

  it('parses JPEG dimensions from a SOF marker', () => {
    // ff d8 ... ff c0 <len hi> <len lo> <precision> <h hi> <h lo> <w hi> <w lo>
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x04, 0x00, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00])
    expect(probeDimensions(bytes)).toEqual({ width: 4, height: 2 })
    expect(sniffMediaType(bytes)).toBe('image/jpeg')
  })

  it('parses WebP dimensions', () => {
    // RIFF....WEBPVP8  header with width/height in the VP8 bitstream frame tag
    const bytes = new Uint8Array(30)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    bytes.set([0x56, 0x50, 0x38, 0x20], 12) // 'VP8 '
    // VP8 frame tag (3 bytes) + start code (3 bytes) occupy 20..25;
    // width/height live at 26..29, read big-endian.
    bytes[20] = 0x00
    bytes[21] = 0x00
    bytes[22] = 0x00
    bytes[23] = 0x9d
    bytes[24] = 0x01
    bytes[25] = 0x2a
    bytes[26] = 0x01 // width high
    bytes[27] = 0x2a // width low
    bytes[28] = 0x02 // height high
    bytes[29] = 0x00 // height low
    // width = 0x012a = 298 ; height = 0x0200 = 512
    expect(probeDimensions(bytes)).toEqual({ width: 298, height: 512 })
    expect(sniffMediaType(bytes)).toBe('image/webp')
  })

  it('returns undefined for unknown data', () => {
    expect(probeDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined()
    expect(sniffMediaType(new Uint8Array([1, 2, 3]))).toBe('application/octet-stream')
  })
})
