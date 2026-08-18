/** Browser plugin: animated image-generation tool card with saved-path display. */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ClientContext, SessionId, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IMAGEN_RPC_CHANNEL, IMAGEN_RPC_ENDPOINT } from '../rpc.ts'
import {
  PRESENTATION_SCHEMA,
  REFERENCE_MARKER,
  REFERENCE_SCHEMA,
  RESULT_SCHEMA,
  type ImageGenerationValue,
  type ImageProgressValue,
  type ImageReferenceValue,
  type ImageRefValue,
} from '../types.ts'
import { IMAGEN_STYLES, IMAGEN_SETTINGS_STYLES } from './styles.ts'
import { installPluginCard } from './settings.tsx'

const NS = 'dsh.imagen' as const
const POLL_MS = 650

const en = {
  generating: 'Generating image',
  generated: 'Image generated',
  failed: 'Image generation failed',
  discovering: 'Discovering image models',
  requesting: 'Contacting image API',
  rendering: 'Rendering pixels',
  saving: 'Saving image files',
  waiting: 'Preparing',
  ready: 'Saved to workspace',
  preview: 'Preview',
  download: 'Download',
  close: 'Close',
  details: 'Prompt & details',
  loading: 'Loading final image',
  unavailable: 'The saved image is unavailable. Reload the page or check Host logs.',
  noOutput: 'The provider did not return a usable image.',
  savedTo: 'Saved to',
  images: 'images',
  settingsNav: 'Image generation',
  settingsTitle: 'Image generation (dsh-imagen)',
  settingsIntro: 'Configure the OpenAI-compatible image sources the agent may use, automatic workspace saving, model discovery, and operation limits. Secrets stay in DSH credentials — only the credential name is stored here.',
  settingsSources: 'Sources',
  settingsNoSources: 'No source configured yet. Add at least one source, then store its API key in DSH credentials and enter the credential name below.',
  settingsSourceName: 'Source name',
  settingsSourceBaseUrl: 'Base URL',
  settingsSourceCredential: 'Credential',
  settingsCredentialHint: 'Name of the DSH credential holding the API key (e.g. IMAGE_API_KEY).',
  settingsSourceModel: 'Model (optional)',
  settingsModelPlaceholder: 'auto-discover',
  settingsRemove: 'Remove',
  settingsAddSource: 'Add source',
  settingsDefaultSource: 'Default source (optional)',
  settingsSave: 'Save',
  settingsSaveEnabled: 'Automatically save generated images to the workspace',
  settingsSaveDir: 'Save directory',
  settingsNameTemplate: 'Name template',
  settingsDiscovery: 'Model discovery',
  settingsDiscoveryEnabled: 'Discover image models via GET /v1/models',
  settingsPatterns: 'Extra name patterns',
  settingsPatternsHint: 'Comma-separated regexes appended to the built-in image-model matcher.',
  settingsDefaults: 'Defaults',
  settingsDefaultSize: 'Default size',
  settingsDefaultQuality: 'Default quality',
  settingsProviderDefault: 'Provider default',
  settingsDefaultFormat: 'Output format',
  settingsDefaultCount: 'Images per call (1-4)',
  settingsLimits: 'Limits',
  settingsTimeoutMs: 'Timeout (ms)',
  settingsMaxRetries: 'Max retries',
  settingsRetryBaseMs: 'Retry base (ms)',
  settingsMaxConcurrent: 'Max concurrent',
  settingsMaxImageBytes: 'Max image bytes',
  settingsMaxReferenceBytes: 'Max reference bytes',
  settingsDiscard: 'Discard',
  settingsSaved: 'Settings saved.',
  settingsSaveFailed: 'Failed to save settings.',
  settingsUnavailable: 'The imagen settings namespace is not reachable. Add "imagen" to web_settings_namespaces in ~/.dsh/settings.yaml, then reload this page.',
  settingsLoading: 'Loading settings…',
} as const

