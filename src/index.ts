/**
 * Host plugin: agent-driven image generation over user-configured
 * OpenAI-compatible sources, with model discovery, optional image-to-image
 * references, automatic workspace saving and a loopback card/image channel.
 * @module dsh-imagen
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SessionId, type JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { IMAGEN_RPC_CHANNEL, IMAGEN_RPC_ENDPOINT } from './rpc.ts'
import {
  Config,
  IMAGEN_SETTINGS_NAMESPACE,
  resolveConfig,
  type ImagenConfig,
  type ResolvedImagenConfig,
} from './config.ts'
import { ImageClient, ImageApiError, downloadImageUrl, type GenerationProgress, type GenerationRequest } from './client.ts'
import { discoverImageModels } from './models.ts'
import { saveImageFile, assertInside, renderNameTemplate } from './save.ts'
import { probeDimensions, sniffMediaType, mediaTypeOf } from './probe.ts'
import {
  PRESENTATION_SCHEMA,
  REFERENCE_MARKER,
  REFERENCE_SCHEMA,
  RESULT_SCHEMA,
  type ImageFormat,
  type ImageGenerationValue,
  type ImageModelValue,
  type ImageProgressValue,
  type ImageReferenceValue,
  type ImageRefValue,
  type ImageUsageValue,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'imagen'

/** Required Host services. */
export const inject = ['tools', 'credentials', 'connection', 'sessionPersistence']

/** Re-export the public surface for consumers and the settings card. */
export { Config, IMAGEN_SETTINGS_NAMESPACE, resolveConfig }
export type { ImagenConfig, ResolvedImagenConfig } from './config.ts'
export {
  ImageClient,
  ImageApiError,
  downloadImageUrl,
  validateBaseUrl,
} from './client.ts'
export type { GenerationRequest, GenerationResult, GeneratedImage, ReferenceImage } from './client.ts'
export { discoverImageModels, matchesImageModel, modelIdsFromPayload } from './models.ts'
export { saveImageFile, slugify, renderNameTemplate, assertInside, atomicWrite, uniquePath, resolveSaveDir } from './save.ts'
export { probeDimensions, sniffMediaType } from './probe.ts'
export {
  PRESENTATION_SCHEMA,
  REFERENCE_MARKER,
  REFERENCE_SCHEMA,
  RESULT_SCHEMA,
} from './types.ts'
export type {
  ImageFormat,
  ImageGenerationValue,
  ImageModelValue,
  ImageProgressValue,
  ImageReferenceValue,
  ImageRefValue,
  ImageUsageValue,
} from './types.ts'

interface ActiveGeneration {
  sessionId: string
  callId: string
  revision: number
  attempt: number
  startedAt: number
  state: Exclude<ImageProgressValue['state'], 'missing'>
  source?: string
  model?: string
  partial?: NonNullable<ImageProgressValue['partial']>
}

interface GenerateArguments {
  prompt: string
  source?: string
  model?: string
  size?: string
  quality?: string
  output_format?: ImageFormat
  n?: number
  reference_images?: Array<{
    path?: string
    url?: string
    attachment?: string
  }>
  extra?: Record<string, JsonValue>
  save?: string
}

interface SaveArguments {
  path: string
  target?: string
  overwrite?: boolean
}

interface ListModelsArguments {
  source?: string
}

interface LoadedReference {
  data: Uint8Array
  filename: string
  mediaType: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : undefined
}

function referenceValue(value: ImageGenerationValue): ImageReferenceValue {
  return {
    schema: REFERENCE_SCHEMA,
    callId: value.callId,
    source: value.source,
    model: value.model,
    images: value.images,
    savedTo: value.savedTo,
    ...(value.size === undefined ? {} : { size: value.size }),
    ...(value.quality === undefined ? {} : { quality: value.quality }),
    outputFormat: value.outputFormat,
    elapsedMs: value.elapsedMs,
    ...(value.usage === undefined ? {} : { usage: value.usage }),
  }
}

function referenceFromText(value: unknown): ImageReferenceValue | undefined {
  if (typeof value !== 'string') return undefined
  const start = value.indexOf(REFERENCE_MARKER)
  if (start < 0) return undefined
  const line = value.slice(start + REFERENCE_MARKER.length).split('\n', 1)[0]
  if (line === undefined || line.length > 8_192) return undefined
  try {
    const parsed = JSON.parse(line) as unknown
    if (!isRecord(parsed) || parsed.schema !== REFERENCE_SCHEMA || typeof parsed.callId !== 'string' || !Array.isArray(parsed.images)) {
      return undefined
    }
    return parsed as unknown as ImageReferenceValue
  } catch {
    return undefined
  }
}

