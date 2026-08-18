/**
 * Dependency-free OpenAI-compatible image client: `images/generations`
 * (text-to-image) and `images/edits` (image-to-image, multipart), with
 * b64_json/URL responses, optional SSE partial frames, bounded sizes,
 * redirect rejection for credential-bearing requests and transient-only retries.
 * @module dsh-imagen/client
 */

import type { ImageFormat, ImageUsageValue } from './types.ts'

const MAX_REDIRECTS = 3
const MAX_ERROR_BYTES = 8_192

/** One validated request to a generation endpoint. */
export interface GenerationRequest {
  prompt: string
  model: string
  size?: string
  quality?: string
  outputFormat: ImageFormat
  n: number
  /** Provider-specific passthrough parameters (negative_prompt, steps, …). */
  extra?: Record<string, unknown>
  /** Request an SSE stream (partial frames); default false. */
  stream?: boolean
}

/** One reference image for `images/edits`. */
export interface ReferenceImage {
  data: Uint8Array
  filename: string
  mediaType: string
}

/** A completed provider image. */
export interface GeneratedImage {
  data: Uint8Array
  format: ImageFormat
  size?: string
  quality?: string
}

/** Result of one generation/edit call. */
export interface GenerationResult {
  images: GeneratedImage[]
  usage?: ImageUsageValue
}

/** Progress emitted before the final images are durable. */
export type GenerationProgress =
  | { kind: 'requesting'; attempt: number }
  | { kind: 'generating'; attempt: number }
  | { kind: 'partial'; attempt: number; index: number; format: ImageFormat; data: string }
  | { kind: 'retrying'; attempt: number }

/** Client deployment and retry policy. */
export interface ImageClientOptions {
  baseUrl: string
  apiKey: string
  model: string
  maxImageBytes: number
  maxRetries: number
  retryBaseMs: number
  fetchImpl?: typeof fetch
}

/** HTTP/protocol failure with a stable retry decision. */
export class ImageApiError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  readonly retryable: boolean

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageApiError'
    this.status = options.status
    this.code = options.code
    this.retryable = options.retryable ?? false
  }
}

