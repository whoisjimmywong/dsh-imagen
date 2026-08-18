/**
 * Plugin configuration: named image sources (OpenAI-compatible endpoints with
 * DSH credential references), automatic workspace saving, model discovery,
 * default generation parameters and operation bounds.
 *
 * Secrets never live here — every `credential` is a DSH Credential reference
 * resolved per operation through `ctx.credentials`.
 * @module dsh-imagen/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { validateBaseUrl } from './client.ts'
import type { ImageFormat } from './types.ts'

/** Settings document namespace owned by this plugin. */
export const IMAGEN_SETTINGS_NAMESPACE = settingsNamespace('imagen')

/** One configured image source: an OpenAI-compatible API root + credential ref. */
export interface SourceConfig {
  /** API root, e.g. `https://api.stepfun.com/v1`. `/images/generations` and `/models` are appended. */
  baseUrl: string
  /** DSH Credential reference holding the API key (an environment-style name). */
  credential: string
  /** Optional pinned model; when unset the plugin auto-discovers one. */
  model?: string
}

/** Full user-facing configuration; every field is optional and defaults at the schema boundary. */
export interface ImagenConfig {
  /** Named image sources (at least one is required to generate). */
  sources?: Record<string, SourceConfig>
  /** Source used when the agent does not name one; defaults to the first source. */
  defaultSource?: string
  save?: {
    /** Whether generated images are automatically written to the workspace. */
    enabled?: boolean
    /** Save directory, relative to the session workspace. */
    dir?: string
    /** Naming template; supports `{prompt}` and `{timestamp}`. */
    nameTemplate?: string
  }
  discovery?: {
    /** Whether to discover image models via `GET /v1/models` (name-pattern matching). */
    enabled?: boolean
    /** Extra model-name patterns appended to the built-in image model matcher. */
    extraPatterns?: string[]
    /** Discovery cache lifetime in milliseconds. */
    cacheTtlMs?: number
  }
  defaults?: {
    /** Default size for `generate_image` (e.g. `1024x1024`); provider default when unset. */
    size?: string
    /** Default quality (`low` | `medium` | `high` | `auto`). */
    quality?: string
    /** Default output format. */
    outputFormat?: ImageFormat
    /** Default image count per call (1–4). */
    n?: number
  }
  limits?: {
    /** Whole-operation timeout in milliseconds. */
    timeoutMs?: number
    /** Extra attempts after the first (0–5). */
    maxRetries?: number
    /** Exponential backoff base in milliseconds. */
    retryBaseMs?: number
    /** In-flight generation cap; excess calls are rejected immediately. */
    maxConcurrent?: number
    /** Maximum accepted bytes for one returned image. */
    maxImageBytes?: number
    /** Maximum accepted bytes for one reference image / URL download. */
    maxReferenceBytes?: number
  }
}

/** Configuration schema with the documented defaults. */
export const Config: Schema<ImagenConfig> = z.object({
  sources: z.dict(z.object({
    baseUrl: z.string(),
    credential: z.string(),
    model: z.string(),
  })).default({}),
  defaultSource: z.string(),
  save: z.object({
    enabled: z.boolean().default(true),
    dir: z.string().default('generated-images'),
    nameTemplate: z.string().default('{prompt}-{timestamp}'),
  }),
  discovery: z.object({
    enabled: z.boolean().default(true),
    extraPatterns: z.array(z.string()).default([]),
    cacheTtlMs: z.number().default(300_000),
  }),
  defaults: z.object({
    size: z.string(),
    quality: z.string(),
    outputFormat: z.union(['png', 'jpeg', 'webp'] as const).default('png'),
    n: z.number().min(1).max(4).step(1).default(1),
  }),
  limits: z.object({
    timeoutMs: z.number().min(10_000).max(600_000).step(1).default(120_000),
    maxRetries: z.number().min(0).max(5).step(1).default(2),
    retryBaseMs: z.number().min(100).max(30_000).step(1).default(1_000),
    maxConcurrent: z.number().min(1).max(8).step(1).default(2),
    maxImageBytes: z.number().min(65_536).max(268_435_456).step(1).default(20_000_000),
    maxReferenceBytes: z.number().min(16_384).max(268_435_456).step(1).default(10_000_000),
  }),
})

/** Configuration after static validation, with every default materialized. */
export interface ResolvedImagenConfig {
  sources: Record<string, { baseUrl: string; credential: CredentialRef; model?: string }>
  defaultSource?: string
  save: {
    enabled: boolean
    dir: string
    nameTemplate: string
  }
  discovery: {
    enabled: boolean
    extraPatterns: string[]
    cacheTtlMs: number
  }
  defaults: {
    size?: string
    quality?: string
    outputFormat: ImageFormat
    n: number
  }
  limits: {
    timeoutMs: number
    maxRetries: number
    retryBaseMs: number
    maxConcurrent: number
    maxImageBytes: number
    maxReferenceBytes: number
  }
}

const DEFAULT_OUTPUT_FORMAT: ImageFormat = 'png'
const VALID_QUALITY = new Set(['auto', 'low', 'medium', 'high'])

