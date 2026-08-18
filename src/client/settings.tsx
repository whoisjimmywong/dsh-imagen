/** Browser settings card for dsh-imagen: a pragmatic form over the host
 *  `imagen` configuration (sources, save, discovery, defaults, limits).
 *
 *  Placement: the official Plugins configuration page (`settings.plugin.item`
 *  slot), exactly like modlens. rc.6's settings surface renders a fixed set
 *  of cards and does not enumerate settings namespaces (dsh-host-apiproxy
 *  hard-codes WEB_SETTINGS_NAMESPACES), so the card reads and writes through
 *  the plugin's own loopback RPC (`imagen/settings/get|set`) instead of a
 *  settings scope — the browser never needs the apiproxy allowlist. */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One card inside the official Plugins configuration page. */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Client-side mirror of the host configuration (all fields optional). */
export interface ImagenSettingsDraft {
  sources?: Record<string, { baseUrl?: string; credential?: string; model?: string }>
  defaultSource?: string
  save?: { enabled?: boolean; dir?: string; nameTemplate?: string }
  discovery?: { enabled?: boolean; extraPatterns?: string[]; cacheTtlMs?: number }
  defaults?: { size?: string; quality?: string; outputFormat?: string; n?: number }
  limits?: {
    timeoutMs?: number
    maxRetries?: number
    retryBaseMs?: number
    maxConcurrent?: number
    maxImageBytes?: number
    maxReferenceBytes?: number
  }
}

export interface SourceRow {
  name: string
  baseUrl: string
  credential: string
  model: string
}

type Translate = (key: string) => string

interface Injected {
  t: Translate
  loadConfig: () => Promise<ImagenSettingsDraft>
  saveConfig: (config: ImagenSettingsDraft) => Promise<void>
}

type Props = PropsRuntime<'settings.plugin.item'> & Injected

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function toSources(value: ImagenSettingsDraft | undefined): SourceRow[] {
  const sources = value?.sources ?? {}
  const rows: SourceRow[] = []
  for (const [name, source] of Object.entries(sources)) {
    rows.push({ name, baseUrl: source?.baseUrl ?? '', credential: source?.credential ?? '', model: source?.model ?? '' })
  }
  return rows
}

function toDraft(sources: SourceRow[], value: ImagenSettingsDraft | undefined): ImagenSettingsDraft {
  const built: Record<string, { baseUrl: string; credential: string; model?: string }> = {}
  for (const row of sources) {
    const name = row.name.trim()
    if (name === '') continue
    built[name] = {
      baseUrl: row.baseUrl.trim(),
      credential: row.credential.trim(),
      ...(row.model.trim() === '' ? {} : { model: row.model.trim() }),
    }
  }
  return { ...value, sources: built }
}

function patternsText(value: ImagenSettingsDraft | undefined): string {
  return (value?.discovery?.extraPatterns ?? []).join(', ')
}

function parsePatterns(text: string): string[] {
  return text
    .split(/[,;\n]/u)
    .map(part => part.trim())
    .filter(part => part !== '')
}