/** Validate an API base URL before a credential can be sent to it. */
export function validateBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('baseUrl must be a valid http(s) URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('baseUrl must use https, or http for a loopback host')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError('baseUrl must not contain credentials, a query, or a fragment')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !loopback) throw new TypeError('baseUrl must use https outside loopback')
  return url.href.replace(/\/+$/u, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function outputFormat(value: unknown, fallback: ImageFormat): ImageFormat {
  return value === 'png' || value === 'jpeg' || value === 'webp' ? value : fallback
}

function usage(value: unknown): ImageUsageValue | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = value.input_tokens
  const outputTokens = value.output_tokens
  const totalTokens = value.total_tokens
  if ([inputTokens, outputTokens, totalTokens].every(item => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)) {
    return {
      inputTokens: inputTokens as number,
      outputTokens: outputTokens as number,
      totalTokens: totalTokens as number,
    }
  }
  return undefined
}

function providerError(value: unknown): { code?: string; message: string } {
  const error = isRecord(value) && isRecord(value.error) ? value.error : isRecord(value) ? value : undefined
  const code = typeof error?.code === 'string' ? error.code : undefined
  const message = typeof error?.message === 'string' && error.message.trim() !== '' ? error.message : 'Image API request failed.'
  return { ...(code === undefined ? {} : { code }), message }
}

function safeProviderMessage(status: number, value: unknown): ImageApiError {
  const detail = providerError(value)
  const message = detail.message.toLowerCase()
  // A request-shape rejection is not transient; a response_format rejection
  // is handled by the caller's fallback (see `fetchJson`).
  return new ImageApiError(detail.message, {
    status,
    ...(detail.code === undefined ? {} : { code: detail.code }),
    retryable: status === 429 || status >= 500 || message.includes('timeout') || message.includes('temporar'),
  })
}

function base64Bytes(value: string, maximum: number): Uint8Array {
  const maximumChars = Math.ceil(maximum / 3) * 4 + 8
  if (value.length === 0 || value.length > maximumChars || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new ImageApiError('Provider returned invalid or oversized image data.')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new ImageApiError('Provider returned invalid or oversized image data.')
  }
  return bytes
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
  truncate: boolean,
): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let reachedEnd = false
  let cancelled = false
  const abort = (): void => {
    void reader.cancel(signal.reason).catch(() => {
      // Cancellation is best-effort.
    })
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) {
        reachedEnd = true
        break
      }
      const remaining = maximumBytes - totalBytes
      if (value.byteLength > remaining) {
        if (truncate && remaining > 0) chunks.push(value.subarray(0, remaining))
        cancelled = true
        await reader.cancel('response byte limit reached')
        if (!truncate) throw new ImageApiError('Image API response exceeded its byte limit.')
        break
      }
      chunks.push(value)
      totalBytes += value.byteLength
    }
  } finally {
    signal.removeEventListener('abort', abort)
    if (!reachedEnd && !cancelled) {
      try {
        await reader.cancel(signal.reason)
      } catch {
        // The read error remains authoritative.
      }
    }
    reader.releaseLock()
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function responseErrorBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const text = await boundedResponseText(response, MAX_ERROR_BYTES, signal, true)
  if (text === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

function ssePayload(chunk: string): unknown | undefined {
  const data = chunk
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
  if (data === '' || data === '[DONE]') return undefined
  try {
    return JSON.parse(data) as unknown
  } catch {
    throw new ImageApiError('Provider returned malformed streaming JSON.', { retryable: true })
  }
}

async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maximumEventChars: number,
  maximumTotalBytes: number,
): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let totalBytes = 0
  let reachedEnd = false
  const abort = (): void => {
    void reader.cancel(signal.reason).catch(() => {
      // Cancellation is best-effort.
    })
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) {
        reachedEnd = true
        break
      }
      totalBytes += value.byteLength
      if (totalBytes > maximumTotalBytes) throw new ImageApiError('Image stream exceeded its byte limit.')
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r', '')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        if (boundary > maximumEventChars) throw new ImageApiError('Image stream event exceeded its byte limit.')
        const payload = ssePayload(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (payload !== undefined) yield payload
        boundary = buffer.indexOf('\n\n')
      }
      if (buffer.length > maximumEventChars) throw new ImageApiError('Image stream event exceeded its byte limit.')
    }
    buffer += decoder.decode().replaceAll('\r', '')
    const payload = ssePayload(buffer.trim())
    if (payload !== undefined) yield payload
  } finally {
    signal.removeEventListener('abort', abort)
    if (!reachedEnd) {
      try {
        await reader.cancel(signal.reason)
      } catch {
        // Cancellation is best-effort.
      }
    }
    reader.releaseLock()
  }
}

async function parsedJson(response: Response, signal: AbortSignal, maximumBytes: number): Promise<unknown> {
  const text = await boundedResponseText(response, maximumBytes, signal, false)
  if (text === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ImageApiError('Provider returned malformed image JSON.', { retryable: true })
  }
}

function retryDelay(response: Response | undefined, base: number, attempt: number): number {
  const raw = response?.headers.get('retry-after')
  if (raw !== null && raw !== undefined) {
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1_000)
    const date = Date.parse(raw)
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()))
  }
  return Math.min(10_000, base * (2 ** Math.max(0, attempt - 1)))
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Download a provider image URL with bounded size and https-only hops. */
export async function downloadImageUrl(
  url: string,
  maxBytes: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      throw new ImageApiError('Provider returned an invalid image URL.')
    }
    if (parsed.protocol !== 'https:') {
      const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
      if (!loopback) throw new ImageApiError('Provider image URL must use https.')
    }
    const response = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null) throw new ImageApiError('Provider image URL redirected without a location.')
      current = new URL(location, current).href
      continue
    }
    if (!response.ok) {
      throw new ImageApiError(`Provider image download failed with status ${response.status}.`, { status: response.status, retryable: response.status === 429 || response.status >= 500 })
    }
    if (response.body === null) throw new ImageApiError('Provider returned an empty image body.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    const abort = (): void => {
      void reader.cancel(signal.reason).catch(() => {
        // Best-effort.
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          await reader.cancel('image byte limit reached')
          throw new ImageApiError('Provider image download exceeded its byte limit.')
        }
        chunks.push(value)
      }
    } finally {
      signal.removeEventListener('abort', abort)
      reader.releaseLock()
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (bytes.byteLength === 0) throw new ImageApiError('Provider returned an empty image body.')
    return bytes
  }
  throw new ImageApiError('Provider image URL exceeded the redirect limit.')
}

