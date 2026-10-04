/**
 * FILE: apps/admin/src/lib/voiceIntake.ts
 * PURPOSE: Client for the voice-intake API used by the Voice page (plan
 *          docs/execplans/dead-code-voice-agent-loop.md, C1 "PWA" adapter):
 *          signed audio upload, intake submit (audio path or typed transcript),
 *          the confirm / cancel gate, and the recent-sessions list.
 *
 * Contract (server: api/routes/intake-voice.ts):
 *   POST /v1/intake/voice/upload-url { mime } → { ok, bucket, path, signedUrl, token, mime }
 *   POST /v1/intake/voice                     → { ok, session }
 *   POST /v1/intake/voice/:id/confirm { token } / …/cancel { token }
 *   GET  /v1/intake/voice/sessions?limit=20   → { ok, sessions }
 */

import { apiFetch, apiFetchMutate, supabase } from './supabase'
import type { ApiResult } from './apiEnvelope'

export type VoiceSessionStatus =
  | 'received'
  | 'transcribed'
  | 'awaiting_confirm'
  | 'confirmed'
  | 'dispatched'
  | 'notified'
  | 'refused'
  | 'created'
  | 'duplicate'
  | 'failed'
  | 'cancelled'
  | 'expired'

export interface VoiceSession {
  id: string
  status: VoiceSessionStatus | string
  source?: string | null
  transcript?: string | null
  action?: string | null
  summary?: string | null
  confirm_token?: string | null
  report_id?: string | null
  dispatch_id?: string | null
  pr_url?: string | null
  message?: string | null
  language?: string | null
  created_at?: string | null
  updated_at?: string | null
  expires_at?: string | null
}

export interface VoiceUploadTarget {
  bucket: string
  path: string
  signedUrl: string
  token: string
  /** Canonical MIME the server chose for the object (what the bucket accepts). */
  mime?: string
}

export const VOICE_SESSIONS_PATH = '/v1/intake/voice/sessions?limit=20'

/** Maps a session status to the chip tone used by <Badge tone>. */
export function voiceStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'brand' {
  switch (status) {
    case 'awaiting_confirm':
      return 'warn'
    case 'confirmed':
    case 'dispatched':
    case 'received':
    case 'transcribed':
      return 'info'
    case 'notified':
    case 'created':
      return 'ok'
    case 'refused':
    case 'failed':
      return 'danger'
    case 'duplicate':
      return 'brand'
    default:
      return 'neutral'
  }
}

export const VOICE_STATUS_LABEL: Record<string, string> = {
  received: 'Received',
  transcribed: 'Transcribed',
  awaiting_confirm: 'Needs confirmation',
  confirmed: 'Confirmed',
  dispatched: 'Agent working',
  notified: 'PR ready',
  refused: 'Refused',
  created: 'Report created',
  duplicate: 'Duplicate',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export function voiceStatusLabel(status: string): string {
  return VOICE_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')
}

/**
 * The status to show. A request still `awaiting_confirm` after its 10-minute
 * window can no longer be confirmed (the server expires it on the next
 * attempt), so it reads as expired instead of "Needs confirmation".
 */
export function effectiveVoiceStatus(session: Pick<VoiceSession, 'status' | 'expires_at'>, now = Date.now()): string {
  if (session.status !== 'awaiting_confirm' || !session.expires_at) return session.status
  const expiresAt = Date.parse(session.expires_at)
  return Number.isFinite(expiresAt) && expiresAt <= now ? 'expired' : session.status
}

/**
 * Voice intake is off by default (ADR 0010): only an explicit `true` turns it
 * on. A project with no settings row reads back as `{}`, which is off.
 */
export function isVoiceIntakeEnabled(settings: { voice_intake_enabled?: boolean | null } | null | undefined): boolean {
  return settings?.voice_intake_enabled === true
}

/** A request that can still be confirmed or cancelled from this console. */
export function canConfirmVoiceSession(
  session: Pick<VoiceSession, 'status' | 'expires_at' | 'confirm_token'>,
  now = Date.now(),
): boolean {
  return effectiveVoiceStatus(session, now) === 'awaiting_confirm' && Boolean(session.confirm_token)
}

export const VOICE_ACTION_LABEL: Record<string, string> = {
  create_report: 'Create a bug report',
  open_draft_pr: 'Open a draft PR',
  unknown: 'Could not tell what to do',
}

export function voiceActionLabel(action: string | null | undefined): string {
  if (!action) return '—'
  return VOICE_ACTION_LABEL[action] ?? action.replace(/_/g, ' ')
}

// ── upload ───────────────────────────────────────────────────────────────────

/** Accepted formats, in the words shown to the user. */
const VOICE_ACCEPTED_FORMATS = '.m4a, .mp3, .ogg, .webm or .wav'

/**
 * Mirrors the server's `extensionForMime` (_shared/stt.ts): every alias it
 * accepts, mapped to the canonical type the voice-intake bucket allows.
 */
const VOICE_MIME_ALIASES: Record<string, string> = {
  'audio/ogg': 'audio/ogg',
  'audio/oga': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'application/ogg': 'audio/ogg',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/webm': 'audio/webm',
  'video/webm': 'audio/webm',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
}

const VOICE_EXTENSION_MIME: Record<string, string> = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/mp4',
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
  wav: 'audio/wav',
}

