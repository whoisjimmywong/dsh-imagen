/**
 * Workspace-safe image persistence: resolves the save directory inside the
 * session workspace, derives deterministic names from the prompt, disambiguates
 * collisions, and writes atomically (temp file + rename).
 * @module dsh-imagen/save
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve, relative, sep, dirname } from 'node:path'
import type { ImageFormat } from './types.ts'

/** A file write that landed on disk. */
export interface SavedFile {
  /** Absolute path of the saved file. */
  path: string
  /** Workspace-relative path. */
  relPath: string
  bytes: number
}

/** Normalize a prompt into a filesystem-safe slug (empty input → `image`). */
export function slugify(value: string, maximum = 40): string {
  const stem = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, maximum)
    .toLowerCase()
  return stem || 'image'
}

/** Timestamp in the compact `YYYYMMDD-HHMMSS` form. */
export function timestampLabel(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Render a naming template (`{prompt}`, `{timestamp}`) into a stem. */
export function renderNameTemplate(template: string, prompt: string, date = new Date()): string {
  return template
    .replace(/\{prompt\}/gu, slugify(prompt))
    .replace(/\{timestamp\}/gu, timestampLabel(date))
    .replace(/[\\/:*?"<>|]+/gu, '-')
}

function extensionOf(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/** Assert `candidate` resolves strictly inside `root`; throws otherwise. */
export function assertInside(root: string, candidate: string): string {
  const absolute = resolve(candidate)
  const base = resolve(root)
  if (absolute !== base && !absolute.startsWith(base + sep)) {
    throw new Error(`path escapes the workspace: ${absolute}`)
  }
  return absolute
}

/** Resolve and validate the save directory inside a workspace. */
export function resolveSaveDir(workspace: string, dir: string): string {
  const resolved = assertInside(workspace, join(workspace, dir))
  if (resolved === resolve(workspace)) {
    throw new Error('save.dir must not resolve to the workspace root itself')
  }
  return resolved
}

/**
 * Find the first non-colliding absolute path for `stem.ext` inside `dir`,
 * appending `-2`, `-3`, … when the name is already taken.
 */
export async function uniquePath(dir: string, stem: string, format: ImageFormat): Promise<string> {
  const extension = extensionOf(format)
  let candidate = join(dir, `${stem}.${extension}`)
  let index = 2
  // Existence check then atomic rename still races; the rename below uses
  // exclusive creation semantics via a temporary probe when needed.
  while (true) {
    try {
      await mkdir(dirname(candidate), { recursive: true })
      // Open with 'wx' to claim the name exclusively.
      const handle = await import('node:fs/promises').then(m => m.open(candidate, 'wx'))
      await handle.close()
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        candidate = join(dir, `${stem}-${index}.${extension}`)
        index += 1
        continue
      }
      throw error
    }
  }
}

/** Atomically write bytes to `path` via a sibling temp file + rename. */
export async function atomicWrite(path: string, data: Uint8Array): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temp, data)
  await rename(temp, path)
}

/**
 * Claim a unique path inside `dir` and write `data` atomically.
 * @returns the absolute path, the workspace-relative path and byte count.
 */
export async function saveImageFile(
  workspace: string,
  dir: string,
  prompt: string,
  template: string,
  format: ImageFormat,
  data: Uint8Array,
  explicitName?: string,
): Promise<SavedFile> {
  const saveDir = resolveSaveDir(workspace, dir)
  const stem = explicitName !== undefined && explicitName !== ''
    ? slugify(explicitName, 64)
    : renderNameTemplate(template, prompt)
  const path = await uniquePath(saveDir, stem, format)
  await atomicWrite(path, data)
  return { path, relPath: relative(resolve(workspace), path).split(sep).join('/'), bytes: data.byteLength }
}
