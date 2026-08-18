import { describe, expect, it, vi } from 'vitest'
import { ImageClient, ImageApiError, downloadImageUrl, validateBaseUrl } from '../src/client.ts'

/** A tiny valid PNG (signature + IHDR) whose header reports 4×2. */
function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([73, 72, 68, 82], 12)
  bytes[16] = 0
  bytes[17] = 0
  bytes[18] = 0
  bytes[19] = 4
  bytes[20] = 0
  bytes[21] = 0
  bytes[22] = 0
  bytes[23] = 2
  return bytes
}

const PNG_B64 = Buffer.from(pngBytes()).toString('base64')

const noop = (): void => {}

function client(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof ImageClient>[0]> = {}): ImageClient {
  return new ImageClient({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'flux-1',
    maxImageBytes: 1_000_000,
    maxRetries: 2,
    retryBaseMs: 10,
    fetchImpl,
    ...overrides,
  })
}

describe('validateBaseUrl', () => {
  it('accepts https and loopback http', () => {
    expect(validateBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
    expect(validateBaseUrl('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1')
  })
  it('rejects insecure or malformed URLs', () => {
    expect(() => validateBaseUrl('http://api.example.com/v1')).toThrow(/https/)
    expect(() => validateBaseUrl('https://api.example.com/v1?x=1')).toThrow()
    expect(() => validateBaseUrl('not-a-url')).toThrow()
  })
})

describe('ImageClient.generate (JSON b64)', () => {
  it('posts the right body and decodes b64_json', async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 5, output_tokens: 9, total_tokens: 14 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const result = await client(fetchImpl).generate(
      { prompt: 'a cat', model: 'flux-1', n: 1, outputFormat: 'png' },
      new AbortController().signal,
      noop,
    )
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0]!.init!.body))
    expect(body).toMatchObject({ model: 'flux-1', prompt: 'a cat', n: 1, response_format: 'b64_json' })
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(result.images).toHaveLength(1)
    expect(Array.from(result.images[0]!.data)).toEqual(Array.from(pngBytes()))
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 9, totalTokens: 14 })
  })
})

describe('ImageClient.generate (URL response)', () => {
  it('downloads URL results and follows redirects', async () => {
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/images/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/i.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (String(input) === 'https://cdn.example.com/i.png') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 302, headers: { location: 'https://cdn2.example.com/final.png' } })
      }
      if (String(input) === 'https://cdn2.example.com/final.png') {
        return new Response(pngBytes(), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    })
    const result = await client(fetchImpl).generate(
      { prompt: 'x', model: 'flux-1', n: 1, outputFormat: 'png' },
      new AbortController().signal,
      noop,
    )
    expect(result.images[0]!.data).toEqual(pngBytes())
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('rejects http image URLs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ url: 'http://cdn.example.com/i.png' }] }), { status: 200 }))
    await expect(client(fetchImpl).generate({ prompt: 'x', model: 'm', n: 1, outputFormat: 'png' }, new AbortController().signal, noop))
      .rejects.toThrow(/https/)
  })
})