/** Validate one source definition; returns the normalized source or throws. */
export function resolveSource(value: SourceConfig): { baseUrl: string; credential: CredentialRef; model?: string } {
  const baseUrl = validateBaseUrl(value.baseUrl)
  let credential: CredentialRef
  try {
    credential = credentialRef(value.credential.trim())
  } catch (error) {
    throw new TypeError(`source.credential "${value.credential}" is not a valid credential reference`, { cause: error })
  }
  const model = value.model?.trim()
  if (model !== undefined && model.length === 0) {
    throw new TypeError('source.model must not be empty when provided')
  }
  return { baseUrl, credential, ...(model === undefined || model === '' ? {} : { model }) }
}

/**
 * Validate and normalize a config object (partial inputs receive the same
 * defaults the schemastery schema applies). Configuration mistakes fail loud
 * at plugin load.
 * @param config - parsed config with defaults applied.
 * @returns the fully defaulted, validated configuration.
 */
export function resolveConfig(config: ImagenConfig = {}): ResolvedImagenConfig {
  const sources: Record<string, { baseUrl: string; credential: CredentialRef; model?: string }> = {}
  const rawSources = config.sources ?? {}
  for (const [name, source] of Object.entries(rawSources)) {
    if (name.trim() === '') throw new TypeError('source names must not be empty')
    sources[name] = resolveSource(source)
  }
  const save = config.save ?? {}
  const discovery = config.discovery ?? {}
  const defaults = config.defaults ?? {}
  const limits = config.limits ?? {}
  const saveDir = (save.dir ?? 'generated-images').trim()
  if (saveDir === '' || saveDir === '.' || saveDir === '..' || saveDir.includes('..')) {
    throw new TypeError('save.dir must be a plain relative directory inside the workspace')
  }
  const nameTemplate = (save.nameTemplate ?? '{prompt}-{timestamp}').trim()
  if (nameTemplate === '') throw new TypeError('save.nameTemplate must not be empty')
  const extraPatterns = (discovery.extraPatterns ?? [])
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0)
  const size = defaults.size?.trim()
  if (size !== undefined && size !== '' && !/^(\d{2,4})x(\d{2,4})$/.test(size)) {
    throw new TypeError('defaults.size must be auto or WIDTHxHEIGHT')
  }
  const quality = defaults.quality?.trim()
  if (quality !== undefined && quality !== '' && !VALID_QUALITY.has(quality)) {
    throw new TypeError('defaults.quality must be one of auto, low, medium, high')
  }
  const outputFormat = defaults.outputFormat ?? DEFAULT_OUTPUT_FORMAT
  const n = defaults.n ?? 1
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new TypeError('defaults.n must be an integer between 1 and 4')
  const defaultSource = config.defaultSource?.trim()
  if (defaultSource !== undefined && defaultSource !== '' && Object.keys(sources).length > 0 && sources[defaultSource] === undefined) {
    throw new TypeError(`defaultSource "${defaultSource}" is not a configured source`)
  }
  const timeoutMs = limits.timeoutMs ?? 120_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    throw new TypeError('limits.timeoutMs must be an integer between 10000 and 600000')
  }
  const maxRetries = limits.maxRetries ?? 2
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new TypeError('limits.maxRetries must be an integer between 0 and 5')
  }
  const retryBaseMs = limits.retryBaseMs ?? 1_000
  if (!Number.isInteger(retryBaseMs) || retryBaseMs < 100 || retryBaseMs > 30_000) {
    throw new TypeError('limits.retryBaseMs must be an integer between 100 and 30000')
  }
  const maxConcurrent = limits.maxConcurrent ?? 2
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) {
    throw new TypeError('limits.maxConcurrent must be an integer between 1 and 8')
  }
  const maxImageBytes = limits.maxImageBytes ?? 20_000_000
  if (!Number.isInteger(maxImageBytes) || maxImageBytes < 65_536 || maxImageBytes > 268_435_456) {
    throw new TypeError('limits.maxImageBytes must be an integer between 65536 and 268435456')
  }
  const maxReferenceBytes = limits.maxReferenceBytes ?? 10_000_000
  if (!Number.isInteger(maxReferenceBytes) || maxReferenceBytes < 16_384 || maxReferenceBytes > 268_435_456) {
    throw new TypeError('limits.maxReferenceBytes must be an integer between 16384 and 268435456')
  }
  const cacheTtlMs = discovery.cacheTtlMs ?? 300_000
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 1_000 || cacheTtlMs > 3_600_000) {
    throw new TypeError('discovery.cacheTtlMs must be an integer between 1000 and 3600000')
  }
  return {
    sources,
    ...(defaultSource !== undefined && defaultSource !== '' ? { defaultSource } : {}),
    save: {
      enabled: save.enabled ?? true,
      dir: saveDir,
      nameTemplate,
    },
    discovery: {
      enabled: discovery.enabled ?? true,
      extraPatterns,
      cacheTtlMs,
    },
    defaults: {
      ...(size !== undefined && size !== '' ? { size } : {}),
      ...(quality !== undefined && quality !== '' ? { quality } : {}),
      outputFormat,
      n,
    },
    limits: {
      timeoutMs,
      maxRetries,
      retryBaseMs,
      maxConcurrent,
      maxImageBytes,
      maxReferenceBytes,
    },
  }
}