function referenceFromContent(content: unknown): ImageReferenceValue | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text') continue
    const parsed = referenceFromText(block.text)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/** Paths a session is authorized to read for one generation call. */
function authorizedPaths(events: readonly unknown[], callId: string): string[] {
  const paths = new Set<string>()
  for (const event of events) {
    if (!isRecord(event) || !isRecord(event.data)) continue
    if (event.type === 'tool/result') {
      const meta = isRecord(event.data.meta) && event.data.meta.schema === PRESENTATION_SCHEMA
        ? event.data.meta
        : undefined
      const result = isRecord(meta?.result) && meta.result.callId === callId ? meta.result : undefined
      if (result !== undefined && Array.isArray(result.images)) {
        for (const image of result.images) {
          if (isRecord(image) && typeof image.path === 'string') paths.add(image.path)
        }
      }
    }
    if (event.type === 'tool/code-dispatch' && event.data.name === 'generate_image' && event.data.subCallId === callId) {
      const marker = referenceFromContent(event.data.content)
      if (marker !== undefined) {
        for (const image of marker.images) paths.add(image.path)
      }
    }
  }
  return [...paths]
}

function progressOf(entry: ActiveGeneration | undefined): ImageProgressValue {
  if (entry === undefined) return { state: 'missing', revision: 0, attempt: 0, startedAt: 0 }
  return {
    state: entry.state,
    revision: entry.revision,
    attempt: entry.attempt,
    startedAt: entry.startedAt,
    ...(entry.source === undefined ? {} : { source: entry.source }),
    ...(entry.model === undefined ? {} : { model: entry.model }),
    ...(entry.partial === undefined ? {} : { partial: entry.partial }),
  }
}

function rpcError(message: string): { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } } {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function isImageMime(value: unknown): value is 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

/** Narrow a model-supplied `[image attachment 鈥` JSON into a typed ref. */
function parseAttachmentRef(raw: string): {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('reference_images.attachment must be the JSON of an [image attachment 鈥 note')
  }
  if (!isRecord(parsed)) throw new Error('reference_images.attachment must be the JSON of an [image attachment 鈥 note')
  const attachmentId = safeString(parsed.attachmentId, 512)
  if (attachmentId === undefined || !isImageMime(parsed.mediaType)) {
    throw new Error('reference_images.attachment must include a valid attachmentId and mediaType')
  }
  return { attachmentId, mediaType: parsed.mediaType }
}

