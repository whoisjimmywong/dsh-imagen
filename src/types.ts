/**
 * Shared vocabulary between the Host tool and the browser card.
 * @module dsh-imagen/types
 */

/** Schema tag of the canonical tool result. */
export const RESULT_SCHEMA = 'dsh.imagen.result.v1'
/** Schema tag carried in `presentationMeta` so the browser card can replay. */
export const PRESENTATION_SCHEMA = 'dsh.imagen.presentation.v1'
/** Schema tag of the marker JSON embedded in the rendered text (Code Mode replay). */
export const REFERENCE_SCHEMA = 'dsh.imagen.reference.v1'
/** Marker prefix written before the JSON reference line in rendered text. */
export const REFERENCE_MARKER = '\n@dsh-imagen:'

export type ImageFormat = 'png' | 'jpeg' | 'webp'
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

/** One saved image file. `path` is absolute; `relPath` is workspace-relative. */
export interface ImageRefValue {
  path: string
  relPath: string
  mediaType: ImageMediaType
  format: ImageFormat
  bytes: number
  width?: number
  height?: number
}

/** Provider usage report when the endpoint returns one. */
export interface ImageUsageValue {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Canonical `generate_image` tool result. */
export interface ImageGenerationValue {
  schema: typeof RESULT_SCHEMA
  callId: string
  source: string
  model: string
  prompt: string
  /** Every saved image file, in provider order. */
  images: ImageRefValue[]
  /** Workspace-relative paths of every saved image. */
  savedTo: string[]
  /** Requested size (provider may return a different resolved size). */
  size?: string
  quality?: string
  outputFormat: ImageFormat
  elapsedMs: number
  usage?: ImageUsageValue
  /** Workspace-relative paths of the reference images used (img2img only). */
  references?: string[]
}

/** Replayable reference for one generation call (Code Mode / marker path). */
export interface ImageReferenceValue {
  schema: typeof REFERENCE_SCHEMA
  callId: string
  source: string
  model: string
  images: ImageRefValue[]
  savedTo: string[]
  size?: string
  quality?: string
  outputFormat: ImageFormat
  elapsedMs: number
  usage?: ImageUsageValue
}

/** Live progress the browser card polls while a call is running. */
export interface ImageProgressValue {
  state: 'missing' | 'discovering' | 'requesting' | 'generating' | 'saving'
  revision: number
  attempt: number
  startedAt: number
  source?: string
  model?: string
  partial?: {
    index: number
    format: ImageFormat
    /** Base64 payload of one provider partial frame. */
    data: string
  }
}

/** One discovered image model id. */
export interface ImageModelValue {
  id: string
  discovered: boolean
}