describe('ImageClient.generate (SSE stream)', () => {
  it('surfaces partial frames and the completed image', async () => {
    const partial = Buffer.from(pngBytes()).toString('base64')
    const sse = [
      `data: ${JSON.stringify({ type: 'image_generation.partial_image', b64_json: partial, partial_image_index: 0, output_format: 'png' })}\n\n`,
      `data: ${JSON.stringify({ type: 'image_generation.completed', b64_json: partial, size: '1024x1024', quality: 'high', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('')
    const fetchImpl = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const progress: string[] = []
    const result = await client(fetchImpl).generate(
      { prompt: 'x', model: 'm', n: 1, outputFormat: 'png', stream: true },
      new AbortController().signal,
      (p) => { progress.push(p.kind) },
    )
    expect(progress).toContain('partial')
    expect(result.images).toHaveLength(1)
    expect(result.images[0]!.size).toBe('1024x1024')
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 })
  })

  it('fails when the stream ends without completion', async () => {
    const fetchImpl = vi.fn(async () => new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    await expect(client(fetchImpl).generate({ prompt: 'x', model: 'm', n: 1, outputFormat: 'png', stream: true }, new AbortController().signal, noop))
      .rejects.toThrow(/before completion/)
  })
})

describe('ImageClient retries', () => {
  it('retries transient failures and succeeds', async () => {
    let attempt = 0
    const fetchImpl = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 })
    })
    const result = await client(fetchImpl, { maxRetries: 2 }).generate(
      { prompt: 'x', model: 'm', n: 1, outputFormat: 'png' },
      new AbortController().signal,
      noop,
    )
    expect(attempt).toBe(2)
    expect(result.images).toHaveLength(1)
  })

  it('does not retry provider-side rejections', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad prompt', code: 'image_generation_user_error' } }), { status: 400 }))
    await expect(client(fetchImpl, { maxRetries: 2 }).generate({ prompt: 'x', model: 'm', n: 1, outputFormat: 'png' }, new AbortController().signal, noop))
      .rejects.toBeInstanceOf(ImageApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('ImageClient byte limits', () => {
  it('rejects oversized images', async () => {
    // Slightly above maxImageBytes: fits inside the JSON text cap, so the
    // base64 decode limit rejects it.
    const big = Buffer.alloc(1_010_000, 65).toString('base64')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: big }] }), { status: 200 }))
    await expect(client(fetchImpl).generate({ prompt: 'x', model: 'm', n: 1, outputFormat: 'png' }, new AbortController().signal, noop))
      .rejects.toThrow(/oversized/)
  })
})

describe('ImageClient.edit (img2img multipart)', () => {
  it('sends reference images as multipart parts', async () => {
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      expect(String(input)).toBe('https://api.example.com/v1/images/edits')
      const form = init!.body as FormData
      const image = form.get('image') as Blob
      expect(image).toBeInstanceOf(Blob)
      expect(form.get('prompt')).toBe('make it blue')
      expect(form.get('model')).toBe('flux-1')
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 })
    })
    const result = await client(fetchImpl).edit(
      { prompt: 'make it blue', model: 'flux-1', n: 1, outputFormat: 'png' },
      [{ data: pngBytes(), filename: 'ref.png', mediaType: 'image/png' }],
      new AbortController().signal,
      noop,
    )
    expect(result.images).toHaveLength(1)
  })
})

describe('ImageClient.listModelIds', () => {
  it('calls GET /models with the bearer token', async () => {
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      expect(String(input)).toBe('https://api.example.com/v1/models')
      expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
      return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'gpt-4o' }] }), { status: 200 })
    })
    const ids = await client(fetchImpl).listModelIds(new AbortController().signal)
    expect(ids).toEqual(['gpt-image-2', 'gpt-4o'])
  })
})

describe('ImageClient async tasks', () => {
  it('polls a task and downloads the completed result url', async () => {
    const taskId = 'tsk_img_test'
    let polls = 0
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      if (url.endsWith('/images/generations')) {
        return new Response(JSON.stringify({ object: 'generation.task', id: taskId, status: 'pending', progress: 0 }), { status: 200 })
      }
      if (url.endsWith(`/images/generations/${taskId}`)) {
        polls += 1
        if (polls === 1) {
          return new Response(JSON.stringify({ id: taskId, status: 'in_progress', progress: 50 }), { status: 200 })
        }
        return new Response(JSON.stringify({
          id: taskId,
          status: 'completed',
          result: { type: 'image', data: [{ url: 'https://files.example.com/x.png' }] },
        }), { status: 200 })
      }
      if (url === 'https://files.example.com/x.png') {
        return new Response(pngBytes(), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const result = await client(fetchImpl).generate(
      { prompt: 'x', model: 'm', n: 1, outputFormat: 'png' },
      new AbortController().signal,
      noop,
    )
    expect(polls).toBeGreaterThanOrEqual(2)
    expect(Array.from(result.images[0]!.data)).toEqual(Array.from(pngBytes()))
  })

  it('fails when the task reports failure', async () => {
    const fetchImpl = vi.fn(async (input: any) => {
      if (String(input).endsWith('/images/generations')) {
        return new Response(JSON.stringify({ object: 'generation.task', id: 'tsk_bad', status: 'pending' }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'tsk_bad', status: 'failed', error: { message: 'prompt rejected' } }), { status: 200 })
    })
    await expect(client(fetchImpl).generate({ prompt: 'x', model: 'm', n: 1, outputFormat: 'png' }, new AbortController().signal, noop))
      .rejects.toThrow(/task failed/)
  })
})

describe('downloadImageUrl', () => {
  it('bounded download and redirect limit', async () => {
    const fetchImpl = vi.fn(async () => new Response(pngBytes(), { status: 200 }))
    const bytes = await downloadImageUrl('https://cdn.example.com/x.png', 1_000_000, new AbortController().signal, fetchImpl)
    expect(bytes).toEqual(pngBytes())
  })

  it('enforces the byte cap', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(2_000), { status: 200 }))
    await expect(downloadImageUrl('https://cdn.example.com/x.png', 100, new AbortController().signal, fetchImpl))
      .rejects.toThrow(/byte limit/)
  })
})
