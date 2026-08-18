# DSH 生图插件（dsh-imagen）— 产品需求与交付记录

> 状态：**v0.1 已交付**（2026-08-17）。需求经用户确认后完成实现、构建、单测与冒烟验证；未重启 DSH Host。调研期间下载的参考材料（dsh-image-gen 源码、dsh-draw-router README）仅作本地研究用，**不随仓库发布**（见 `.gitignore` 的 `_ref/`、`_ref2/`）。

## 1. 目标

构建一个 DSH 插件，使 **Agent 在需要时自行**调用**用户给定 API** 生成图片，并支持**手动保存与自动保存**，同时保证凭据安全、会话内可回放。

一句话：*把生图能力做成 Agent 的自主工具，把结果稳稳落地成文件。*

## 2. 参考插件调研结论

| 插件 | 位置 | 可借鉴点 |
| --- | --- | --- |
| `@anionex/dsh-vision-toolkit` v0.1.31 | 已安装（web profile） | 配置模型：`provider.{baseUrl, credential, model, protocol}` + `settingsNamespace` 设置页；凭据走 DSH Credential 引用（`credentialRef`），绝不落盘明文 |
| `@liustack/modlens` v3.18.3 | 已安装 | 工具 + skill 的组合交付模式 |
| `@linxin666/dsh-tool-describe-image` v0.1.19 | 已安装 | 最简工具插件模板：`defineTool` + `installSettingsSection` + 每调用动态解析配置 |
| `@dsh-external/dsh-visualize` v0.1.2 | 已安装 | 会话内渲染 UI 卡片的思路 |
| **`dsh-image-gen`** v0.2.0（LeemanCheung） | 未安装，源码已拉取到 `_ref/` | 核心参照：`image_gen` 工具；最终图保存为 **DSH 不可变附件**（`ctx.attachments.saveImage`）→ 会话重载可回放；纯文本输出 + `REFERENCE_MARKER` JSON 让客户端渲染卡片；loopback RPC 拉进度/取图；`redirect:'error'`、限响应大小、限并发、只重试瞬时故障；客户端 `tool.call.toolview` 插槽渲染动画卡片 + 灯箱 + 下载；**明确不写工作区** |
| **`dsh-draw-router`**（xiaozhe7772222） | 未安装，README 已拉取到 `_ref2/` | 通用 OpenAI 兼容端点：用户填 `baseURL + API Key` → `GET /v1/models` 自动发现生图模型（30+ 名称模式匹配）+ 手动加模型；`draw_image` / `draw_list_sources` 工具；REST API 管理多源；返回图片 URL |

**关键差异点（我们的新东西）**：dsh-image-gen 只把图存进 DSH 附件仓库、不落工作区；dsh-draw-router 只返回 URL、不做会话内持久卡片。我们的插件把两者结合，并新增**手动/自动保存到文件**语义。

## 3. 技术底座（已核实的 DSH 插件机制）

- 包结构：`package.json`（`main: lib/index.js`、`exports` 含 `./client`、`dsh.bundle.patch: ./cordis.patch.yml`、`dsh.client: {platform:'web', inject:[...]}`、peerDeps `@deepseek-ai/*` ^0.1.0-rc.6、`type:module`、Node ^22.19 || >=24）
- `cordis.patch.yml`：向 profile roster 插入 `{id, name, inject, config}` 行
- 入口 `src/index.ts`：`export const name / inject / Config(Schema.object) / apply(ctx, config)`
- 工具注册：`ctx.tools.register(defineTool({name, description, parameters, output:{schema, render, presentationMeta}, finalizeContent, timeoutMs, isConcurrencySafe, presentCall, presentResult, execute}))`
- 凭据：`ctx.credentials.resolve(credentialRef('NAME'))`（`@deepseek-ai/dsh-credentials`）
- 附件：`ctx.attachments.saveImage({data, mediaType, name})` / `readImage(ref, signal)` / `imageLimits.maxImageBytes`
- 会话上下文：`exec.agent.session.header.id`（会话 id），`header.cwd`（工作区路径，供保存用）
- 回放授权：`ctx.sessionPersistence.inspect(SessionId(id), signal)` 校验图片归属
- loopback RPC：`ctx.connection.rpc.handle(channel, handler, {authority:'loopback'})`；客户端 `connection.rpc.call(...)`（仅回环可用）
- 设置页：`installSettingsSection(ctx, namespace, Config, config, {setSource, onChange, validate})`（`@deepseek-ai/dsh-settings`）→ Settings → 插件配置
- 浏览器端：`src/client/index.tsx`，`ctx.slots.inject('tool.call.toolview', ...)` 注册 `key` 匹配工具名的卡片组件；`ctx.locale.register(NS, {zh, en})`
- 构建：tsdown（host + client 双配置）；测试 vitest

## 4. 功能草案

### 4.1 配置（Settings → 插件配置 + cordis.patch.yml）
- `provider.baseUrl`：OpenAI 兼容 API 根地址（默认空，必填；仅回环允许 http，其余必须 https）
- `provider.credential`：DSH Credential 引用（默认如 `IMAGE_API_KEY`）；凭据每次调用动态解析，绝不写入配置/日志/会话
- `provider.model`：生图模型名（默认空；为空时可用 `list_models` 工具/自动发现填充）
- `provider.discoverModels`：是否启动时 `GET /v1/models` 自动发现（参考 draw-router 的名称模式匹配，可选）
- `save.autoDir`：自动保存目录（相对工作区，默认如 `generated-images/`；空 = 不自动落盘）
- `save.autoName`：自动命名模板（默认 `{timestamp}_{prompt-stem}.{ext}`）
- `save.attach`：是否同时保存为 DSH 附件以便会话回放（默认开）
- `defaultSize / defaultQuality / defaultFormat / timeoutMs / maxRetries / maxConcurrent`：默认生图参数与运行边界