/** Register the image tools, the settings section and the loopback channel. */
export function apply(ctx: Context, config: ImagenConfig = {}): void {
  if (Object.keys(config.sources ?? {}).length > 0) resolveConfig(config)
  let current: () => ImagenConfig = () => config
  installSettingsSection(ctx, IMAGEN_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: (value) => { if (Object.keys(value.sources ?? {}).length > 0) resolveConfig(value) },
  })

  const spec = (): ResolvedImagenConfig => resolveConfig(current())
  const active = new Map<string, ActiveGeneration>()
  const savedRegistry = new Map<string, { sessionId: string; callId: string }>()
  const modelCache = new Map<string, { models: string[]; at: number }>()
  const inFlight = new Set<Promise<void>>()
  const lifetime = new AbortController()
  let stopping = false

  const keyOf = (sessionId: string, callId: string): string => `${sessionId}\u0000${callId}`
  const trackBackgroundWork = (work: Promise<unknown>): void => {
    const settled = work.then(() => {}, () => {})
    inFlight.add(settled)
    void settled.finally(() => { inFlight.delete(settled) })
  }

  ctx.effect(() => async () => {
    stopping = true
    lifetime.abort(new DOMException('dsh-imagen was unloaded', 'AbortError'))
    await Promise.allSettled([...inFlight])
  }, 'imagen: abort and drain active generations')

  ctx.effect(() => ctx.connection.rpc.handle(
    IMAGEN_RPC_CHANNEL,
    async (endpoint, payload, signal) => {
      if (!isRecord(payload)) return rpcError('A JSON object is required.')
      // Settings endpoints are loopback-only and session-free: the browser
      // card reads/writes the imagen namespace through this channel, exactly
      // like modlens's own config route — the apiproxy settings allowlist is
      // hard-coded in rc.6 and would otherwise answer settings-not-exposed.
      if (endpoint === IMAGEN_RPC_ENDPOINT.settingsGet) {
        try {
          return { ok: true, value: await settingsView(ctx, spec()) }
        } catch (error) {
          return rpcError(error instanceof Error ? error.message : 'Failed to read settings.')
        }
      }
      if (endpoint === IMAGEN_RPC_ENDPOINT.settingsSet) {
        const draft = isRecord(payload.config) ? payload.config as ImagenConfig : undefined
        if (draft === undefined) return rpcError('A valid config object is required.')
        try {
          const resolved = resolveConfig(draft)
          // Persist any user-provided API keys into the DSH credential store
          // (name -> value); the value never enters settings or session data.
          const keys = isRecord(payload.keys) ? payload.keys as Record<string, unknown> : undefined
          if (keys !== undefined) {
            for (const [name, value] of Object.entries(keys)) {
              if (name.trim() === '' || typeof value !== 'string' || value.trim() === '') continue
              const credentials = ctx.get('credentials') as { set(ref: unknown, value: string): Promise<void> } | undefined
              if (credentials === undefined) throw new Error('The credentials service is not mounted.')
              await credentials.set(credentialRef(name.trim()), value)
            }
          }
          const settings = ctx.get('settings') as { replace(ns: unknown, section: unknown): Promise<void> } | undefined
          if (settings === undefined) throw new Error('The settings service is not mounted; edit ~/.dsh/cordis.patch.yml instead.')
          await settings.replace(IMAGEN_SETTINGS_NAMESPACE, plainConfig(resolved))
          return { ok: true, value: await settingsView(ctx, spec()) }
        } catch (error) {
          return rpcError(error instanceof Error ? error.message : 'Failed to save settings.')
        }
      }
      const sessionId = safeString(payload.sessionId, 256)
      const callId = safeString(payload.callId, 512)
      if (sessionId === undefined || callId === undefined) {
        return rpcError('Valid sessionId and callId values are required.')
      }
      if (endpoint === IMAGEN_RPC_ENDPOINT.progress) {
        return { ok: true, value: progressOf(active.get(keyOf(sessionId, callId))) }
      }
      if (endpoint === IMAGEN_RPC_ENDPOINT.image) {
        const path = safeString(payload.path, 4_096)
        if (path === undefined) return rpcError('A valid image path is required.')
        let authorized = savedRegistry.get(path)?.sessionId === sessionId
          && savedRegistry.get(path)?.callId === callId
        if (!authorized) {
          try {
            const inspection = await ctx.sessionPersistence.inspect(SessionId(sessionId), signal)
            authorized = authorizedPaths(inspection.events, callId).includes(path)
          } catch {
            return rpcError('The image session could not be inspected.')
          }
        }
        if (!authorized) return rpcError('The image is not authorized by this session.')
        try {
          const data = await readFile(path)
          if (data.byteLength > spec().limits.maxImageBytes) {
            return rpcError('The saved image exceeds the read limit.')
          }
          const bytes = new Uint8Array(data)
          const dimensions = probeDimensions(bytes)
          return {
            ok: true,
            value: {
              mediaType: sniffMediaType(bytes),
              width: dimensions?.width,
              height: dimensions?.height,
              data: Buffer.from(bytes).toString('base64'),
            },
          }
        } catch {
          return rpcError('The saved image could not be read.')
        }
      }
      if (endpoint === IMAGEN_RPC_ENDPOINT.models) {
        const sourceName = safeString(payload.source, 128)
        if (sourceName === undefined) return rpcError('A valid source name is required.')
        try {
          const models = await discoverForSource(spec(), sourceName, ctx, modelCache, signal)
          return { ok: true, value: { source: sourceName, models: models.map(id => ({ id, discovered: true })) } }
        } catch (error) {
          return rpcError(error instanceof Error ? error.message : 'Model discovery failed.')
        }
      }
      return rpcError(`Unknown image generation endpoint: ${endpoint}`)
    },
    { authority: 'loopback' },
  ), 'imagen: loopback progress and image RPC')

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate images through a user-configured OpenAI-compatible image API. Use this when the user asks to create, draw, render, illustrate, design or edit an image, or to produce a visual for documentation, slides, or a report. '
      + 'Generation runs against one configured `source` (list them with list_image_models when unsure), resolves the model automatically when the source does not pin one, and every produced image is automatically saved into the workspace save directory (default `generated-images/`) unless `save` is set to "none". '
      + 'For image editing or style-transfer, pass `reference_images` (existing workspace files, https URLs, or attachment JSON) and the provider\'s images/edits endpoint is used; the just-generated files from a previous call are valid references via their saved path. '
      + 'The finished image appears in the conversation card with preview and download.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Detailed image prompt. Preserve user constraints and describe subject, composition, style, lighting, palette, text, and exclusions as relevant. For edits, describe the desired change relative to the reference image(s).',
      },
      source: {
        type: 'string',
        description: 'Name of the configured image source (see list_image_models). Defaults to the configured default source.',
      },
      model: {
        type: 'string',
        description: 'Image model id; overrides the source model or auto-discovery. List candidates with list_image_models.',
      },
      size: {
        type: 'string',
        description: 'Requested size, e.g. 1024x1024, 1280x800. Omit for the provider default.',
      },
      quality: {
        type: 'string',
        enum: ['auto', 'low', 'medium', 'high'],
        description: 'Quality tier. Omit for the provider default.',
      },
      output_format: {
        type: 'string',
        enum: ['png', 'jpeg', 'webp'],
        description: 'Output format. Omit for the configured default (png).',
      },
      n: {
        type: 'integer',
        description: 'Number of images to generate (1鈥?). Omit for the configured default.',
      },
      reference_images: {
        type: 'array',
        description: 'Optional reference images for image-to-image: each is {path} (workspace-relative or absolute), {url} (https), or {attachment} (the JSON of an [image attachment 鈥 note).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: 'Workspace-relative or absolute path of an existing image file.' },
            url: { type: 'string', description: 'https URL of an image.' },
            attachment: { type: 'string', description: 'The JSON of an [image attachment 鈥 note.' },
          },
        },
      },
      extra: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional provider-specific passthrough parameters (e.g. negative_prompt, steps, cfg_scale, seed). Values must be strings, numbers, or booleans.',
      },
      save: {
        type: 'string',
        description: '"auto" (default) saves into the configured save directory; "none" skips file saving; "workspace:<rel-dir>" saves into that directory instead.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schema: { type: 'string', const: RESULT_SCHEMA, required: true },
          callId: { type: 'string', required: true },
          source: { type: 'string', required: true },
          model: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
          images: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                relPath: { type: 'string', required: true },
                mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'], required: true },
                format: { type: 'string', enum: ['png', 'jpeg', 'webp'], required: true },
                bytes: { type: 'integer', required: true },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
            },
          },
          savedTo: { type: 'array', required: true, items: { type: 'string' } },
          size: { type: 'string' },
          quality: { type: 'string' },
          outputFormat: { type: 'string', enum: ['png', 'jpeg', 'webp'], required: true },
          elapsedMs: { type: 'integer', required: true },
          usage: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inputTokens: { type: 'integer', required: true },
              outputTokens: { type: 'integer', required: true },
              totalTokens: { type: 'integer', required: true },
            },
          },
          references: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Generated ${value.images.length} image(s) with ${value.model} on ${value.source} (${value.images.map(image => `${image.width ?? '?'}脳${image.height ?? '?'}`).join(', ')}, ${value.outputFormat.toUpperCase()}, ${(value.elapsedMs / 1000).toFixed(1)}s). Saved to ${value.savedTo.join(', ') || 'no file (save=none)'}.\n${REFERENCE_MARKER}${JSON.stringify(referenceValue(value as ImageGenerationValue))}`,
      }],
      presentationMeta: (_args, value) => ({ schema: PRESENTATION_SCHEMA, result: value }),
    },
    finalizeContent(exec, result) {
      if (exec.parent !== undefined || result.isError) return undefined
      let changed = false
      const content = result.content.map((block) => {
        if (block.type !== 'text') return block
        const marker = block.text.indexOf(`\n${REFERENCE_MARKER}`)
        if (marker < 0) return block
        changed = true
        return { type: 'text' as const, text: block.text.slice(0, marker) }
      })
      return changed ? content : undefined
    },
    timeoutMs: 600_000,
    isConcurrencySafe: () => true,
    presentCall(args: GenerateArguments): GenericCallView {
      return {
        card: 'generic',
        title: 'Generate image',
        kind: 'other',
        rawInput: { prompt: args.prompt, source: args.source, size: args.size, n: args.n },
      }
    },
    presentResult(_args, result) {
      return { card: 'generic', title: result.isError ? 'Image generation failed' : 'Generated image' }
    },
    async execute(args: GenerateArguments, exec): Promise<ImageGenerationValue> {
      const sessionId = exec.agent?.session.header.id
      if (sessionId === undefined) throw new Error('generate_image requires a calling DSH agent session')
      const workspace = exec.agent?.session.header.cwd
      if (workspace === undefined) throw new Error('generate_image requires a session workspace')
      if (stopping) throw new DOMException('dsh-imagen is stopping', 'AbortError')
      const resolved = spec()
      const prompt = args.prompt.trim()
      if (prompt.length === 0 || prompt.length > 32_000) throw new Error('prompt must contain 1鈥?2000 characters')
      if (Buffer.byteLength(prompt, 'utf8') > 64_000) throw new Error('prompt must not exceed 64000 UTF-8 bytes')
      const n = args.n ?? resolved.defaults.n
      if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error('n must be an integer between 1 and 4')
      const sourceNames = Object.keys(resolved.sources)
      if (sourceNames.length === 0) throw new Error('No image source is configured. Add a source in Settings 鈫?鎻掍欢閰嶇疆 鈫?imagen, or in cordis.patch.yml.')
      const sourceName = args.source?.trim() || resolved.defaultSource || sourceNames[0]!
      const source = resolved.sources[sourceName]
      if (source === undefined) throw new Error(`Source "${sourceName}" is not configured. Configured sources: ${sourceNames.join(', ')}`)
      const size = args.size?.trim() || resolved.defaults.size
      const quality = args.quality?.trim() || resolved.defaults.quality
      const outputFormat = args.output_format ?? resolved.defaults.outputFormat
      if (active.size >= resolved.limits.maxConcurrent) {
        throw new Error('Too many image generations are already running. Try again after one finishes.')
      }

      const callId = String(exec.callId)
      const operationKey = keyOf(String(sessionId), callId)
      const entry: ActiveGeneration = {
        sessionId: String(sessionId),
        callId,
        revision: 1,
        attempt: 1,
        startedAt: Date.now(),
        state: 'requesting',
        source: sourceName,
      }
      active.set(operationKey, entry)
      let finishOperation: (() => void) | undefined
      const operationDone = new Promise<void>(resolveDone => { finishOperation = resolveDone })
      inFlight.add(operationDone)
      const requestSignal = AbortSignal.any([lifetime.signal, exec.signal, AbortSignal.timeout(resolved.limits.timeoutMs)])

      try {
        entry.state = 'discovering'
        entry.revision += 1
        const discovered = source.model === undefined ? await discoverForSource(resolved, sourceName, ctx, modelCache, requestSignal) : undefined
        const model = args.model?.trim() || source.model || discovered?.[0] || ''
        if (model === '') throw new Error(`No image model is available on source "${sourceName}". Pass model=, pin source.model, or fix model discovery.`)
        entry.model = model
        entry.revision += 1

        const apiKey = await resolveApiKey(ctx, source.credential)
        requestSignal.throwIfAborted()
        const client = new ImageClient({
          baseUrl: source.baseUrl,
          apiKey,
          model,
          maxImageBytes: resolved.limits.maxImageBytes,
          maxRetries: resolved.limits.maxRetries,
          retryBaseMs: resolved.limits.retryBaseMs,
        })

        let references: LoadedReference[] = []
        if (Array.isArray(args.reference_images) && args.reference_images.length > 0) {
          references = []
          for (const reference of args.reference_images) {
            references.push(await loadReference(ctx, workspace, reference, resolved.limits.maxReferenceBytes, requestSignal))
          }
          entry.revision += 1
        }

        const onProgress = (progress: GenerationProgress): void => {
          entry.revision += 1
          entry.attempt = progress.attempt
          if (progress.kind === 'requesting' || progress.kind === 'retrying') {
            entry.state = 'requesting'
            delete entry.partial
          } else if (progress.kind === 'partial') {
            entry.state = 'generating'
            entry.partial = { index: progress.index, format: progress.format, data: progress.data }
          } else {
            entry.state = 'generating'
          }
        }

        const request: GenerationRequest = {
          prompt,
          model,
          n,
          outputFormat,
          ...(size === undefined ? {} : { size }),
          ...(quality === undefined ? {} : { quality }),
          ...(args.extra !== undefined && args.extra !== null ? { extra: scalarExtra(args.extra) } : {}),
        }
        const generated = references.length > 0
          ? await client.edit(request, references.map(toReferenceImage), requestSignal, onProgress)
          : await client.generate(request, requestSignal, onProgress)

        entry.state = 'saving'
        entry.revision += 1
        requestSignal.throwIfAborted()

        const saveMode = parseSaveMode(args.save, resolved)
        const images: ImageRefValue[] = []
        const savedTo: string[] = []
        for (const image of generated.images) {
          const format = image.format
          const dimensions = probeDimensions(image.data)
          if (saveMode.kind === 'auto') {
            const saved = await saveImageFile(workspace, resolved.save.dir, prompt, resolved.save.nameTemplate, format, image.data)
            savedRegistry.set(saved.path, { sessionId: String(sessionId), callId })
            images.push({
              path: saved.path,
              relPath: saved.relPath,
              mediaType: mediaTypeOf(format),
              format,
              bytes: saved.bytes,
              ...(dimensions === undefined ? {} : { width: dimensions.width, height: dimensions.height }),
            })
            savedTo.push(saved.relPath)
          } else if (saveMode.kind === 'dir') {
            const saved = await saveImageFile(workspace, saveMode.dir, prompt, resolved.save.nameTemplate, format, image.data)
            savedRegistry.set(saved.path, { sessionId: String(sessionId), callId })
            images.push({
              path: saved.path,
              relPath: saved.relPath,
              mediaType: mediaTypeOf(format),
              format,
              bytes: saved.bytes,
              ...(dimensions === undefined ? {} : { width: dimensions.width, height: dimensions.height }),
            })
            savedTo.push(saved.relPath)
          } else {
            images.push({
              path: '',
              relPath: '',
              mediaType: mediaTypeOf(format),
              format,
              bytes: image.data.byteLength,
              ...(dimensions === undefined ? {} : { width: dimensions.width, height: dimensions.height }),
            })
          }
        }
        requestSignal.throwIfAborted()
        const usage = generated.usage
        return {
          schema: RESULT_SCHEMA,
          callId,
          source: sourceName,
          model,
          prompt,
          images,
          savedTo,
          ...(size === undefined ? {} : { size }),
          ...(quality === undefined ? {} : { quality }),
          outputFormat,
          elapsedMs: Math.max(0, Date.now() - entry.startedAt),
          ...(usage === undefined ? {} : { usage }),
          ...(references.length > 0 ? { references: references.map(reference => reference.filename) } : {}),
        }
      } catch (error) {
        if (error instanceof ImageApiError) {
          ctx.logger.warn(`generate_image provider failure${error.status === undefined ? '' : ` (${error.status})`}: ${error.message}`)
        }
        throw error
      } finally {
        active.delete(operationKey)
        finishOperation?.()
        inFlight.delete(operationDone)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_image_models',
    description: 'List the image models available on a configured source. Use this to discover which models an image source offers (auto-detected via GET /v1/models plus any models pinned in configuration), so generate_image can target a specific model.',
    parameters: {
      source: {
        type: 'string',
        description: 'Name of the configured image source. Defaults to the configured default source.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          models: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                discovered: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Image models on ${value.source}: ${value.models.map(model => model.id).join(', ') || '(none discovered)'}` }],
    },
    presentCall(args: ListModelsArguments): GenericCallView {
      return { card: 'generic', title: 'List image models', kind: 'read', rawInput: args }
    },
    async execute(args: ListModelsArguments, exec): Promise<{ source: string; models: ImageModelValue[] }> {
      const resolved = spec()
      const sourceNames = Object.keys(resolved.sources)
      if (sourceNames.length === 0) throw new Error('No image source is configured.')
      const sourceName = args.source?.trim() || resolved.defaultSource || sourceNames[0]!
      if (resolved.sources[sourceName] === undefined) {
        throw new Error(`Source "${sourceName}" is not configured. Configured sources: ${sourceNames.join(', ')}`)
      }
      const signal = AbortSignal.any([lifetime.signal, exec.signal, AbortSignal.timeout(resolved.limits.timeoutMs)])
      const models = await discoverForSource(resolved, sourceName, ctx, modelCache, signal)
      return { source: sourceName, models: models.map(id => ({ id, discovered: true })) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'save_generated_image',
    description: 'Copy an existing generated image file (or any workspace image) to another workspace location. Use this when the user asks to store a specific generated image somewhere specific, e.g. docs/cover.png. The source must be inside the session workspace. Collisions are auto-numbered unless overwrite is true.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute or workspace-relative path of the existing image file to copy.',
      },
      target: {
        type: 'string',
        description: 'Workspace-relative destination directory or file path. Defaults to the configured save directory.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Allow overwriting the destination file when target names an existing file (default false).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          relPath: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          overwritten: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Saved image to ${value.relPath} (${value.bytes} bytes).` }],
    },
    presentCall(args: SaveArguments): GenericCallView {
      return { card: 'generic', title: 'Save image', kind: 'write' as 'other', rawInput: args }
    },
    async execute(args: SaveArguments, exec): Promise<{ path: string; relPath: string; bytes: number; overwritten: boolean }> {
      const sessionId = exec.agent?.session.header.id
      if (sessionId === undefined) throw new Error('save_generated_image requires a calling DSH agent session')
      const workspace = exec.agent?.session.header.cwd
      if (workspace === undefined) throw new Error('save_generated_image requires a session workspace')
      const resolved = spec()
      const sourcePath = isAbsolute(args.path) ? assertInside(workspace, args.path) : assertInside(workspace, resolve(workspace, args.path))
      const source = await readFile(sourcePath)
      const bytes = new Uint8Array(source)
      if (bytes.byteLength === 0) throw new Error('the source image is empty')
      const format = formatFromBytes(bytes)
      const target = args.target?.trim()
      let destPath: string
      let overwritten = false
      if (target !== undefined && /\.(png|jpe?g|webp)$/i.test(target) && !target.includes('/') && !target.includes('\\')) {
        destPath = assertInside(workspace, resolve(workspace, target))
      } else {
        const dir = target !== undefined && target !== '' ? target : resolved.save.dir
        const saved = await saveImageFile(workspace, dir, '', resolved.save.nameTemplate, format, bytes)
        destPath = saved.path
      }
      if (!overwritten) {
        try {
          await import('node:fs/promises').then(m => m.access(destPath))
          throw new Error(`destination already exists: ${relativePath(workspace, destPath)} (pass overwrite: true to replace it)`)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      await import('node:fs/promises').then(m => m.writeFile(destPath, bytes))
      savedRegistry.set(destPath, { sessionId: String(sessionId), callId: String(exec.callId) })
      return { path: destPath, relPath: relativePath(workspace, destPath), bytes: bytes.byteLength, overwritten }
    },
  }))
}

