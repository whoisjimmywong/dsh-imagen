import { describe, expect, it } from 'vitest'
import { resolveConfig, resolveSource } from '../src/config.ts'

describe('resolveConfig', () => {
  it('applies defaults to an empty config', () => {
    const config = resolveConfig({})
    expect(config.sources).toEqual({})
    expect(config.save).toEqual({ enabled: true, dir: 'generated-images', nameTemplate: '{prompt}-{timestamp}' })
    expect(config.discovery.enabled).toBe(true)
    expect(config.defaults).toEqual({ outputFormat: 'png', n: 1 })
    expect(config.limits).toMatchObject({ timeoutMs: 120000, maxRetries: 2, maxConcurrent: 2 })
  })

  it('validates sources and credential refs', () => {
    const config = resolveConfig({
      sources: { stepfun: { baseUrl: 'https://api.stepfun.com/v1/', credential: 'STEPFUN_KEY' } },
    })
    const source = config.sources.stepfun!
    expect(source.baseUrl).toBe('https://api.stepfun.com/v1')
    expect(String(source.credential)).toBe('STEPFUN_KEY')
  })

  it('rejects invalid base URLs', () => {
    expect(() => resolveSource({ baseUrl: 'ftp://nope', credential: 'K' })).toThrow(/http/)
    expect(() => resolveSource({ baseUrl: 'http://api.insecure.example/v1', credential: 'K' })).toThrow(/https/)
    expect(() => resolveSource({ baseUrl: 'https://x.example/v1?q=1', credential: 'K' })).toThrow(/baseUrl/i)
  })

  it('rejects unknown defaultSource', () => {
    expect(() => resolveConfig({ sources: { a: { baseUrl: 'https://a.example/v1', credential: 'K' } }, defaultSource: 'b' })).toThrow(/defaultSource/)
  })

  it('rejects traversal in save.dir', () => {
    expect(() => resolveConfig({ save: { dir: '../outside' } })).toThrow(/save\.dir/)
    expect(() => resolveConfig({ save: { dir: 'a/../b' } })).toThrow(/save\.dir/)
  })

  it('validates limits bounds', () => {
    expect(() => resolveConfig({ limits: { maxConcurrent: 99 } })).toThrow(/maxConcurrent/)
    expect(() => resolveConfig({ limits: { timeoutMs: 100 } })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ defaults: { n: 8 } })).toThrow(/defaults\.n/)
  })

  it('normalizes a pinned model and extra patterns', () => {
    const config = resolveConfig({
      sources: { a: { baseUrl: 'https://a.example/v1', credential: 'K', model: 'flux-1-dev' } },
      discovery: { extraPatterns: ['my-photo-.*'] },
      defaults: { size: '1024x1024', quality: 'high' },
    })
    expect(config.sources.a?.model).toBe('flux-1-dev')
    expect(config.discovery.extraPatterns).toEqual(['my-photo-.*'])
    expect(config.defaults).toMatchObject({ size: '1024x1024', quality: 'high' })
  })
})