type LocaleKey = keyof typeof en

const zh: Record<LocaleKey, string> = {
  generating: '正在生成图片',
  generated: '图片已生成',
  failed: '图片生成失败',
  discovering: '正在发现生图模型',
  requesting: '正在连接图片 API',
  rendering: '正在渲染像素',
  saving: '正在保存图片文件',
  waiting: '正在准备',
  ready: '已保存到工作区',
  preview: '预览',
  download: '下载',
  close: '关闭',
  details: '提示词与详情',
  loading: '正在加载最终图片',
  unavailable: '无法读取已保存图片。请刷新页面或查看 Host 日志。',
  noOutput: '服务未返回可用图片。',
  savedTo: '已保存到',
  images: '张',
  settingsNav: '图片生成',
  settingsTitle: '图片生成（dsh-imagen）',
  settingsIntro: '配置 Agent 可用的 OpenAI 兼容生图源、工作区自动保存、模型发现与运行边界。密钥始终存放在 DSH 凭据中——这里只保存凭据名称。',
  settingsSources: '生图源（Sources）',
  settingsNoSources: '尚未配置生图源。请至少添加一个源，先把 API Key 存进 DSH 凭据，再在此填写凭据名称。',
  settingsSourceName: '源名称',
  settingsSourceBaseUrl: 'Base URL',
  settingsSourceCredential: '凭据',
  settingsCredentialHint: '持有 API Key 的 DSH 凭据名称（如 IMAGE_API_KEY）。',
  settingsSourceModel: '模型（可选）',
  settingsModelPlaceholder: '自动发现',
  settingsRemove: '移除',
  settingsAddSource: '添加生图源',
  settingsDefaultSource: '默认源（可选）',
  settingsSave: '保存',
  settingsSaveEnabled: '生成后自动保存图片到工作区',
  settingsSaveDir: '保存目录',
  settingsNameTemplate: '命名模板',
  settingsDiscovery: '模型发现',
  settingsDiscoveryEnabled: '通过 GET /v1/models 自动发现生图模型',
  settingsPatterns: '额外名称模式',
  settingsPatternsHint: '逗号分隔的正则，追加到内置生图模型匹配器之后。',
  settingsDefaults: '默认参数',
  settingsDefaultSize: '默认尺寸',
  settingsDefaultQuality: '默认质量',
  settingsProviderDefault: '厂商默认',
  settingsDefaultFormat: '输出格式',
  settingsDefaultCount: '每次张数（1-4）',
  settingsLimits: '运行边界',
  settingsTimeoutMs: '超时（毫秒）',
  settingsMaxRetries: '最大重试',
  settingsRetryBaseMs: '重试基数（毫秒）',
  settingsMaxConcurrent: '最大并发',
  settingsMaxImageBytes: '单图字节上限',
  settingsMaxReferenceBytes: '参考图字节上限',
  settingsDiscard: '放弃修改',
  settingsSaved: '设置已保存。',
  settingsSaveFailed: '保存设置失败。',
  settingsUnavailable: '无法连接 imagen 设置命名空间。请在 ~/.dsh/settings.yaml 的 web_settings_namespaces 中加入 imagen 后刷新本页。',
  settingsLoading: '正在加载设置…',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Image generation tool-card copy. */
    'dsh.imagen': LocaleKey
  }
}

type Translate = (key: LocaleKey) => string

interface ImagenCardInjectedProps {
  t: Translate
  requestProgress: (sessionId: SessionId, callId: string, signal: AbortSignal) => Promise<ImageProgressValue>
  requestImage: (sessionId: SessionId, callId: string, path: string, signal: AbortSignal) => Promise<{ mediaType: string; width?: number; height?: number; data: string }>
}

