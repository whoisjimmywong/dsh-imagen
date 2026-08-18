# dsh-imagen

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Agent-driven image generation for DeepSeek Harness. The agent calls your own OpenAI-compatible image API whenever it needs a picture — text-to-image or image-to-image with reference images — auto-discovers the image models your endpoint exposes, and automatically saves every generated image into your session workspace with a durable in-chat card (preview / lightbox / download).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## What it does

- **`generate_image`** — the agent generates 1–4 images through a configured source (any OpenAI-compatible `baseUrl`). Supports `size`, `quality`, `output_format`, `n`, and provider passthrough params (`negative_prompt`, `steps`, `cfg_scale`, `seed`, …) via `extra`.
- **Image-to-image** — pass `reference_images` (workspace files, https URLs, or pasted attachment JSON) and the provider's `images/edits` endpoint is used, so the agent can edit an existing picture or batch-produce style-consistent variants. Just-generated files are valid references via their saved path.
- **Model auto-discovery** — `GET /v1/models` is queried and image models are detected by name patterns (no hardcoded model lists); `list_image_models` shows the candidates and `model=` overrides.
- **Automatic saving** — every generated image is saved into the workspace save directory (default `generated-images/`) with a deterministic `{prompt}-{timestamp}` name; collisions get `-2`, `-3`, … Files are written atomically. `save: "workspace:<rel-dir>"` redirects to another directory; `save: "none"` skips files. `save_generated_image` copies an existing image to a specific location.
- **Durable card** — the conversation shows an animated card while generating (progress, partial frames when the provider streams SSE), then the finished image with its saved path, preview (lightbox) and download. Reads are loopback-only and authorized per session, so the page survives reloads.
- **Text-only model friendly** — the model receives plain text plus a compact JSON reference; image bytes never enter the session log.

## Security

- **Credentials never touch disk config**: every source references a DSH Credential (`ctx.credentials`), resolved per call. Never put an API key into `cordis.patch.yml`, chat, git, or screenshots.
- Credential-bearing requests use `redirect: "error"`; base URLs must be https (loopback http allowed for local testing) without userinfo/query/fragment.
- Bounded response sizes, a per-call timeout, a concurrency cap (excess calls are rejected immediately, not queued), and retries **only** for transient failures (429/5xx/network).
- Saved paths are forced inside the session workspace; image reads over RPC are authorized against the session's own tool results.

## Installation

Review the source first, then install from the plugin package directory — i.e. run this inside the folder containing this README (it may live anywhere):

```powershell
dsh plugin --profile web add .
```

Restart DSH and refresh the page. The bundle patch inserts the `imagen` row automatically; the tools are registered by the host plugin and the card by the browser bundle.

### 1. Configure a source

Create a DSH credential (Settings → Credentials, or the CLI) named e.g. `IMAGE_API_KEY` holding your key, then add a source in **Settings → 插件配置 → the imagen card** (the card reads and writes through the plugin's own loopback channel — no settings allowlist needed). Or configure the source directly in `~/.dsh/cordis.patch.yml`:

```yaml
- id: imagen
  name: dsh-imagen
  inject: [tools, credentials, connection, sessionPersistence]
  config:
    sources:
      myprovider:
        baseUrl: https://api.myprovider.com/v1   # OpenAI-compatible root; /images/generations, /images/edits, /models appended
        credential: IMAGE_API_KEY                # DSH Credential reference
        # model: flux-1-dev                      # optional: pin a model instead of auto-discovery
    defaultSource: myprovider
    save:
      enabled: true
      dir: generated-images
      nameTemplate: '{prompt}-{timestamp}'
    discovery:
      enabled: true
      extraPatterns: []
    defaults:
      outputFormat: png
      n: 1
    limits:
      timeoutMs: 120000
      maxRetries: 2
      maxConcurrent: 2
```

### 2. Use it

> 生成一张电影感 16:9 的产品摄影：半透明机械键盘放在深色玻璃桌面上，紫色轮廓光，不要文字。

The model calls `generate_image`; the card animates, then shows the saved file (`generated-images/...png`) with preview/download. For edits:

> 把刚才生成的键盘图改成粉色主题，背景换成白色。

(the model passes the saved path as a reference image, or you point it at any workspace file / URL / pasted attachment).

## Local testing without a real key

A deterministic mock OpenAI-compatible server is included — useful to verify the whole pipeline (discovery → generation → saving → card) before wiring a paid endpoint:

```powershell
node scripts/mock-image-api.mjs          # listens on http://127.0.0.1:8787
```

Then configure a source with `baseUrl: http://127.0.0.1:8787/v1` and any credential name, and ask for an image. The mock answers `/v1/models` with `gpt-image-2`-style names and `/v1/images/generations` with a real tiny PNG (it also supports `?partial=1` streaming demo via the `extra` passthrough `stream: true`). Loopback http is allowed by design.

## Development

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run smoke
```

Artifacts (committed): `lib/index.js` (host plugin) and `lib/client.js` (browser bundle).

## Configuration reference

| Field | Default | Meaning |
| --- | --- | --- |
| `sources.<name>.baseUrl` | — | OpenAI-compatible API root (https; loopback http allowed) |
| `sources.<name>.credential` | — | DSH Credential reference holding the API key |
| `sources.<name>.model` | — | Optional pinned model id (skips discovery) |
| `defaultSource` | first source | Source used when the agent names none |
| `save.enabled` | `true` | Auto-save generated images to the workspace |
| `save.dir` | `generated-images` | Save directory, relative to the workspace |
| `save.nameTemplate` | `{prompt}-{timestamp}` | Naming template |
| `discovery.enabled` | `true` | Query `GET /v1/models` and match image model names |
| `discovery.extraPatterns` | `[]` | Extra regex patterns for image model detection |
| `defaults.size / quality / outputFormat / n` | — / — / `png` / `1` | Tool defaults |
| `limits.timeoutMs` | `120000` | Whole-operation timeout (10s–10min) |
| `limits.maxRetries` | `2` | Extra attempts after the first (0–5) |
| `limits.retryBaseMs` | `1000` | Exponential backoff base |
| `limits.maxConcurrent` | `2` | In-flight generation cap (1–8) |
| `limits.maxImageBytes` | `20000000` | Max accepted bytes per returned image |
| `limits.maxReferenceBytes` | `10000000` | Max accepted bytes per reference image |

## Limitations

- Provider `images/edits` support varies; the plugin speaks the OpenAI multipart contract plus the common b64/url response shapes, and surfaces provider errors verbatim otherwise.
- Async task-based providers (DashScope-style relays that return a `generation.task` and expose `GET /images/generations/{id}`) are polled automatically; the mock server (`node scripts/mock-image-api.mjs`) can simulate this with `"task": true` in the request body.
- Final previews are loopback-only (the local DSH page); remote web clients see an explicit unavailable state, never the bytes.
- Reference images by pasted attachment require the attachment service (`dsh-attachment`, mounted by default in the web profile).

## License

MIT
