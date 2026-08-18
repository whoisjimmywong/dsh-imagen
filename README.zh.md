# dsh-imagen

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

面向 DeepSeek Harness 的 Agent 自主生图插件。Agent 在需要时自行调用**你自己配置的** OpenAI 兼容图片 API 生成图片 —— 支持文生图与参考图（图生图），自动发现你的端点暴露的生图模型，并把每张成图**自动保存**进会话工作区，同时在会话内呈现可回放的图片卡片（预览 / 灯箱 / 下载）。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## 功能

- **`generate_image`** —— Agent 通过已配置的 source（任意 OpenAI 兼容 `baseUrl`）生成 1–4 张图；支持 `size`、`quality`、`output_format`、`n`，以及经 `extra` 透传的厂商参数（`negative_prompt`、`steps`、`cfg_scale`、`seed` 等）。
- **图生图（img2img）** —— 传入 `reference_images`（工作区文件、https 图片 URL、或粘贴的附件 JSON），走厂商的 `images/edits` 端点，让 Agent 改图、风格迁移、批量产出相似风格；刚生成的图片文件可直接作为后续参考图。
- **模型自动发现** —— 调用 `GET /v1/models` 并按名称模式识别生图模型（不预设硬编码模型表）；`list_image_models` 列出候选，`model=` 可指定。
- **自动保存** —— 每张成图自动写入工作区保存目录（默认 `generated-images/`），文件名由 `{prompt}-{timestamp}` 模板生成，冲突自动追加 `-2`、`-3`…，写入为原子操作（临时文件 + rename）。`save: "workspace:<相对目录>"` 可改存别处；`save: "none"` 跳过落盘。`save_generated_image` 可把已有图片复制到指定位置。
- **可回放卡片** —— 生成中显示动画卡片（进度、厂商 SSE 流式部分图），完成后展示成图、保存路径、预览（灯箱）与下载；图片读取仅限 loopback 且按会话授权，页面重载后仍可回放。
- **纯文本模型友好** —— 模型只收到文本摘要 + 紧凑 JSON 引用，图片字节不进会话日志。

## 安全

- **凭据绝不落盘进配置**：每个 source 只引用 DSH 凭据（`ctx.credentials`），每次调用动态解析。不要把 API Key 写进 `cordis.patch.yml`、聊天、Git 或截图。
- 携带凭据的请求一律 `redirect: "error"`；baseUrl 必须 https（本地联调允许回环 http），且不含 userinfo / query / fragment。
- 响应字节上限、单次调用超时、并发上限（超限立即拒绝而非排队）；**仅**对瞬时故障（429/5xx/网络）重试。
- 保存路径强制落在会话工作区内；RPC 读图按会话自身的工具结果授权。

## 安装

先审查源码，再从插件包目录安装——即在包含本 README 的文件夹内执行（该目录可放在任意位置）：

```powershell
dsh plugin --profile web add .
```

重启 DSH 并刷新页面。bundle patch 会自动插入 `imagen` 行：宿主插件注册工具，浏览器包注册卡片。

### 1. 配置 source

到 **设置 → 插件配置 → imagen 卡片**（该卡片通过插件自己的回环通道读写配置，无需任何设置白名单）添加 source，并直接在 **API 密钥** 栏输入密钥——保存时密钥会自动写入 DSH 凭据库，输入框随即清空并显示"已保存，留空即不改动"（已存密钥不再回显，设置里只保留凭据名）。也可以直接写进 `~/.dsh/cordis.patch.yml`（并把密钥放进 `~/.dsh/.credentials.yaml`）：

```yaml
- id: imagen
  name: dsh-imagen
  inject: [tools, credentials, connection, sessionPersistence]
  config:
    sources:
      myprovider:
        baseUrl: https://api.myprovider.com/v1   # OpenAI 兼容 API 根；会自动拼接 /images/generations、/images/edits、/models
        credential: IMAGE_API_KEY                # DSH 凭据引用名
        # model: flux-1-dev                      # 可选：固定模型，跳过自动发现
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

### 2. 使用

> 生成一张电影感 16:9 的产品摄影：半透明机械键盘放在深色玻璃桌面上，紫色轮廓光，不要文字。

模型会调用 `generate_image`；卡片播放动画，完成后显示保存文件（`generated-images/...png`）与预览/下载。改图示例：

> 把刚才生成的键盘图改成粉色主题，背景换成白色。

（模型会把已保存的路径作为参考图传入，也可以指向任意工作区文件 / URL / 粘贴的附件。）

## 无真实 Key 的本地联调

仓库附带一个确定性的 OpenAI 兼容模拟服务，可先验证"发现 → 生成 → 保存 → 卡片"全链路：

```powershell
node scripts/mock-image-api.mjs          # 监听 http://127.0.0.1:8787
```

把 source 的 `baseUrl` 配成 `http://127.0.0.1:8787/v1`（凭据名随意），然后让 Agent 生图即可。模拟服务提供 `/v1/models`（含 `gpt-image-2` 风格命名）与 `/v1/images/generations`（返回真实小 PNG；`extra.stream: true` 可演示 SSE 部分图）。回环 http 是设计内允许的。

## 开发

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run smoke
```

构建产物（随仓库提交）：`lib/index.js`（宿主插件）、`lib/client.js`（浏览器包）。

## 配置项一览

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `sources.<name>.baseUrl` | — | OpenAI 兼容 API 根（https；回环 http 允许） |
| `sources.<name>.credential` | — | 持有 API Key 的 DSH 凭据引用 |
| `sources.<name>.model` | — | 可选：固定模型 id（跳过发现） |
| `defaultSource` | 第一个 source | Agent 未指名时的默认 source |
| `save.enabled` | `true` | 生成后自动保存到工作区 |
| `save.dir` | `generated-images` | 保存目录（相对工作区） |
| `save.nameTemplate` | `{prompt}-{timestamp}` | 命名模板 |
| `discovery.enabled` | `true` | 查询 `GET /v1/models` 并匹配生图模型名 |
| `discovery.extraPatterns` | `[]` | 额外的生图模型匹配正则 |
| `defaults.size / quality / outputFormat / n` | — / — / `png` / `1` | 工具默认参数 |
| `limits.timeoutMs` | `120000` | 单次操作超时（10s–10min） |
| `limits.maxRetries` | `2` | 首次之外的重试次数（0–5） |
| `limits.retryBaseMs` | `1000` | 指数退避基数 |
| `limits.maxConcurrent` | `2` | 并发生成上限（1–8） |
| `limits.maxImageBytes` | `20000000` | 单张成图字节上限 |
| `limits.maxReferenceBytes` | `10000000` | 单张参考图字节上限 |

## 已知限制

- 各厂商 `images/edits` 支持不一；插件实现 OpenAI multipart 契约与常见 b64/url 响应形态，其余情况如实透出厂商错误。
- 异步任务型厂商（DashScope 式中继：POST 返回 `generation.task`，提供 `GET /images/generations/{id}`）会自动轮询；模拟服务（`node scripts/mock-image-api.mjs`）可在请求体带 `"task": true` 复现该流程。
- 最终预览仅限回环访问（本地 DSH 页面）；远程 Web 客户端只会看到明确的不可用状态，不会收到图片字节。
- 参考图使用粘贴附件时需要附件服务（`dsh-attachment`，web profile 默认挂载）。

## 许可证

MIT