type ImagenCardProps = PropsRuntime<'tool.call.toolview'> & ImagenCardInjectedProps

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function resultOf(block: ToolCallBlock): ImageGenerationValue | undefined {
  if ('kind' in block) {
    if (isRecord(block.meta) && block.meta.schema === PRESENTATION_SCHEMA && isRecord(block.meta.result)) {
      const result = block.meta.result
      if (result.schema === RESULT_SCHEMA && result.callId === block.callId) {
        return block.meta.result as unknown as ImageGenerationValue
      }
    }
    const marker = block.content
      .filter(item => item.type === 'text')
      .map(item => item.type === 'text' ? referenceFromText(item.text) : undefined)
      .find((item): item is ImageReferenceValue => item !== undefined && item.callId === block.callId)
    if (marker !== undefined) {
      return {
        schema: RESULT_SCHEMA,
        callId: marker.callId,
        source: marker.source,
        model: marker.model,
        prompt: '',
        images: marker.images,
        savedTo: marker.savedTo,
        outputFormat: marker.outputFormat,
        elapsedMs: marker.elapsedMs,
        ...(marker.size === undefined ? {} : { size: marker.size }),
        ...(marker.quality === undefined ? {} : { quality: marker.quality }),
        ...(marker.usage === undefined ? {} : { usage: marker.usage }),
      }
    }
  }
  return undefined
}

function resultError(block: ToolCallBlock, fallback: string): string {
  if (!('kind' in block) || !block.isError) return ''
  const text = block.content
    .filter(item => item.type === 'text')
    .map(item => item.type === 'text' ? item.text : '')
    .join('\n')
    .trim()
  return text || fallback
}

function dataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`
}

function blobUrl(mediaType: string, data: string): string {
  if (typeof URL.createObjectURL !== 'function') return dataUrl(mediaType, data)
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return URL.createObjectURL(new Blob([bytes], { type: mediaType }))
}

function aspectRatio(result: ImageGenerationValue | undefined, index: number): number {
  const image = result?.images[index]
  if (image !== undefined && image.width !== undefined && image.height !== undefined && image.width > 0 && image.height > 0) {
    return image.width / image.height
  }
  return 1
}

function elapsedLabel(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function ImageMark() {
  return (
    <span className="dshImagen__mark" aria-hidden>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
        <rect x="3" y="4" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8.5" cy="9" r="1.6" fill="currentColor" />
        <path d="M4 16.5l4.4-4.2a1.2 1.2 0 0 1 1.7 0l3.2 3.1 1.9-1.8a1.2 1.2 0 0 1 1.7 0L20 16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17.4 4.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" fill="currentColor" opacity=".8" />
      </svg>
    </span>
  )
}

/** The session-scoped card for one generate_image call. */
function ImagenCard({ sessionId, callId, block, t, requestProgress, requestImage }: ImagenCardProps) {
  const result = useMemo(() => resultOf(block), [block])
  const settled = 'kind' in block
  const failed = settled && (block.isError || result === undefined)
  const [progress, setProgress] = useState<ImageProgressValue | undefined>()
  const [images, setImages] = useState<Array<{ url: string; mediaType: string }>>([])
  const [loadError, setLoadError] = useState(false)
  const [lightbox, setLightbox] = useState<number | undefined>()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (settled) return
    const controller = new AbortController()
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const next = await requestProgress(sessionId, callId, controller.signal)
        if (!live) return
        setProgress(next)
      } catch {
        if (!controller.signal.aborted && live) setProgress(undefined)
      }
      if (live) timer = setTimeout(() => { void poll() }, POLL_MS)
    }
    void poll()
    return () => {
      live = false
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [callId, requestProgress, sessionId, settled])

  useEffect(() => {
    if (result === undefined || result.images.length === 0) return
    const controller = new AbortController()
    let live = true
    const objectUrls: string[] = []
    setLoadError(false)
    setImages([])
    void Promise.all(result.images.map((image) => requestImage(sessionId, callId, image.path, controller.signal))).then((loaded) => {
      if (!live) return
      setImages(loaded.map((item) => ({ url: blobUrl(item.mediaType, item.data), mediaType: item.mediaType })))
    }).catch(() => { if (live) setLoadError(true) })
    return () => {
      live = false
      controller.abort()
      for (const url of objectUrls) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      }
    }
  }, [callId, requestImage, result, sessionId])

  useEffect(() => {
    if (lightbox === undefined) return
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setLightbox(undefined) }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [lightbox])

  const prompt = result?.prompt || ''
  const partial = !settled && progress?.partial !== undefined
    ? dataUrl(progress.partial.format === 'jpeg' ? 'image/jpeg' : `image/${progress.partial.format}`, progress.partial.data)
    : undefined
  const current = images[active]
  const src = current?.url ?? partial
  const ratio = aspectRatio(result, active)
  const state = failed ? 'error' : settled ? 'done' : 'running'
  const phase = progress?.state === 'discovering'
    ? t('discovering')
    : progress?.state === 'requesting'
      ? t('requesting')
      : progress?.state === 'generating'
        ? t('rendering')
        : progress?.state === 'saving'
          ? t('saving')
          : settled && images.length > 0
            ? t('ready')
            : settled && result !== undefined && !loadError
              ? t('loading')
              : t('waiting')
  const title = failed ? t('failed') : settled ? t('generated') : t('generating')
  const startedAt = progress?.startedAt || ('time' in block ? block.time : Date.now())
  const elapsed = result?.elapsedMs ?? Math.max(0, Date.now() - startedAt)
  const error = failed
    ? settled && block.isError ? resultError(block, t('noOutput')) : t('noOutput')
    : loadError ? t('unavailable') : ''

  const download = (index: number): void => {
    const item = images[index]
    const ref = result?.images[index]
    if (item === undefined || ref === undefined) return
    const anchor = document.createElement('a')
    anchor.href = item.url
    anchor.download = ref.relPath.split('/').pop() || `image-${index + 1}`
    anchor.click()
  }

  return (
    <article className="dshImagen" data-state={state} aria-busy={!settled}>
      <header className="dshImagen__header">
        <ImageMark />
        <div className="dshImagen__heading">
          <div className="dshImagen__title">{title}</div>
          <div className="dshImagen__subtitle">{failed ? result?.model ?? '' : phase}</div>
        </div>
        <span className="dshImagen__state"><span className="dshImagen__dot" />{elapsedLabel(elapsed)}</span>
      </header>

      <div className="dshImagen__stage" style={{ '--ig-ratio': String(ratio) } as CSSProperties}>
        {!settled && <><span className="dshImagen__scan" /><span className="dshImagen__orb" /></>}
        {src !== undefined && <img key={src.slice(-32)} className="dshImagen__image" src={src} alt={prompt || title} />}
        {partial !== undefined && images.length === 0 && <span className="dshImagen__draft">{t('rendering')}</span>}
        {error !== '' && <div className="dshImagen__error" role="alert">{error}</div>}
      </div>

      {images.length > 1 && (
        <div className="dshImagen__gallery">
          {images.map((item, index) => (
            <img
              key={item.url}
              className="dshImagen__thumb"
              src={item.url}
              alt={`${index + 1}`}
              style={{ border: index === active ? '2px solid var(--ds-accent, #7aa2f7)' : undefined }}
              onClick={() => { setActive(index) }}
            />
          ))}
        </div>
      )}

      <footer className="dshImagen__footer">
        {prompt !== '' && <div className="dshImagen__prompt">{prompt}</div>}
        <div className="dshImagen__meta">
          <span className="dshImagen__chip">{result?.source ?? ''}</span>
          <span className="dshImagen__chip">{result?.model ?? ''}</span>
          {result?.size !== undefined && <span className="dshImagen__chip">{result.size}</span>}
          {result?.quality !== undefined && <span className="dshImagen__chip">{result.quality}</span>}
          <span className="dshImagen__chip">{(result?.outputFormat ?? 'png').toUpperCase()}</span>
          {result !== undefined && result.images.length > 1 && <span className="dshImagen__chip">{result.images.length}{t('images')}</span>}
          {progress !== undefined && progress.attempt > 1 && <span className="dshImagen__chip">attempt {progress.attempt}</span>}
          {images.length > 0 && (
            <span className="dshImagen__actions">
              <button type="button" className="dshImagen__button" onClick={() => { setLightbox(active) }}>{t('preview')}</button>
              <button type="button" className="dshImagen__button" onClick={() => { download(active) }}>{t('download')}</button>
            </span>
          )}
        </div>
        {result !== undefined && result.savedTo.length > 0 && (
          <div className="dshImagen__saved dshImagen__chip" title={result.savedTo.join('\n')}>
            {t('savedTo')} {result.savedTo.join(', ')}
          </div>
        )}
        <details className="dshImagen__details">
          <summary>{t('details')}</summary>
          {prompt !== '' && <p>{prompt}</p>}
          {result?.usage !== undefined && (
            <p>{`${result.model} · ${result.usage.totalTokens} tokens · ${elapsedLabel(result.elapsedMs)}`}</p>
          )}
        </details>
      </footer>

      {lightbox !== undefined && images[lightbox] !== undefined && (
        <div className="dshImagen__lightbox" role="dialog" aria-modal="true" aria-label={t('preview')} onClick={() => { setLightbox(undefined) }}>
          <img src={images[lightbox].url} alt={prompt || title} onClick={event => { event.stopPropagation() }} />
          <button type="button" className="dshImagen__button" onClick={() => { setLightbox(undefined) }}>{t('close')}</button>
        </div>
      )}
    </article>
  )
}

function decodeProgress(value: unknown): ImageProgressValue {
  if (!isRecord(value)
    || (value.state !== 'missing' && value.state !== 'discovering' && value.state !== 'requesting'
      && value.state !== 'generating' && value.state !== 'saving')
    || typeof value.revision !== 'number'
    || typeof value.attempt !== 'number'
    || typeof value.startedAt !== 'number') throw new Error('Host returned invalid image progress')
  return value as unknown as ImageProgressValue
}

function decodeImage(value: unknown): { mediaType: string; width?: number; height?: number; data: string } {
  if (!isRecord(value) || typeof value.data !== 'string' || typeof value.mediaType !== 'string') {
    throw new Error('Host returned invalid image data')
  }
  return {
    mediaType: value.mediaType,
    data: value.data,
    ...(typeof value.width === 'number' ? { width: value.width } : {}),
    ...(typeof value.height === 'number' ? { height: value.height } : {}),
  }
}

/** Register the localized keyed tool card, the settings page, and lifecycle CSS. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/** Browser Cordis plugin entry. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('dsh-imagen requires the Client connection service')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-imagen: locale dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-imagen'
    style.textContent = `${IMAGEN_STYLES}\n${IMAGEN_SETTINGS_STYLES}`
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-imagen: card styles')
  const t = ctx.locale.bind(NS) as Translate
  const call = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> => {
    if (!connection.isLoopback) throw new Error('Image previews are available only from the local DSH page')
    const result = await connection.rpc.call(IMAGEN_RPC_CHANNEL, endpoint, payload, signal)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'generate_image',
    locale: NS,
    inject: () => ({
      t,
      requestProgress: async (sessionId: SessionId, callId: string, signal: AbortSignal) => decodeProgress(
        await call(IMAGEN_RPC_ENDPOINT.progress, { sessionId: String(sessionId), callId }, signal),
      ),
      requestImage: async (sessionId: SessionId, callId: string, path: string, signal: AbortSignal) => decodeImage(
        await call(IMAGEN_RPC_ENDPOINT.image, { sessionId: String(sessionId), callId, path }, signal),
      ),
    }),
  }, ImagenCard))
  installPluginCard(ctx, t as (key: string) => string)
}