/** Resolve a source's credential through the DSH credentials seam. */
async function resolveApiKey(ctx: Context, ref: ReturnType<typeof credentialRef>): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error('No credentials service is mounted; configure a DSH credential for this source.')
  const resolved = await credentials.resolve(ref)
  if (resolved === undefined) {
    throw new Error(`No credential is configured for ${String(ref)}. Store it in DSH credentials before generating.`)
  }
  return resolved.value
}

/** Discover (and cache) the image model ids of a source. */
async function discoverForSource(
  resolved: ResolvedImagenConfig,
  sourceName: string,
  ctx: Context,
  cache: Map<string, { models: string[]; at: number }>,
  signal: AbortSignal,
): Promise<string[]> {
  const source = resolved.sources[sourceName]
  if (source === undefined) throw new Error(`Source "${sourceName}" is not configured.`)
  if (source.model !== undefined) return [source.model]
  if (!resolved.discovery.enabled) {
    throw new Error(`Source "${sourceName}" pins no model and model discovery is disabled; configure source.model or enable discovery.`)
  }
  const cached = cache.get(sourceName)
  if (cached !== undefined && Date.now() - cached.at < resolved.discovery.cacheTtlMs) {
    if (cached.models.length === 0) {
      throw new Error(`No image models were discovered on source "${sourceName}". Configure source.model or add discovery.extraPatterns.`)
    }
    return cached.models
  }
  const apiKey = await resolveApiKey(ctx, source.credential)
  const client = new ImageClient({
    baseUrl: source.baseUrl,
    apiKey,
    model: source.model ?? '',
    maxImageBytes: resolved.limits.maxImageBytes,
    maxRetries: resolved.limits.maxRetries,
    retryBaseMs: resolved.limits.retryBaseMs,
  })
  const ids = await client.listModelIds(signal)
  const discovered = discoverImageModels(ids, resolved.discovery.extraPatterns)
  cache.set(sourceName, { models: discovered, at: Date.now() })
  if (discovered.length === 0) {
    throw new Error(`No image models were discovered on source "${sourceName}". Configure source.model or add discovery.extraPatterns.`)
  }
  return discovered
}

