/**
 * FILE: apps/admin/src/lib/voiceRecorder.ts
 * PURPOSE: Pure MediaRecorder helpers for the Voice page — MIME probing
 *          (Opus/WebM on Chrome and Firefox, MP4/AAC on Safari), file naming,
 *          the 120 s cap, and size formatting. The stateful hook lives in
 *          components/voice/useVoiceRecorder.ts; this file has no DOM
 *          dependency so it is unit-tested directly.
 */

/** Hard cap from the plan (C1 "PWA"): recordings stop at 120 s. */
export const MAX_RECORDING_MS = 120_000
/** Server-side ceiling (voice-intake bucket file_size_limit is 25 MiB). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Probe order: best-supported first. Safari only speaks audio/mp4. */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const

export function pickRecorderMimeType(isTypeSupported: (mime: string) => boolean): string | null {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(mime)) return mime
    } catch {
      // some engines throw on unknown containers
    }
  }
  return null
}

export function extensionForMime(mime: string | null | undefined): string {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase()
  switch (base) {
    case 'audio/webm':
    case 'video/webm':
      return 'webm'
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return 'm4a'
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg'
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav'
    case 'audio/aac':
      return 'aac'
    default:
      return 'bin'
  }
}

/** File name for a fresh recording, e.g. `voice-2026-09-12T07-15-02.webm`. */
export function recordingFileName(mime: string | null | undefined, at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-')
  return `voice-${stamp}.${extensionForMime(mime)}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Accept list for the manual upload input — mirrors the manifest share_target. */
export const UPLOAD_ACCEPT = 'audio/*,.m4a,.ogg,.mp3,.wav,.webm'

export function isAcceptableAudioFile(file: { type: string; name: string; size: number }): { ok: true } | { ok: false; reason: string } {
  if (file.size === 0) return { ok: false, reason: 'The file is empty.' }
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `The file is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.` }
  const byType = file.type.startsWith('audio/') || file.type === 'video/webm'
  const byName = /\.(m4a|ogg|oga|opus|mp3|wav|webm|aac|caf)$/i.test(file.name)
  if (!byType && !byName) return { ok: false, reason: 'Pick an audio file (m4a, ogg, mp3, wav, webm).' }
  return { ok: true }
}
