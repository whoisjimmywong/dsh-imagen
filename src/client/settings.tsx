/** Browser settings card for dsh-imagen: a pragmatic form over the host
 *  `imagen` settings namespace (sources, save, discovery, defaults, limits).
 *
 *  Placement: the family "Plugins → 插件配置" group (`web-ui.plugin.item`
 *  slot), like modlens and describe-image. The scope binds through the family
 *  settings bridge (`webUiSettings.bind`) when available, falling back to the
 *  official settings scope — see `@linxin666/dsh-client-ui-web-ui-settings`.
 *  The bridge serves namespaces listed in the user's `web_settings_namespaces`
 *  allowlist in `~/.dsh/settings.yaml` (intersected with host-registered
 *  namespaces), so deployments must add `imagen` there. */

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One family plugin card inside the Web UI Plugins group. */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional rc.6 compatibility binder provided by dsh-web-ui-settings. */
    webUiSettings?: { bind<S>(spec: { namespace: string }): SettingsScope<S> }
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
  scope: SettingsScope<ImagenSettingsDraft>
  t: Translate
}

type Props = PropsRuntime<'web-ui.plugin.item'> & Injected

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

/** The family plugin-config card (Plugins → 插件配置) for dsh-imagen. */
function ImagenSettingsCard({ scope, t }: Props) {
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.status === 'ready' ? snapshot.value : undefined
  const [sourceRows, setSourceRows] = useState<SourceRow[]>(() => toSources(value))
  const [defaultSource, setDefaultSource] = useState(value?.defaultSource ?? '')
  const [saveEnabled, setSaveEnabled] = useState(value?.save?.enabled ?? true)
  const [saveDir, setSaveDir] = useState(value?.save?.dir ?? 'generated-images')
  const [nameTemplate, setNameTemplate] = useState(value?.save?.nameTemplate ?? '{prompt}-{timestamp}')
  const [discoveryEnabled, setDiscoveryEnabled] = useState(value?.discovery?.enabled ?? true)
  const [extraPatterns, setExtraPatterns] = useState(() => patternsText(value))
  const [defaultSize, setDefaultSize] = useState(value?.defaults?.size ?? '')
  const [defaultQuality, setDefaultQuality] = useState(value?.defaults?.quality ?? '')
  const [defaultFormat, setDefaultFormat] = useState(value?.defaults?.outputFormat ?? 'png')
  const [defaultN, setDefaultN] = useState(value?.defaults?.n ?? 1)
  const [timeoutMs, setTimeoutMs] = useState(value?.limits?.timeoutMs ?? 120_000)
  const [maxRetries, setMaxRetries] = useState(value?.limits?.maxRetries ?? 2)
  const [retryBaseMs, setRetryBaseMs] = useState(value?.limits?.retryBaseMs ?? 1_000)
  const [maxConcurrent, setMaxConcurrent] = useState(value?.limits?.maxConcurrent ?? 2)
  const [maxImageBytes, setMaxImageBytes] = useState(value?.limits?.maxImageBytes ?? 20_000_000)
  const [maxReferenceBytes, setMaxReferenceBytes] = useState(value?.limits?.maxReferenceBytes ?? 10_000_000)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>()

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

  // Re-seed from the authoritative snapshot whenever it changes.
  useEffect(() => {
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    setSourceRows(toSources(snapshot.value))
    setDefaultSource(snapshot.value.defaultSource ?? '')
    setSaveEnabled(snapshot.value.save?.enabled ?? true)
    setSaveDir(snapshot.value.save?.dir ?? 'generated-images')
    setNameTemplate(snapshot.value.save?.nameTemplate ?? '{prompt}-{timestamp}')
    setDiscoveryEnabled(snapshot.value.discovery?.enabled ?? true)
    setExtraPatterns(patternsText(snapshot.value))
    setDefaultSize(snapshot.value.defaults?.size ?? '')
    setDefaultQuality(snapshot.value.defaults?.quality ?? '')
    setDefaultFormat(snapshot.value.defaults?.outputFormat ?? 'png')
    setDefaultN(snapshot.value.defaults?.n ?? 1)
    setTimeoutMs(snapshot.value.limits?.timeoutMs ?? 120_000)
    setMaxRetries(snapshot.value.limits?.maxRetries ?? 2)
    setRetryBaseMs(snapshot.value.limits?.retryBaseMs ?? 1_000)
    setMaxConcurrent(snapshot.value.limits?.maxConcurrent ?? 2)
    setMaxImageBytes(snapshot.value.limits?.maxImageBytes ?? 20_000_000)
    setMaxReferenceBytes(snapshot.value.limits?.maxReferenceBytes ?? 10_000_000)
    setMessage(undefined)
  }, [snapshot])

  const dirty = useMemo(
    () => JSON.stringify(buildDraft()) !== JSON.stringify(snapshot.value ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceRows, defaultSource, saveEnabled, saveDir, nameTemplate, discoveryEnabled, extraPatterns, defaultSize, defaultQuality, defaultFormat, defaultN, timeoutMs, maxRetries, retryBaseMs, maxConcurrent, maxImageBytes, maxReferenceBytes, snapshot],
  )

  const updateRow = (index: number, patch: Partial<SourceRow>): void => {
    setSourceRows(rows => rows.map((row, at) => at === index ? { ...row, ...patch } : row))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      const draft = buildDraft()
      await scope.set('sources', draft.sources ?? {})
      await scope.set('defaultSource', draft.defaultSource ?? '')
      await scope.set('save', draft.save)
      await scope.set('discovery', draft.discovery)
      await scope.set('defaults', draft.defaults)
      await scope.set('limits', draft.limits)
      setMessage({ kind: 'ok', text: t('settingsSaved') })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : t('settingsSaveFailed') })
    } finally {
      setBusy(false)
    }
  }

  if (snapshot.status === 'unavailable') {
    return <div className="dshImagenSet__page"><p>{t('settingsUnavailable')}</p></div>
  }
  if (snapshot.status === 'loading' || snapshot.value === undefined) {
    return <div className="dshImagenSet__page"><p>{t('settingsLoading')}</p></div>
  }

  return (
    <div className="dshImagenSet__page">
      <h2 className="dshImagenSet__heading">{t('settingsTitle')}</h2>
      <p className="dshImagenSet__intro">{t('settingsIntro')}</p>

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

      <div className="dshImagenSet__actions">
        <button type="button" className="dshImagenSet__button" disabled={busy || !dirty} onClick={() => { void save() }}>{t('settingsSave')}</button>
        <button type="button" className="dshImagenSet__button" disabled={busy} onClick={() => { setMessage(undefined) }}>{t('settingsDiscard')}</button>
        {message !== undefined && (
          <span className={message.kind === 'ok' ? 'dshImagenSet__ok' : 'dshImagenSet__error'}>{message.text}</span>
        )}
      </div>
    </div>
  )
}

/** Register the family plugin card; slot lifecycle is fiber-owned. */
export function installPluginCard(ctx: ClientContext, t: Translate): void {
  // Access both services through ctx.get: cordis guards direct property access
  // with "cannot get property without inject", and webUiSettings is optional.
  const webUi = ctx.get('webUiSettings') as { bind<S>(spec: { namespace: string }): SettingsScope<S> } | undefined
  const official = ctx.get('settingsScope') as { bind<S>(spec: { namespace: string }): SettingsScope<S> } | undefined
  const binder = webUi ?? official
  if (binder === undefined) return
  const scope = binder.bind<ImagenSettingsDraft>({ namespace: 'imagen' })
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'imagen',
    order: 30,
    inject: () => ({ scope, t }),
  }, ImagenSettingsCard))
}