/** Load one reference image (path / url / attachment) with size bounds. */
async function loadReference(
  ctx: Context,
  workspace: string,
  reference: { path?: string; url?: string; attachment?: string },
  maxBytes: number,
  signal: AbortSignal,
): Promise<LoadedReference> {
  if (reference.path !== undefined) {
    const abs = isAbsolute(reference.path) ? assertInside(workspace, reference.path) : assertInside(workspace, resolve(workspace, reference.path))
    const data = await readFile(abs)
    if (data.byteLength === 0) throw new Error(`reference image is empty: ${reference.path}`)
    if (data.byteLength > maxBytes) throw new Error(`reference image exceeds the ${maxBytes} byte limit: ${reference.path}`)
    const bytes = new Uint8Array(data)
    return { data: bytes, filename: abs.split(/[\\/]/u).pop() ?? 'reference', mediaType: sniffMediaType(bytes) }
  }
  if (reference.url !== undefined) {
    const url = new URL(reference.url)
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' && !loopback) throw new Error('reference image URLs must use https.')
    const bytes = await downloadImageUrl(reference.url, maxBytes, signal)
    return { data: bytes, filename: url.pathname.split('/').pop() || 'reference', mediaType: sniffMediaType(bytes) }
  }
  if (reference.attachment !== undefined) {
    const parsed = parseAttachmentRef(reference.attachment)
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('no attachment service is mounted; pass a file path or URL instead')
    const stored = await attachments.readImage({
      attachmentId: parsed.attachmentId as never,
      mediaType: parsed.mediaType,
      bytes: 0,
      width: 0,
      height: 0,
    }, signal)
    if (stored.data.byteLength > maxBytes) throw new Error('reference attachment exceeds the byte limit')
    const bytes = new Uint8Array(stored.data)
    return { data: bytes, filename: stored.ref.name ?? 'reference', mediaType: stored.ref.mediaType }
  }
  throw new Error('each reference_images entry needs exactly one of path, url, or attachment')
}

