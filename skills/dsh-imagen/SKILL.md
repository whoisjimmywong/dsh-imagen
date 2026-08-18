---
name: dsh-imagen
description: "图片生成（dsh-imagen 插件）配套技能。当用户要求创建、绘制、渲染、设计、配图、插图、封面、缩略图、图标风格图，或要求对已有图片做改图、风格迁移、参考图变体、批量一致风格生成时使用；也用于生成文档/幻灯片/报告的视觉素材，或把刚生成的图片作为参考图继续生成。工具：generate_image（文生图/图生图，OpenAI 兼容多源 + 模型自动发现）、list_image_models、save_generated_image。**不适用**：矢量流程图/示意图/图表（用 visualize 或 mermaid/文字即可）、图片内容已直接可见、无需新图片的场合。Image generation companion skill for the dsh-imagen plugin: text-to-image and image-to-image via user-configured OpenAI-compatible sources, with model auto-discovery and automatic workspace saving. Triggers on: 生图, 画, 图片, 插图, 封面, 配图, 缩略图, 改图, 风格迁移, image, draw, illustration, cover, thumbnail, img2img."
triggers: [生图, 画图, 图片, 插图, 封面, 配图, 缩略图, 图标, 海报, 改图, 风格迁移, 参考图, 变体, 批量生成图片, image, draw, illustration, cover, thumbnail, poster, icon, img2img, style transfer, generate image, picture]
compatibility: 需要 dsh-imagen 插件已安装并挂载（generate_image 等工具可用）、至少一个 source 已配置（设置 → 插件 → 插件配置 → 图片生成），且该 source 的 DSH 凭据已保存（设置卡片 API 密钥栏或 ~/.dsh/.credentials.yaml）。
---

# dsh-imagen — 图片生成技能

本技能指导 Agent 正确使用 dsh-imagen 插件为用户的图片需求提供**真实生成的图片**，并遵循提示词工程、成本与安全纪律。

## 1. 何时用 / 何时不用

### 应该用本技能的场景

- 用户要**新图片**：插画、配图、封面、缩略图、海报、图标风格图、产品图、照片风格图等
- 为文档、幻灯片、报告、网页生成**视觉素材**
- **图生图**：改图、换背景/配色/风格、把草稿变成品、批量生成相似风格变体
- 用户提到"生成/画/做一张图"且没有现成文件可用

### 不应该用本技能的场景

- **矢量流程图 / 架构图 / 数据图表**：用 `visualize`（交互卡片）、mermaid 或文字描述更合适——不要为流程图调生图
- 图片已经存在且内容直接可见：不需要生成
- 用户只是引用某个图片路径、不需要新图片

### 成本纪律（重要）

- 每次生成**消耗用户 API 额度**：默认 `n=1`，不要为了"看看效果"重复生成
- 用户要变体/多张时才增加 `n` 或多次调用；批量场景优先用**同一参考图 + 变化提示词**
- 生成前确认提示词已打磨好，避免一次失败浪费额度

## 2. 工具速查

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `generate_image` | 文生图 / 图生图（主工具） | `prompt`(必填)、`source`、`model`、`size`、`quality`、`output_format`、`n`、`reference_images`、`extra`、`save` |
| `list_image_models` | 列出某 source 可用生图模型 | `source`(可选) |
| `save_generated_image` | 把已有图片复制到工作区指定位置 | `path`(必填)、`target`、`overwrite` |

### generate_image 参数细节

- **`prompt`**（必填）：详细提示词，1–32000 字符。保留用户约束，描述主体/构图/风格/光照/调色/文字/排除项
- **`source`**：生图源名称；缺省用配置的默认源（或第一个源）。不确定时先 `list_image_models`
- **`model`**：模型 id；缺省用 source 固定模型或自动发现（`GET /v1/models` 名称匹配）
- **`size`**：如 `1024x1024`、`1280x800`、`1536x1024`；缺省厂商默认
- **`quality`**：`auto | low | medium | high`；缺省配置默认
- **`output_format`**：`png | jpeg | webp`；缺省 `png`
- **`n`**：1–4 张；缺省 1
- **`reference_images`**：图生图参考图数组（见第 4 章）
- **`extra`**：厂商透传参数（`negative_prompt`、`steps`、`cfg_scale`、`seed` 等，值须为字符串/数字/布尔）
- **`save`**：`auto`（默认，存配置目录）、`none`（不落盘）、`workspace:<相对目录>`（存到指定目录）

### 工具返回

- 每次生成返回：`images[]`（含保存路径 `path`/相对路径 `relPath`、格式、字节数、宽高）、`savedTo`、`model`、`source`、耗时
- 会话内出现图片卡片（预览/下载），但**模型侧只拿到文本**——需要用图片路径做后续操作时，用返回值里的 `relPath`/`path`，不要臆造路径

## 3. 提示词工程

### 基本结构

```
[主体与场景] + [构图] + [风格] + [光照/氛围] + [调色板] + [画面文字] + [排除项]
```

例：
> A cinematic 16:9 product photo of a translucent mechanical keyboard on dark glass, purple rim lighting, shallow depth of field, no text

### 要点

