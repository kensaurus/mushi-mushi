/**
 * FILE: apps/admin/src/lib/voiceIntake.ts
 * PURPOSE: Client for the voice-intake API used by the Voice page (plan
 *          docs/execplans/dead-code-voice-agent-loop.md, C1 "PWA" adapter):
 *          signed audio upload, intake submit (audio path or typed transcript),
 *          the confirm / cancel gate, and the recent-sessions list.
 *
 * Contract (server: api/routes/intake-voice.ts):
 *   POST /v1/intake/voice/upload-url          → { ok, bucket, path, signedUrl, token }
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

export async function requestVoiceUploadUrl(): Promise<ApiResult<VoiceUploadTarget>> {
  return apiFetchMutate<VoiceUploadTarget>('/v1/intake/voice/upload-url')
}

/**
 * Uploads through the signed URL. Uses supabase-js when the bucket is native
 * Supabase storage; falls back to a direct PUT so BYO-storage signed URLs
 * (S3 / R2 / GCS presigned) keep working.
 */
export async function uploadVoiceFile(target: VoiceUploadTarget, file: File | Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  const contentType = file.type || 'application/octet-stream'
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
  onStage?.('signing')
  const target = await requestVoiceUploadUrl()
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