/** OpenAI-compatible image client with redirect rejection and bounded retries. */
export class ImageClient {
  private readonly endpoint: string
  private readonly editEndpoint: string
  private readonly modelsEndpoint: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: ImageClientOptions) {
    const baseUrl = validateBaseUrl(options.baseUrl)
    this.endpoint = `${baseUrl}/images/generations`
    this.editEndpoint = `${baseUrl}/images/edits`
    this.modelsEndpoint = `${baseUrl}/models`
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** Discover model ids from `GET /models` (no matching here — see models.ts). */
  async listModelIds(signal: AbortSignal): Promise<string[]> {
    const response = await this.fetchImpl(this.modelsEndpoint, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      signal,
    })
    if (!response.ok) throw safeProviderMessage(response.status, await responseErrorBody(response, signal))
    const maximum = 4 * 1024 * 1024
    const value = await parsedJson(response, signal, maximum)
    if (!isRecord(value) || !Array.isArray(value.data)) return []
    return value.data
      .map(entry => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined))
      .filter((id): id is string => id !== undefined)
  }

  /** Parse one response payload into images, downloading URL results. */
  private async imagesFromPayload(
    value: unknown,
    fallbackFormat: ImageFormat,
    signal: AbortSignal,
  ): Promise<GeneratedImage[]> {
    if (!isRecord(value) || !Array.isArray(value.data)) {
      throw new ImageApiError('Provider returned no usable image data.', { retryable: true })
    }
    const images: GeneratedImage[] = []
    for (const entry of value.data) {
      if (!isRecord(entry)) continue
      let data: Uint8Array | undefined
      let format = outputFormat(entry.output_format, fallbackFormat)
      if (typeof entry.b64_json === 'string') {
        data = base64Bytes(entry.b64_json, this.options.maxImageBytes)
      } else if (typeof entry.url === 'string') {
        data = await downloadImageUrl(entry.url, this.options.maxImageBytes, signal, this.fetchImpl)
      }
      if (data === undefined) continue
      const size = typeof entry.size === 'string' ? entry.size : undefined
      const quality = typeof entry.quality === 'string' ? entry.quality : undefined
      images.push({
        data,
        format,
        ...(size === undefined ? {} : { size }),
        ...(quality === undefined ? {} : { quality }),
      })
    }
    if (images.length === 0) throw new ImageApiError('Provider returned no usable image data.', { retryable: true })
    return images
  }

  /** One request with retries; `buildBody` returns the JSON body and URL flag. */
  private async withRetries(
    path: string,
    headers: Record<string, string>,
    body: string | FormData,
    signal: AbortSignal,
    onProgress: (progress: GenerationProgress) => void,
    maximumJsonBytes: number,
  ): Promise<Response> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.options.maxRetries + 1; attempt += 1) {
      signal.throwIfAborted()
      onProgress({ kind: 'requesting', attempt })
      let response: Response | undefined
      try {
        response = await this.fetchImpl(path, {
          method: 'POST',
          redirect: 'error',
          headers,
          body,
          signal,
        })
        if (!response.ok) throw safeProviderMessage(response.status, await responseErrorBody(response, signal))
        onProgress({ kind: 'generating', attempt })
        return response
      } catch (error) {
        if (signal.aborted) throw signal.reason
        lastError = error
        const retryable = error instanceof ImageApiError ? error.retryable : true
        if (!retryable || attempt > this.options.maxRetries) throw error
        onProgress({ kind: 'retrying', attempt })
        await wait(retryDelay(response, this.options.retryBaseMs, attempt), signal)
      }
    }
    throw lastError
  }

  /** Text-to-image: `POST /images/generations`. */
  async generate(
    request: GenerationRequest,
    signal: AbortSignal,
    onProgress: (progress: GenerationProgress) => void,
  ): Promise<GenerationResult> {
    const baseBody: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      n: request.n,
      response_format: 'b64_json',
      ...(request.size === undefined ? {} : { size: request.size }),
      ...(request.quality === undefined ? {} : { quality: request.quality }),
      ...(request.stream === true ? { stream: true } : {}),
      ...(request.extra ?? {}),
    }
    const headers: Record<string, string> = {
      accept: request.stream === true ? 'text/event-stream' : 'application/json',
      authorization: `Bearer ${this.options.apiKey}`,
      'content-type': 'application/json',
    }
    const maximumJsonBytes = Math.ceil((this.options.maxImageBytes * request.n) / 3) * 4 + 65_536
    let value: unknown
    let response = await this.withRetries(
      this.endpoint, headers, JSON.stringify(baseBody), signal, onProgress, maximumJsonBytes,
    )
    if (request.stream === true && (response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const streamed = await this.fromStream(response, request, signal, onProgress)
      return { images: streamed.images, ...(streamed.usage === undefined ? {} : { usage: streamed.usage }) }
    }
    value = await parsedJson(response, signal, maximumJsonBytes)
    const parsedUsage = usage(isRecord(value) ? value.usage : undefined)
    return {
      images: await this.imagesFromPayload(value, request.outputFormat, signal),
      ...(parsedUsage === undefined ? {} : { usage: parsedUsage }),
    }
  }

  /** Parse an SSE stream into images, surfacing partial frames via onProgress. */
  private async fromStream(
    response: Response,
    request: GenerationRequest,
    signal: AbortSignal,
    onProgress: (progress: GenerationProgress) => void,
  ): Promise<GenerationResult> {
    if (response.body === null) throw new ImageApiError('Provider returned an empty image stream.', { retryable: true })
    const maximumEventChars = Math.ceil(this.options.maxImageBytes / 3) * 4 + 16_384
    const maximumTotalBytes = maximumEventChars * 8 + 65_536
    const images: GeneratedImage[] = []
    let overallUsage: ImageUsageValue | undefined
    let attempt = 1
    for await (const raw of readSse(response.body, signal, maximumEventChars, maximumTotalBytes)) {
      if (!isRecord(raw)) continue
      if (raw.type === 'error') throw safeProviderMessage(502, raw)
      if (raw.type === 'image_generation.partial_image' && typeof raw.b64_json === 'string') {
        base64Bytes(raw.b64_json, this.options.maxImageBytes)
        onProgress({
          kind: 'partial',
          attempt,
          index: typeof raw.partial_image_index === 'number' ? raw.partial_image_index : 0,
          format: outputFormat(raw.output_format, request.outputFormat),
          data: raw.b64_json,
        })
      }
      if (raw.type === 'image_generation.completed' && typeof raw.b64_json === 'string') {
        images.push({
          data: base64Bytes(raw.b64_json, this.options.maxImageBytes),
          format: outputFormat(raw.output_format, request.outputFormat),
          ...(typeof raw.size === 'string' ? { size: raw.size } : {}),
          ...(typeof raw.quality === 'string' ? { quality: raw.quality } : {}),
        })
        overallUsage = usage(raw.usage) ?? overallUsage
      }
    }
    if (images.length === 0) throw new ImageApiError('Provider ended the image stream before completion.', { retryable: true })
    return { images, ...(overallUsage === undefined ? {} : { usage: overallUsage }) }
  }

  /** Image-to-image: `POST /images/edits` with multipart form data. */
  async edit(
    request: GenerationRequest,
    references: ReferenceImage[],
    signal: AbortSignal,
    onProgress: (progress: GenerationProgress) => void,
  ): Promise<GenerationResult> {
    const form = new FormData()
    for (const reference of references) {
      form.append('image', new Blob([reference.data], { type: reference.mediaType }), reference.filename)
    }
    form.append('model', request.model)
    form.append('prompt', request.prompt)
    if (request.size !== undefined) form.append('size', request.size)
    if (request.quality !== undefined) form.append('quality', request.quality)
    form.append('n', String(request.n))
    form.append('response_format', 'b64_json')
    if (request.extra !== undefined) {
      for (const [key, value] of Object.entries(request.extra)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          form.append(key, String(value))
        }
      }
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.options.apiKey}`,
    }
    const maximumJsonBytes = Math.ceil((this.options.maxImageBytes * request.n) / 3) * 4 + 65_536
    const response = await this.withRetries(
      this.editEndpoint, headers, form, signal, onProgress, maximumJsonBytes,
    )
    const value = await parsedJson(response, signal, maximumJsonBytes)
    const parsedUsage = usage(isRecord(value) ? value.usage : undefined)
    return {
      images: await this.imagesFromPayload(value, request.outputFormat, signal),
      ...(parsedUsage === undefined ? {} : { usage: parsedUsage }),
    }
  }
}
