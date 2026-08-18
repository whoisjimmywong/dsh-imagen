/**
 * Deterministic mock OpenAI-compatible image API for local testing of
 * dsh-imagen without a real key or network access.
 *
 *   node scripts/mock-image-api.mjs            # http://127.0.0.1:8787
 *
 * Endpoints (all under /v1):
 *   GET  /v1/models                          -> { data: [{ id, ... }] }
 *   POST /v1/images/generations              -> { data: [{ b64_json }] } (+ usage)
 *   POST /v1/images/edits                    -> same (multipart accepted)
 *
 * Pass `stream: true` in the JSON body to get an SSE demo with a
 * `image_generation.partial_image` followed by `image_generation.completed`.
 * The returned image is a real 8x8 PNG.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 8787)

// A real, minimal 8x8 PNG (solid dark-blue square).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIklEQVR4nGP8z8Dwn4EIwESj/lGjGDVq1KhRo0aNGjVqFEYAJ3YDHSy9QH0AAAAASUVORK5CYII=',
  'base64',
)
const PNG_B64 = PNG.toString('base64')

const MODELS = [
  { id: 'gpt-image-2', owned_by: 'mock' },
  { id: 'flux-1-dev', owned_by: 'mock' },
  { id: 'dall-e-3', owned_by: 'mock' },
  { id: 'deepseek-chat', owned_by: 'mock' }, // must NOT be detected as image model
  { id: 'qwen-vl-max', owned_by: 'mock' },   // must NOT be detected as image model
]

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseBody(req, raw) {
  const type = (req.headers['content-type'] ?? '').split(';')[0]
  if (type === 'application/json') return JSON.parse(raw.toString('utf8') || '{}')
  if (type === 'multipart/form-data') {
    // Very light multipart parse: just check an image part exists.
    return { _multipart: true, imageCount: (raw.toString('latin1').match(/name="image"/g) ?? []).length }
  }
  return {}
}

async function handleGenerations(req, res) {
  const raw = await readBody(req)
  const body = parseBody(req, raw)
  const usage = { input_tokens: 12, output_tokens: 24, total_tokens: 36 }
  if (body.stream === true) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ type: 'image_generation.partial_image', b64_json: PNG_B64, partial_image_index: 0, output_format: 'png' })}\n\n`)
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ type: 'image_generation.completed', b64_json: PNG_B64, size: '256x256', quality: 'high', output_format: 'png', usage })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }, 300)
    return
  }
  const n = typeof body.n === 'number' ? Math.min(4, Math.max(1, body.n)) : 1
  // Async task mode (like DashScope-style relays): pass task: true to exercise
  // the poll flow; the client polls GET /v1/images/generations/{id}.
  if (body.task === true) {
    const id = `tsk_mock_${randomUUID().slice(0, 8)}`
    const url = `http://127.0.0.1:${PORT}/v1/files/${id}.png`
    setTimeout(() => { tasks.set(id, 'completed') }, 1200)
    return json(res, 200, { object: 'generation.task', id, status: 'pending', progress: 0, created_at: Math.floor(Date.now() / 1000) })
  }
  const data = Array.from({ length: n }, () => ({ b64_json: PNG_B64, size: body.size ?? '256x256', output_format: body.output_format ?? 'png' }))
  json(res, 200, { created: Math.floor(Date.now() / 1000), data, usage })
}

/** Completed async task states (id -> status). */
const tasks = new Map()

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return json(res, 200, { object: 'list', data: MODELS })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/images/generations/tsk_')) {
    const id = url.pathname.split('/').pop()
    const status = tasks.get(id) ?? 'in_progress'
    if (status === 'completed') {
      return json(res, 200, {
        id, status: 'completed', progress: 100,
        result: { type: 'image', data: [{ url: `http://127.0.0.1:${PORT}/v1/files/${id}.png` }] },
      })
    }
    return json(res, 200, { id, status, progress: 40, created_at: Math.floor(Date.now() / 1000) })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/files/')) {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    return res.end(PNG)
  }
  if (req.method === 'POST' && (url.pathname === '/v1/images/generations' || url.pathname === '/v1/images/edits')) {
    return handleGenerations(req, res)
  }
  json(res, 404, { error: { message: `mock: not found ${req.method} ${url.pathname}`, code: 'not_found' } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock image API listening on http://127.0.0.1:${PORT}`)
  console.log(`models: ${MODELS.map((m) => m.id).join(', ')}`)
  console.log(`configure dsh-imagen source baseUrl: http://127.0.0.1:${PORT}/v1`)
})