/**
 * The audio type to ask the server for. `file.type` is empty for some
 * Windows and Android files and can be an alias, so: a type the server
 * knows, else the file extension, else null (the caller then names the
 * formats that work instead of sending a request the server refuses).
 */
function resolveVoiceMime(file: { type?: string; name?: string }): string | null {
  const base = (file.type ?? '').split(';')[0]!.trim().toLowerCase()
  const fromType = VOICE_MIME_ALIASES[base]
  if (fromType) return fromType
  const name = typeof file.name === 'string' ? file.name : ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return VOICE_EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? null
}

export async function requestVoiceUploadUrl(mime: string): Promise<ApiResult<VoiceUploadTarget>> {
  return apiFetchMutate<VoiceUploadTarget>('/v1/intake/voice/upload-url', { body: JSON.stringify({ mime }) })
}

/**
 * Uploads through the signed URL. Uses supabase-js when the bucket is native
 * Supabase storage; falls back to a direct PUT so BYO-storage signed URLs
 * (S3 / R2 / GCS presigned) keep working.
 */
export async function uploadVoiceFile(target: VoiceUploadTarget, file: File | Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  // The bucket accepts only canonical audio types, so upload under the type
  // the server picked for this object, not the browser's guess.
  const contentType = target.mime || file.type || 'application/octet-stream'
  if (target.token) {
    try {
      const { error } = await supabase.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, {
        contentType,
        upsert: true,
      })
      if (!error) return { ok: true }
      // Fall through to the raw PUT — the signed URL may not be a Supabase one.
    } catch {
      // same
    }
  }
  try {
    const res = await fetch(target.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      body: file,
    })
    if (!res.ok) return { ok: false, message: `Upload failed (${res.status})` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Upload failed' }
  }
}

// ── intake ───────────────────────────────────────────────────────────────────

export async function submitVoiceAudio(input: { audioPath: string; externalId: string }): Promise<ApiResult<{ session: VoiceSession }>> {
  return apiFetch<{ session: VoiceSession }>('/v1/intake/voice', {
    method: 'POST',
    idempotencyKey: input.externalId,
    body: JSON.stringify({ source: 'pwa', external_id: input.externalId, audio_path: input.audioPath }),
  })
}

export async function submitVoiceTranscript(input: { transcript: string; externalId: string }): Promise<ApiResult<{ session: VoiceSession }>> {
  return apiFetch<{ session: VoiceSession }>('/v1/intake/voice', {
    method: 'POST',
    idempotencyKey: input.externalId,
    body: JSON.stringify({ source: 'pwa', external_id: input.externalId, transcript: input.transcript }),
  })
}

export async function confirmVoiceSession(id: string, token: string): Promise<ApiResult<{ session?: VoiceSession; status?: string; message?: string }>> {
  return apiFetchMutate(`/v1/intake/voice/${encodeURIComponent(id)}/confirm`, { body: JSON.stringify({ token }) })
}

export async function cancelVoiceSession(id: string, token: string): Promise<ApiResult<{ session?: VoiceSession; status?: string; message?: string }>> {
  return apiFetchMutate(`/v1/intake/voice/${encodeURIComponent(id)}/cancel`, { body: JSON.stringify({ token }) })
}

/** Runs the whole PWA path: signed upload → intake submit. */
export async function uploadAndSubmitVoice(
  file: File | Blob,
  onStage?: (stage: 'signing' | 'uploading' | 'transcribing') => void,
): Promise<{ ok: true; session: VoiceSession } | { ok: false; message: string; code?: string }> {
  const mime = resolveVoiceMime(file as { type?: string; name?: string })
  if (!mime) {
    return { ok: false, message: `Mushi can't read this kind of audio file. Use a ${VOICE_ACCEPTED_FORMATS} recording.` }
  }
  onStage?.('signing')
  const target = await requestVoiceUploadUrl(mime)
  if (!target.ok || !target.data) {
    return { ok: false, message: target.error?.message ?? 'Could not get an upload URL', code: target.error?.code }
  }
  onStage?.('uploading')
  const uploaded = await uploadVoiceFile(target.data, file)
  if (!uploaded.ok) return { ok: false, message: uploaded.message }
  onStage?.('transcribing')
  const res = await submitVoiceAudio({ audioPath: target.data.path, externalId: crypto.randomUUID() })
  if (!res.ok || !res.data?.session) {
    return { ok: false, message: res.error?.message ?? 'Voice intake failed', code: res.error?.code }
  }
  return { ok: true, session: res.data.session }
}