function toReferenceImage(reference: LoadedReference): { data: Uint8Array; filename: string; mediaType: string } {
  return reference
}

/** Interpret the `save` argument. */
function parseSaveMode(save: string | undefined, resolved: ResolvedImagenConfig): { kind: 'auto' } | { kind: 'none' } | { kind: 'dir'; dir: string } {
  if (save === undefined || save === 'auto') {
    return resolved.save.enabled ? { kind: 'auto' } : { kind: 'none' }
  }
  if (save === 'none') return { kind: 'none' }
  if (save.startsWith('workspace:')) {
    const dir = save.slice('workspace:'.length).trim()
    if (dir === '' || dir === '.' || dir === '..' || dir.includes('..')) {
      throw new Error('save must be "auto", "none", or "workspace:<relative-dir>"')
    }
    return { kind: 'dir', dir }
  }
  throw new Error('save must be "auto", "none", or "workspace:<relative-dir>"')
}

function relativePath(workspace: string, path: string): string {
  return relative(workspace, path).split(sep).join('/')
}

/** Serializable view of the resolved config for the browser settings card.
 *  Includes whether each source's credential is configured — never the value. */
async function settingsView(ctx: Context, config: ResolvedImagenConfig): Promise<Record<string, unknown>> {
  const credentials = ctx.get('credentials') as { describe(ref: unknown): Promise<{ configured: boolean }> } | undefined
  const sources: Record<string, { baseUrl: string; credential: string; model?: string; credentialSet: boolean }> = {}
  for (const [name, source] of Object.entries(config.sources)) {
    let credentialSet = false
    if (credentials !== undefined) {
      try {
        credentialSet = (await credentials.describe(source.credential)).configured
      } catch {
        credentialSet = false
      }
    }
    sources[name] = {
      baseUrl: source.baseUrl,
      credential: String(source.credential),
      credentialSet,
      ...(source.model === undefined ? {} : { model: source.model }),
    }
  }
  return {
    sources,
    ...(config.defaultSource === undefined ? {} : { defaultSource: config.defaultSource }),
    save: config.save,
    discovery: config.discovery,
    defaults: config.defaults,
    limits: config.limits,
  }
}

/** Persistable plain config (credential references as names) for the settings store. */
function plainConfig(config: ResolvedImagenConfig): Record<string, unknown> {
  const sources: Record<string, { baseUrl: string; credential: string; model?: string }> = {}
  for (const [name, source] of Object.entries(config.sources)) {
    sources[name] = {
      baseUrl: source.baseUrl,
      credential: String(source.credential),
      ...(source.model === undefined ? {} : { model: source.model }),
    }
  }
  return {
    sources,
    ...(config.defaultSource === undefined ? {} : { defaultSource: config.defaultSource }),
    save: config.save,
    discovery: config.discovery,
    defaults: config.defaults,
    limits: config.limits,
  }
}

/** Keep only scalar passthrough values (strings, numbers, booleans). */
function scalarExtra(extra: Record<string, JsonValue>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}

function formatFromBytes(bytes: Uint8Array): ImageFormat {
  const mediaType = sniffMediaType(bytes)
  if (mediaType === 'image/png') return 'png'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/jpeg') return 'jpeg'
  throw new Error('unsupported image type (expected PNG, JPEG, WebP, or GIF)')
}