/** One labeled field wrapper. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="dshImagenSet__field">
      <span className="dshImagenSet__label">{label}</span>
      {children}
      {hint !== undefined && hint !== '' && <span className="dshImagenSet__hint">{hint}</span>}
    </label>
  )
}

function NumberField({
  label, value, min, max, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        className="dshImagenSet__input"
        type="number"
        value={String(value)}
        min={min}
        max={max}
        onChange={event => { onChange(clampInteger(Number(event.target.value), min, max, value)) }}
      />
    </Field>
  )
}

/** The plugin-config card (Plugins → 插件配置) for dsh-imagen. */
function ImagenSettingsCard({ t, loadConfig, saveConfig }: Props) {
  const [open, setOpen] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadError, setLoadError] = useState('')
  const [value, setValue] = useState<ImagenSettingsDraft | undefined>()
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([])
  const [defaultSource, setDefaultSource] = useState('')
  const [saveEnabled, setSaveEnabled] = useState(true)
  const [saveDir, setSaveDir] = useState('generated-images')
  const [nameTemplate, setNameTemplate] = useState('{prompt}-{timestamp}')
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true)
  const [extraPatterns, setExtraPatterns] = useState('')
  const [defaultSize, setDefaultSize] = useState('')
  const [defaultQuality, setDefaultQuality] = useState('')
  const [defaultFormat, setDefaultFormat] = useState('png')
  const [defaultN, setDefaultN] = useState(1)
  const [timeoutMs, setTimeoutMs] = useState(120_000)
  const [maxRetries, setMaxRetries] = useState(2)
  const [retryBaseMs, setRetryBaseMs] = useState(1_000)
  const [maxConcurrent, setMaxConcurrent] = useState(2)
  const [maxImageBytes, setMaxImageBytes] = useState(20_000_000)
  const [maxReferenceBytes, setMaxReferenceBytes] = useState(10_000_000)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>()

  // Load the host config lazily on first expand, like the sibling cards.
  useEffect(() => {
    if (!open || loadedOnce) return
    let live = true
    setPhase('loading')
    setLoadError('')
    void loadConfig().then((config) => {
      if (!live) return
      setValue(config)
      setSourceRows(toSources(config))
      setDefaultSource(config.defaultSource ?? '')
      setSaveEnabled(config.save?.enabled ?? true)
      setSaveDir(config.save?.dir ?? 'generated-images')
      setNameTemplate(config.save?.nameTemplate ?? '{prompt}-{timestamp}')
      setDiscoveryEnabled(config.discovery?.enabled ?? true)
      setExtraPatterns(patternsText(config))
      setDefaultSize(config.defaults?.size ?? '')
      setDefaultQuality(config.defaults?.quality ?? '')
      setDefaultFormat(config.defaults?.outputFormat ?? 'png')
      setDefaultN(config.defaults?.n ?? 1)
      setTimeoutMs(config.limits?.timeoutMs ?? 120_000)
      setMaxRetries(config.limits?.maxRetries ?? 2)
      setRetryBaseMs(config.limits?.retryBaseMs ?? 1_000)
      setMaxConcurrent(config.limits?.maxConcurrent ?? 2)
      setMaxImageBytes(config.limits?.maxImageBytes ?? 20_000_000)
      setMaxReferenceBytes(config.limits?.maxReferenceBytes ?? 10_000_000)
      setPhase('ready')
    }).catch((error) => {
      if (!live) return
      setLoadError(error instanceof Error ? error.message : String(error))
      setPhase('error')
    }).finally(() => {
      if (live) setLoadedOnce(true)
    })
    return () => { live = false }
    // loadConfig is stable for the plugin lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadedOnce])

  const buildDraft = (): ImagenSettingsDraft => {
    const defaultSourceValue = defaultSource.trim()
    const sizeValue = defaultSize.trim()
    const qualityValue = defaultQuality.trim()
    return {
      ...toDraft(sourceRows, value),
      ...(defaultSourceValue === '' ? {} : { defaultSource: defaultSourceValue }),
      save: {
        enabled: saveEnabled,
        dir: saveDir.trim(),
        nameTemplate: nameTemplate.trim(),
      },
      discovery: {
        enabled: discoveryEnabled,
        extraPatterns: parsePatterns(extraPatterns),
      },
      defaults: {
        ...(sizeValue === '' ? {} : { size: sizeValue }),
        ...(qualityValue === '' ? {} : { quality: qualityValue }),
        outputFormat: defaultFormat,
        n: defaultN,
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

  const dirty = useMemo(
    () => JSON.stringify(buildDraft()) !== JSON.stringify(value ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceRows, defaultSource, saveEnabled, saveDir, nameTemplate, discoveryEnabled, extraPatterns, defaultSize, defaultQuality, defaultFormat, defaultN, timeoutMs, maxRetries, retryBaseMs, maxConcurrent, maxImageBytes, maxReferenceBytes, value],
  )

  const updateRow = (index: number, patch: Partial<SourceRow>): void => {
    setSourceRows(rows => rows.map((row, at) => at === index ? { ...row, ...patch } : row))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      await saveConfig(buildDraft())
      setMessage({ kind: 'ok', text: t('settingsSaved') })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : t('settingsSaveFailed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dshImagenCard" data-open={open}>
      <button
        type="button"
        className="dshImagenCard__header"
        onClick={() => { setOpen(value => !value) }}
        aria-expanded={open}
      >
        <span className="dshImagenCard__heading">
          <span className="dshImagenCard__title">{t('settingsTitle')}</span>
          <span className="dshImagenCard__subtitle">{t('settingsIntro')}</span>
        </span>
        <svg className={`dshImagenCard__chevron${open ? ' dshImagenCard__chevron--open' : ''}`} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="dshImagenCard__body">
          {phase === 'loading' && <p className="dshImagenSet__hint">{t('settingsLoading')}</p>}
          {phase === 'error' && <p className="dshImagenSet__error">{loadError || t('settingsLoadFailed')}</p>}
          {phase === 'ready' && (<>
      <section className="dshImagenSet__group">
        <h3 className="dshImagenSet__groupTitle">{t('settingsSources')}</h3>
        {sourceRows.length === 0 && <p className="dshImagenSet__hint">{t('settingsNoSources')}</p>}
        {sourceRows.map((row, index) => (
          <div className="dshImagenSet__sourceCard" key={`${row.name || 'source'}-${index}`}>
            <div className="dshImagenSet__sourceRow">
              <Field label={t('settingsSourceName')}>
                <input className="dshImagenSet__input" value={row.name} onChange={event => { updateRow(index, { name: event.target.value }) }} placeholder="myprovider" />
              </Field>
              <Field label={t('settingsSourceBaseUrl')}>
                <input className="dshImagenSet__input" value={row.baseUrl} onChange={event => { updateRow(index, { baseUrl: event.target.value }) }} placeholder="https://api.example.com/v1" />
              </Field>
            </div>
            <div className="dshImagenSet__sourceRow">
              <Field label={t('settingsSourceCredential')} hint={t('settingsCredentialHint')}>
                <input className="dshImagenSet__input" value={row.credential} onChange={event => { updateRow(index, { credential: event.target.value }) }} placeholder="IMAGE_API_KEY" />
              </Field>
              <Field label={t('settingsSourceModel')}>
                <input className="dshImagenSet__input" value={row.model} onChange={event => { updateRow(index, { model: event.target.value }) }} placeholder={t('settingsModelPlaceholder')} />
              </Field>
            </div>
            <button type="button" className="dshImagenSet__danger" onClick={() => { setSourceRows(rows => rows.filter((_, at) => at !== index)) }}>{t('settingsRemove')}</button>
          </div>
        ))}
        <button type="button" className="dshImagenSet__button" onClick={() => { setSourceRows(rows => [...rows, { name: '', baseUrl: '', credential: '', model: '' }]) }}>{t('settingsAddSource')}</button>
        <Field label={t('settingsDefaultSource')}>
          <input className="dshImagenSet__input" value={defaultSource} onChange={event => { setDefaultSource(event.target.value) }} placeholder="myprovider" />
        </Field>
      </section>

      <section className="dshImagenSet__group">
        <h3 className="dshImagenSet__groupTitle">{t('settingsSave')}</h3>
        <label className="dshImagenSet__check">
          <input type="checkbox" checked={saveEnabled} onChange={event => { setSaveEnabled(event.target.checked) }} />
          <span>{t('settingsSaveEnabled')}</span>
        </label>
        <div className="dshImagenSet__sourceRow">
          <Field label={t('settingsSaveDir')}>
            <input className="dshImagenSet__input" value={saveDir} onChange={event => { setSaveDir(event.target.value) }} />
          </Field>
          <Field label={t('settingsNameTemplate')}>
            <input className="dshImagenSet__input" value={nameTemplate} onChange={event => { setNameTemplate(event.target.value) }} />
          </Field>
        </div>
      </section>

      <section className="dshImagenSet__group">
        <h3 className="dshImagenSet__groupTitle">{t('settingsDiscovery')}</h3>
        <label className="dshImagenSet__check">
          <input type="checkbox" checked={discoveryEnabled} onChange={event => { setDiscoveryEnabled(event.target.checked) }} />
          <span>{t('settingsDiscoveryEnabled')}</span>
        </label>
        <Field label={t('settingsPatterns')} hint={t('settingsPatternsHint')}>
          <input className="dshImagenSet__input" value={extraPatterns} onChange={event => { setExtraPatterns(event.target.value) }} />
        </Field>
      </section>

      <section className="dshImagenSet__group">
        <h3 className="dshImagenSet__groupTitle">{t('settingsDefaults')}</h3>
        <div className="dshImagenSet__sourceRow">
          <Field label={t('settingsDefaultSize')}>
            <input className="dshImagenSet__input" value={defaultSize} onChange={event => { setDefaultSize(event.target.value) }} placeholder="1024x1024" />
          </Field>
          <Field label={t('settingsDefaultQuality')}>
            <select className="dshImagenSet__input" value={defaultQuality} onChange={event => { setDefaultQuality(event.target.value) }}>
              <option value="">{t('settingsProviderDefault')}</option>
              <option value="auto">auto</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </Field>
        </div>
        <div className="dshImagenSet__sourceRow">
          <Field label={t('settingsDefaultFormat')}>
            <select className="dshImagenSet__input" value={defaultFormat} onChange={event => { setDefaultFormat(event.target.value) }}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </Field>
          <NumberField label={t('settingsDefaultCount')} value={defaultN} min={1} max={4} onChange={setDefaultN} />
        </div>
      </section>

      <section className="dshImagenSet__group">
        <h3 className="dshImagenSet__groupTitle">{t('settingsLimits')}</h3>
        <div className="dshImagenSet__sourceRow">
          <NumberField label={t('settingsTimeoutMs')} value={timeoutMs} min={10_000} max={600_000} onChange={setTimeoutMs} />
          <NumberField label={t('settingsMaxRetries')} value={maxRetries} min={0} max={5} onChange={setMaxRetries} />
        </div>
        <div className="dshImagenSet__sourceRow">
          <NumberField label={t('settingsRetryBaseMs')} value={retryBaseMs} min={100} max={30_000} onChange={setRetryBaseMs} />
          <NumberField label={t('settingsMaxConcurrent')} value={maxConcurrent} min={1} max={8} onChange={setMaxConcurrent} />
        </div>
        <div className="dshImagenSet__sourceRow">
          <NumberField label={t('settingsMaxImageBytes')} value={maxImageBytes} min={65_536} max={268_435_456} onChange={setMaxImageBytes} />
          <NumberField label={t('settingsMaxReferenceBytes')} value={maxReferenceBytes} min={16_384} max={268_435_456} onChange={setMaxReferenceBytes} />
        </div>
      </section>

      <div className="dshImagenCard__footer">
        <button type="button" className="dshImagenSet__button" disabled={busy || !dirty} onClick={() => { void save() }}>{t('settingsSave')}</button>
        <button type="button" className="dshImagenSet__button" disabled={busy} onClick={() => { setMessage(undefined) }}>{t('settingsDiscard')}</button>
        {message !== undefined && (
          <span className={message.kind === 'ok' ? 'dshImagenSet__ok' : 'dshImagenSet__error'}>{message.text}</span>
        )}
      </div>
          </>)}
        </div>
      )}
    </div>
  )
}

/** Register the official plugin-config card (slot lifecycle is fiber-owned). */
export function installPluginCard(
  ctx: ClientContext,
  t: Translate,
  call: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
): void {
  const signal = new AbortController().signal
  const loadConfig = async (): Promise<ImagenSettingsDraft> => {
    const value = await call('imagen/settings/get', {}, signal)
    if (typeof value !== 'object' || value === null) throw new Error('Host returned invalid settings')
    return value as ImagenSettingsDraft
  }
  const saveConfig = async (config: ImagenSettingsDraft): Promise<void> => {
    await call('imagen/settings/set', { config }, signal)
  }
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'imagen',
      order: 30,
      inject: () => ({ t, loadConfig, saveConfig }),
    }, ImagenSettingsCard)
  })
}