- **保留用户约束**：用户指定的主体、风格、配色、比例、排除项逐条写进 prompt，不要自行丢弃
- **中文需求 → 英文提示词**：多数模型（gpt-image、flux、seedream 等）英文训练更充分，英文 prompt 通常效果更稳；但用户的专有名词/精确要求原样保留
- **画面文字默认 "no text"**：多数模型渲染文字较弱、易出乱码——除非用户明确要文字（如海报文案），否则提示词加 "no text" 或说明不要文字
- **比例/尺寸**：用 `size` 控制宽高比（如封面 16:9 用 `1536x1024` 或 `1792x1024`；方图 `1024x1024`；竖图 `1024x1536`）。注意不同厂商支持尺寸不同，不确定就省略 `size` 用厂商默认
- **质量档**：草图/快速预览用 `low`/`medium`，最终交付用 `high`
- **负面提示**：厂商支持时用 `extra.negative_prompt`（如 `lowres, blurry, watermark, text`）
- **模型选择**：`list_image_models` 查看候选；快速迭代用便宜/快的模型，最终稿用高质量模型（如 gpt-image-2、flux-2-pro、seedream-5-0 等）

## 4. 图生图（参考图）

### reference_images 的三种来源（每次调用最多可多张）

1. **工作区文件路径**：`{ path: "docs/sketch.png" }`（相对工作区）或绝对路径——路径必须在工作区内
2. **https 图片 URL**：`{ url: "https://..." }`
3. **粘贴的附件 JSON**：`{ attachment: "<[image attachment …] 的 JSON>" }`

### 典型工作流

- **改图**："把这张图背景换成白色" → 参考图 = 原图路径，prompt 描述改动
- **风格迁移**：参考图 + "把它改成赛博朋克风格/水彩风/扁平插画风"
- **批量一致风格变体**：同一张参考图，prompt 换主体/场景，保持风格描述一致 → 产出同风格系列
- **刚生成的图直接当参考**：上一步 `generate_image` 返回的 `relPath`（如 `generated-images/a-cat-20260818.png`）可直接作为下一次的 `reference_images[].path`——"把刚才的图改成……"就用这个

> 注意：图生图走厂商 `images/edits` 端点，部分厂商不支持或能力有限；报错时如实告知用户，可建议换支持 edits 的 source/模型。

## 5. 保存语义

- **默认自动保存**：每张成图写入工作区 `save.dir`（默认 `generated-images/`），文件名由模板 `{prompt}-{timestamp}` 生成，冲突自动加 `-2`、`-3`…
- **`save` 参数覆盖**：
  - `save: "none"`：只展示不落盘（临时预览）
  - `save: "workspace:docs/images"`：存到指定相对目录
- **明确落位**：需要特定文件名/位置（如 `docs/cover.png`）用 `save_generated_image`（源图 `path` + 目标 `target`，冲突默认拒绝、`overwrite: true` 覆盖）
- **交付流程**：生成后把需要的图复制/移动到目标项目目录（用文件工具操作），并把路径告诉用户

## 6. 安全与成本

### 密钥安全（硬性）

- **API 密钥绝不出现在会话/提示词/配置/日志里**
- 用户要填密钥：引导到 **设置 → 插件 → 插件配置 → 图片生成** 卡片的 **API 密钥** 栏（保存后显示"已保存，留空即不改动"），或 `~/.dsh/.credentials.yaml`
- 配置里只存**凭据名称**（如 `IMAGEN_KEY`），插件每次调用经 DSH 凭据服务动态解析
- 不要把密钥写进 `cordis.patch.yml`、聊天消息、Git 或截图

### 成本

- 每次生成消耗额度；默认 `n=1`，不重复生成；批量用参考图复用
- 异步任务型厂商（POST 返回 task、自动轮询）生成可能耗时 30–120 秒+，属正常

### 内容策略

- 生成被厂商安全策略拦截（审核）：**改写提示词**后重试一次，不要盲目重试同一 prompt
- 用户输入的负面内容：礼貌说明无法生成，不尝试绕过

## 7. 故障排查

| 现象 | 处理 |
| --- | --- |
| "No image source is configured" | 引导用户在设置卡片添加 source（Base URL + 凭据名 + 可选模型） |
| "No image models were discovered…" | source 未固定模型且 `GET /v1/models` 未匹配到生图模型：指定 `model=` 或加 `extraPatterns` |
| "No credential is configured for …" | 密钥未存：设置卡片 API 密钥栏输入保存，或检查 `~/.dsh/.credentials.yaml` |
| 请求超时（>120s） | 调大 `limits.timeoutMs` 或降低 `quality`；异步任务厂商等待属正常 |
| 生成失败/厂商报错 | 查看返回的厂商错误信息；确认模型/尺寸/参数受该厂商支持；`output_format` 厂商不支持时改回默认 |
| 会话卡片不显示图片 | 刷新页面；预览仅限本机（loopback），远程客户端不可见属预期 |
| 参考图报"escapes the workspace" | 参考图路径必须在会话工作区内，或用 https URL/附件 |
| 图生图报错 | 厂商可能不支持 `images/edits`：换支持 edits 的 source 或改用文生图 |

## 8. 工作流示例

### A. 单张插图 → 交付文档

1. `generate_image`（prompt 中英打磨好，`save: auto`）
2. 从返回值取 `relPath`，用文件工具把图复制到目标目录（如 `assets/`）
3. 在文档/PPT/PDF 中引用该路径，向用户汇报成图位置

### B. 参考图改图

1. 用户给出图片（工作区路径 / URL / 附件）→ `reference_images: [{ path/url/attachment }]`
2. prompt 描述改动："把背景换成白色，主体不变，保持原风格"
3. 保存并交付新图

### C. 批量一致风格变体

1. 先出一张基准图（定义风格锚点）
2. 以基准图 `relPath` 为参考，连续多次 `generate_image`，每次换主体/场景、风格描述保持一致
3. 批量产出同一视觉风格系列

### D. 封面/海报

1. 确认用途比例（16:9 横幅 / 3:4 竖版封面）→ `size`
2. `quality: "high"`，`output_format` 按需（PNG 通用 / JPEG 体积小）
3. 如需文字（标题），明确写出文案内容并说明排版意图；否则加 "no text"
