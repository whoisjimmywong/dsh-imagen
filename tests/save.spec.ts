import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertInside, renderNameTemplate, resolveSaveDir, saveImageFile, slugify, timestampLabel } from '../src/save.ts'

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'imagen-test-'))
}

describe('slugify', () => {
  it('normalizes prompts into safe slugs', () => {
    expect(slugify('A cat on the moon!')).toBe('a-cat-on-the-moon')
    expect(slugify('    ')).toBe('image')
    expect(slugify('中文提示词')).toBe('image')
  })
})

describe('renderNameTemplate', () => {
  it('renders {prompt} and {timestamp}', () => {
    const date = new Date('2026-08-17T12:34:56')
    expect(renderNameTemplate('{prompt}-{timestamp}', 'A Cat!', date)).toBe('a-cat-20260817-123456')
    expect(timestampLabel(date)).toBe('20260817-123456')
  })
})

describe('assertInside / resolveSaveDir', () => {
  it('rejects escaping paths', () => {
    const ws = 'C:\\ws'
    expect(() => assertInside(ws, 'C:\\ws\\ok')).not.toThrow()
    expect(() => assertInside(ws, 'C:\\ws\\..\\outside')).toThrow(/escapes/)
    expect(resolveSaveDir('C:\\ws', 'generated-images')).toBe('C:\\ws\\generated-images')
    expect(() => resolveSaveDir('C:\\ws', '..\\evil')).toThrow()
    expect(() => resolveSaveDir('C:\\ws', '.')).toThrow()
  })
})

describe('saveImageFile', () => {
  it('writes files with unique names and reports relative paths', async () => {
    const ws = await tempWorkspace()
    try {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
      const first = await saveImageFile(ws, 'generated-images', 'A Cat', '{prompt}-{timestamp}', 'png', bytes)
      const second = await saveImageFile(ws, 'generated-images', 'A Cat', '{prompt}-{timestamp}', 'png', bytes)
      expect(first.relPath).toMatch(/^generated-images\/a-cat-\d{8}-\d{6}\.png$/)
      expect(second.relPath).toMatch(/-2\.png$/)
      expect(first.path).not.toBe(second.path)
      const written = await readFile(first.path)
      expect([...written]).toEqual([...bytes])
      const files = await readdir(join(ws, 'generated-images'))
      expect(files).toHaveLength(2)
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
