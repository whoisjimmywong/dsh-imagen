/**
 * Image-model discovery for OpenAI-compatible endpoints: list `GET /models`,
 * keep ids that look like image generators (name-pattern matching, no
 * hardcoded model lists), and let deployments add their own patterns.
 * @module dsh-imagen/models
 */

/** Curated substrings that mark an id as an image generator. */
const IMAGE_TOKENS = [
  'image', 'img', 'draw', 't2i', 'i2i', 'txt2img', 'img2img',
  'dall', 'dalle', 'gpt-image', 'flux', 'sdxl', 'sd3', 'sd-3',
  'stable', 'diffusion', 'imagen', 'pixart', 'kolors', 'cogview',
  'seedream', 'wanx', 'wan2', 'wan-2', 'hunyuan-image', 'jimeng',
  'doubao', 'recraft', 'ideogram', 'leonardo', 'playground',
  'firefly', 'photoreal', 'pixel-art', 'midjourney', 'nano-banana',
  'gemini-image', 'art-gen', 'agnes-image', 'step-image', 'qwen-image',
] as const

/** Substrings that positively mark a model as NOT an image generator. */
const EXCLUDE_TOKENS = [
  'vision', 'understand', 'vlm', 'ocr', 'chat', 'embed', 'rerank',
  'whisper', 'tts', 'asr', 'caption', 'describe', 'audio', 'video',
  'rerank', 'instruct', 'agent', 'tool', 'reasoning',
] as const

function hasToken(value: string, tokens: readonly string[]): boolean {
  const lower = value.toLowerCase()
  return tokens.some(token => lower.includes(token))
}

/** Whether a model id should be treated as an image generator. */
export function matchesImageModel(id: string, extraPatterns: readonly string[] = []): boolean {
  if (id.trim() === '') return false
  if (hasToken(id, EXCLUDE_TOKENS)) return false
  if (hasToken(id, IMAGE_TOKENS)) return true
  if (extraPatterns.length > 0) {
    for (const pattern of extraPatterns) {
      try {
        if (new RegExp(pattern, 'i').test(id)) return true
      } catch {
        // A malformed extra pattern is ignored rather than failing discovery.
      }
    }
  }
  return false
}

/** Filter and sort a raw `GET /models` id list into image model ids. */
export function discoverImageModels(ids: readonly string[], extraPatterns: readonly string[] = []): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue
    seen.add(id)
    if (matchesImageModel(id, extraPatterns)) result.push(id)
  }
  return result.sort()
}

/** Parse the common `{data: [{id, ...}]}` shape of an OpenAI-compatible models list. */
export function modelIdsFromPayload(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  const data = (value as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const ids: string[] = []
  for (const entry of data) {
    if (typeof entry === 'object' && entry !== null) {
      const id = (entry as { id?: unknown }).id
      if (typeof id === 'string' && id !== '') ids.push(id)
    }
  }
  return ids
}