### 4.2 工具（Agent 自主调用）
1. **`generate_image`**：文生图。参数 `prompt`（必填）、`size`、`quality`、`output_format`、`n`（数量，可选 1–4）、`save`（`auto` | `workspace:<相对路径>` | `none`，默认按配置）、扩展透传参数（`negative_prompt`/`steps`/`cfg_scale` 等，可选）。返回：附件引用 + 保存路径 + 图片元数据（宽高/格式/耗时/用量）。
2. **`save_generated_image`**：对已生成的图片手动保存到指定路径（按附件引用或 callId 定位；校验该图确实来自当前会话）。用于"这张图存到 `docs/cover.png`"这类诉求。
3. **`list_image_models`**（可选）：列出可用生图模型（自动发现结果 + 手动配置），供 Agent 选择 model 参数。

### 4.3 保存语义（待确认的核心）
- **自动保存**：每次生图成功后，按 `save.autoDir` + 命名模板自动写入文件（幂等，文件名冲突自动加序号）。
- **手动保存**：`generate_image(save='workspace:...')` 显式落盘；或 `save_generated_image` 事后补存。
- 两种模式都同时写入 DSH 附件（会话内卡片回放、灯箱、下载，参考 dsh-image-gen）。

### 4.4 会话内展示
- 浏览器端卡片：生成中显示进度/显影动画（部分 API 支持 SSE partial），完成后展示图片 + 保存路径 + 预览/下载（loopback 授权读取）。
- 模型侧输出保持纯文本（附件引用放 UI 元数据），避免文本模型上下文被图片污染。

### 4.5 安全边界
- 凭据每次调用经 `ctx.credentials` 解析；`redirect:'error'`；拒绝非 https 的非回环地址；响应字节上限（`attachments.imageLimits.maxImageBytes`）；并发上限立即拒绝不排队；只重试瞬时故障（429/5xx/网络）；取消信号贯穿。
- 图片读取仅 loopback + 会话归属校验（`sessionPersistence.inspect`）。
- 保存路径必须落在会话工作区内（防越权写）。

## 5. 交付物（实现阶段）
- 插件包：`package.json`、`cordis.patch.yml`、`tsconfig.host/client.json`、`tsdown.config.ts`、`src/index.ts`、`src/openai-client.ts`、`src/save.ts`、`src/rpc.ts`、`src/types.ts`、`src/client/index.tsx` 等、`README.md`/`README.zh.md`、`LICENSE`
- 构建产物 `lib/index.js` + `lib/client.js`
- vitest 单测（无真实 key 的确定性模拟）
- 可选：安装到 web profile 并验证（需确认是否允许重启 DSH）

## 6. 已确认的需求决策（用户选择）

| 决策点 | 结论 |
| --- | --- |
| 命名 | 包 `dsh-imagen`；工具 `generate_image`（+ `list_image_models`、`save_generated_image`） |
| API 形态 | 多源 + `GET /v1/models` 自动发现生图模型（名称模式匹配），支持手动指定模型 |
| 凭据 | DSH 凭据 seam（`credentialRef` 每次调用动态解析），密钥不落盘 |
| 保存语义 | 自动保存：每次生成后写入工作区配置目录（`generated-images/`，`{prompt}-{timestamp}` 命名，冲突加序号，原子写入）；`save:` 参数可改目录/跳过；`save_generated_image` 支持手动复制 |
| 展示 | 完整动画卡片：进度轮询、SSE 部分图、完成图 + 保存路径 + 灯箱 + 下载（loopback 授权读取，重载可回放） |
| 范围 | **含 img2img**：`reference_images`（工作区文件 / https URL / 附件 JSON）走 `images/edits`；刚生成的图可直接作参考 |
| 验证 | 本地构建 + 34 项单测 + 冒烟 + 模拟 API 端到端；未重启 DSH Host；真实 Key 由用户后续配置验证 |

## 7. 交付物清单

- `package.json` / `cordis.patch.yml` / `tsconfig.host.json` / `tsconfig.client.json` / `tsdown.config.ts` / `vitest.config.ts`
- `src/`：`index.ts`（工具注册 + RPC + 授权）、`config.ts`（多源配置校验）、`client.ts`（OpenAI 兼容客户端：generations/edits/SSE/URL/重试）、`models.ts`（模型发现）、`save.ts`（工作区保存）、`probe.ts`（图片尺寸探测）、`types.ts`、`rpc.ts`、`client/index.tsx` + `styles.ts`（浏览器卡片）
- `lib/index.js` + `lib/client.js`（构建产物，随仓库提交）
- `tests/`：config / models / save / probe / client 单测（34 项全绿）+ `smoke.mjs` 冒烟
- `scripts/mock-image-api.mjs`：本地 OpenAI 兼容模拟服务（无 Key 端到端联调）
- `README.md` / `README.zh.md` / `LICENSE`

## 8. 验证结果

- `npm run typecheck`（host + client）：通过
- `npm test`：5 个文件 34 项全部通过
- `npm run build`：`lib/index.js` 67.4kB + `lib/client.js` 24.8kB（含 ModuleLoader 包装）
- `npm run smoke`：宿主模块加载、3 个工具注册、RPC 错误路径、客户端包结构通过
- 模拟 API 端到端：模型发现正确排除非生图模型（deepseek-chat/qwen-vl-max），生成返回真实 PNG（8×8）并解析 usage
- `npm pack --dry-run`：包内容 18 个文件、72.8kB，结构正确
