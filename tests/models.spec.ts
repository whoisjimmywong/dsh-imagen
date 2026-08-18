import { describe, expect, it } from 'vitest'
import { discoverImageModels, matchesImageModel, modelIdsFromPayload } from '../src/models.ts'

describe('matchesImageModel', () => {
  it('recognizes common image model names', () => {
    for (const id of [
      'gpt-image-2', 'dall-e-3', 'flux-2-pro', 'flux.1-dev', 'sdxl-turbo',
      'stable-diffusion-3.5-large', 'imagen-4', 'qwen-image-2.0', 'step-image-edit-2',
      'agnes-image-2.1-flash', 'seedream-4.0', 'hunyuan-image-3.0', 'wanx-v1',
      'cogview-4', 'kolors', 'pixart-alpha', 'draw-anything', 't2i-flux',
    ]) {
      expect(matchesImageModel(id), id).toBe(true)
    }
  })

  it('rejects non-image models', () => {
    for (const id of ['deepseek-chat', 'gpt-4o', 'qwen-vl-max', 'claude-3.5-sonnet', 'text-embedding-3', 'whisper-1', 'gpt-4o-vision-preview']) {
      expect(matchesImageModel(id), id).toBe(false)
    }
  })

  it('applies extra patterns', () => {
    expect(matchesImageModel('my-photo-2024', ['my-photo-.*'])).toBe(true)
    expect(matchesImageModel('my-photo-2024', [])).toBe(false)
    expect(matchesImageModel('weird-name', ['['])).toBe(false) // malformed pattern ignored
  })
})

describe('discoverImageModels', () => {
  it('filters and dedupes a model list', () => {
    const ids = ['gpt-image-2', 'gpt-4o', 'flux-1', 'flux-1', 'qwen-vl-max']
    expect(discoverImageModels(ids)).toEqual(['flux-1', 'gpt-image-2'])
  })
})

describe('modelIdsFromPayload', () => {
  it('parses the common {data:[{id}]} shape', () => {
    expect(modelIdsFromPayload({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
    expect(modelIdsFromPayload({ data: 'nope' })).toEqual([])
    expect(modelIdsFromPayload(null)).toEqual([])
  })
})
