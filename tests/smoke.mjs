/** Smoke test for the built artifacts: load lib/index.js with a stub ctx. */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function assert(condition, message) {
  if (!condition) throw new Error(`smoke assertion failed: ${message}`)
}

const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)

assert(mod.name === 'imagen', `name is ${mod.name}`)
assert(typeof mod.apply === 'function', 'apply is a function')
assert(typeof mod.resolveConfig === 'function', 'resolveConfig exported')
assert(typeof mod.ImageClient === 'function', 'ImageClient exported')

const resolved = mod.resolveConfig({
  sources: { demo: { baseUrl: 'https://api.example.com/v1/', credential: 'IMAGE_KEY' } },
  save: { dir: 'generated-images' },
})
assert(resolved.sources.demo.baseUrl === 'https://api.example.com/v1', 'baseUrl normalized')
assert(resolved.save.enabled === true, 'save defaults applied')
assert(resolved.defaults.outputFormat === 'png', 'outputFormat default applied')

// Apply the plugin against a stub host ctx.
const tools = []
const handlers = new Map()
const effects = []
const ctx = {
  inject: () => {},
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
  logger: { warn: () => {} },
  tools: { register: (tool) => tools.push(tool) },
  connection: { rpc: { handle: (channel, handler) => { handlers.set(channel, handler) } } },
  sessionPersistence: { inspect: async () => ({ events: [] }) },
  credentials: { resolve: async () => undefined },
}
mod.apply(ctx, {
  sources: { demo: { baseUrl: 'https://api.example.com/v1', credential: 'IMAGE_KEY' } },
  save: { dir: 'generated-images' },
})
const names = tools.map((tool) => tool.name)
assert(names.includes('generate_image'), `tools registered: ${names.join(', ')}`)
assert(names.includes('list_image_models'), 'list_image_models registered')
assert(names.includes('save_generated_image'), 'save_generated_image registered')

const generate = tools.find((tool) => tool.name === 'generate_image')
assert(typeof generate.execute === 'function', 'generate_image has execute')
assert(generate.parameters.required.includes('prompt'), 'prompt is required')
assert(generate.parameters.properties.prompt !== undefined, 'prompt parameter declared')
assert(typeof generate.output.render === 'function', 'output.render present')
assert(typeof generate.output.presentationMeta === 'function', 'presentationMeta present')
assert(typeof generate.finalizeContent === 'function', 'finalizeContent present')

const handler = handlers.get('/dsh-imagen')
assert(typeof handler === 'function', 'RPC handler registered on /dsh-imagen')

const signal = new AbortController().signal
const progress = await handler('imagen/progress', { sessionId: 's1', callId: 'c1' }, signal)
assert(progress.ok === true && progress.value.state === 'missing', 'progress returns missing for unknown call')

const badImage = await handler('imagen/image', { sessionId: 's1', callId: 'c1', path: 'C:/evil/x.png' }, signal)
assert(badImage.ok === false, 'unauthorized image read is rejected')

const badModels = await handler('imagen/models', { sessionId: 's1', callId: 'c1', source: 'nope' }, signal)
assert(badModels.ok === false, 'unknown source discovery is rejected')

const badEndpoint = await handler('imagen/nope', { sessionId: 's1', callId: 'c1' }, signal)
assert(badEndpoint.ok === false, 'unknown endpoint is rejected')

// Browser bundle carries the ModuleLoader wrapper.
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
assert(client.includes('__ModuleLoader__.load'), 'client bundle wraps __ModuleLoader__.load')

console.log('smoke ok: host module, tool registration, RPC error paths, client bundle')
