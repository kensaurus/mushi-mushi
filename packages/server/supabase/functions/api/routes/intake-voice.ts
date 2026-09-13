// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/api/routes/intake-voice.ts
 * PURPOSE: HTTP surface of the voice inbox (plan C1). Everything an iOS
 *          Shortcut, the admin PWA or a raw API client needs:
 *
 *   POST /v1/intake/voice               transcript | audio_path | audio_base64 → session
 *   POST /v1/intake/voice/upload-url    signed upload URL into the voice-intake bucket
 *   GET  /v1/intake/voice/sessions      last N sessions for the project
 *   GET  /v1/intake/voice/:id           one session
 *   POST /v1/intake/voice/:id/confirm   { token } → dispatch the draft PR
 *   POST /v1/intake/voice/:id/cancel    { token }
 *
 * Auth: `adminOrApiKey({ scope: 'voice:write' })` — a phone-resident key with
 * the narrow scope, or a logged-in admin JWT (PWA). Reporter HMAC headers are
 * rejected with 403: end-user reporter tokens must never drive an agent.
 * Reads use the default `mcp:read` scope so console/MCP keys can list.
 *
 * Response contract (other agents code against it): the intake, confirm,
 * cancel and single-session routes answer `{ ok, session: {…} }` where
 * `session.message` is what a Shortcut speaks; failures use the canonical
 * `{ ok:false, error:{ code, message } }` envelope.
 */

import type { Hono, Context } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { withIdempotency } from '../../_shared/idempotency.ts'
import { getStorageSettings } from '../../_shared/storage.ts'
import { extensionForMime, mimeForExtension, STT_MAX_BYTES } from '../../_shared/stt.ts'
import {
  ingestVoice,
  confirmVoice,
  cancelVoice,
  voiceFailureCode,
  VOICE_INTAKE_BUCKET,
  VOICE_TRANSCRIPT_MAX_CHARS,
  type VoiceIngestResult,
} from '../../_shared/voice-intake.ts'
import { classifyIngestRateLimitError } from './ingest-rate-limit.ts'
import { resolveOwnedProject, jsonError, dbError } from '../shared.ts'

const vlog = log.child('intake-voice')

/** Inline audio cap (decoded). Supabase does not document the edge body ceiling; stay well under it. */
const AUDIO_BASE64_MAX_DECODED = 8 * 1024 * 1024
/** Route burst cap, copied from POST /v1/ingest/spans. */
const VOICE_ROUTE_MAX_PER_MINUTE = 60
/** Signed upload URLs are single-use and short-lived. */
const UPLOAD_URL_TTL_SEC = 2 * 60 * 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const voiceSourceSchema = z.enum(['ios_shortcut', 'slack', 'telegram', 'pwa', 'api'])

const intakeBodySchema = z
  .object({
    source: voiceSourceSchema.default('api'),
    external_id: z.string().trim().min(1).max(200).optional(),
    transcript: z.string().min(1).max(VOICE_TRANSCRIPT_MAX_CHARS).optional(),
    audio_path: z.string().trim().min(1).max(512).optional(),
    // base64 of ≤ 8 MB → at most ~10.7 M characters; the decoded size is checked again below.
    audio_base64: z.string().min(1).max(Math.ceil((AUDIO_BASE64_MAX_DECODED * 4) / 3) + 1024).optional(),
    mime: z.string().trim().max(64).optional(),
    filename: z.string().trim().max(200).optional(),
    duration_sec: z.number().positive().max(3600).optional(),
    languages: z.array(z.string().trim().min(2).max(8)).max(4).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const inputs = [body.transcript, body.audio_path, body.audio_base64].filter((v) => v !== undefined).length
    if (inputs !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Send exactly one of transcript, audio_path, or audio_base64',
      })
    }
    if (body.audio_base64 !== undefined && !body.mime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mime is required with audio_base64', path: ['mime'] })
    }
  })

const uploadUrlBodySchema = z
  .object({
    mime: z.string().trim().min(1).max(64),
  })
  .strict()

const gateBodySchema = z
  .object({
    token: z.string().trim().min(8).max(200),
  })
  .strict()

const SESSION_COLUMNS =
  'id, source, status, action, summary, transcript, report_id, pr_url, language, audio_duration_sec, ' +
  'expires_at, requested_by, dispatch_id, confirmed_at, created_at, updated_at'

function decodeBase64(input: string): Uint8Array | null {
  try {
    const cleaned = input.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
    const bin = atob(cleaned)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** End-user reporter credentials never drive the agent loop. */
function rejectReporterHeaders(c: Context): Response | null {
  if (c.req.header('X-Reporter-Token') || c.req.header('X-Reporter-Token-Hash') || c.req.header('X-Reporter-Hmac')) {
    return jsonError(c, 'FORBIDDEN', 'Reporter tokens cannot use voice intake. Use a project API key with the voice:write scope.', 403)
  }
  return null
}

function sessionPayload(result: VoiceIngestResult): Record<string, unknown> {
  return {
    id: result.sessionId,
    status: result.status,
    transcript: result.transcript,
    action: result.action,
    summary: result.summary,
    ...(result.confirmToken ? { confirm_token: result.confirmToken } : {}),
    ...(result.reportId ? { report_id: result.reportId } : {}),
    message: result.message,
  }
}

/** Map a `failed` pipeline result onto the canonical error envelope. */
function failedResponse(c: Context, result: VoiceIngestResult): Response {
  const code = voiceFailureCode(result.message)
  const human = result.message.includes(':') ? result.message.slice(result.message.indexOf(':') + 1).trim() : result.message
  switch (code) {
    case 'voice_intake_disabled':
      return jsonError(c, 'VOICE_INTAKE_DISABLED', human, 403)
    case 'rate_limited':
      c.header('Retry-After', '60')
      return jsonError(c, 'RATE_LIMITED', human, 429)
    case 'no_input':
    case 'empty_transcript':
    case 'audio_too_large':
    case 'audio_too_long':
    case 'unsupported_mime':
    case 'storage_failed':
      return jsonError(c, 'VALIDATION_ERROR', human, 400, result.sessionId ? { session_id: result.sessionId } : undefined)
    case 'stt_failed':
      return jsonError(c, 'UPSTREAM_ERROR', human, 502, result.sessionId ? { session_id: result.sessionId } : undefined)
    default:
      return jsonError(c, 'INTERNAL_ERROR', human, 500, result.sessionId ? { session_id: result.sessionId } : undefined)
  }
}

export function registerIntakeVoiceRoutes(app: Hono<{ Variables: Variables }>): void {
  // ── POST /v1/intake/voice ──────────────────────────────────────────────
  app.post('/v1/intake/voice', adminOrApiKey({ scope: 'voice:write' }), async (c) => {
    const reporterBlock = rejectReporterHeaders(c)
    if (reporterBlock) return reporterBlock

    return withIdempotency(c, async () => {
      const userId = c.get('userId') as string
      const db = getServiceClient()
      const resolved = await resolveOwnedProject(c, db, userId)
      if ('response' in resolved) return resolved.response
      const projectId = resolved.project.id

      // Route burst cap — same RPC + classification as POST /v1/ingest/spans:
      // breach → 429, missing function → fail-open during the migration
      // window, anything else → fail closed.
      {
        const { error: rateErr } = await db.rpc('report_ingest_rate_limit_claim', {
          p_project_id: projectId,
          p_max_per_minute: VOICE_ROUTE_MAX_PER_MINUTE,
        })
        const rateOutcome = classifyIngestRateLimitError(rateErr)
        if (rateOutcome === 'breach') {
          c.header('Retry-After', '60')
          return jsonError(c, 'RATE_LIMITED', 'Voice intake rate limit exceeded. Retry in 60 seconds.', 429)
        }
        if (rateOutcome === 'fail-open') {
          vlog.warn('report_ingest_rate_limit_claim missing (fail-open, migration window)', { err: rateErr?.message })
        } else if (rateOutcome === 'fail-closed') {
          vlog.error('voice intake rate limit claim failed — failing closed', { err: rateErr?.message })
          c.header('Retry-After', '30')
          return jsonError(c, 'RATE_LIMITED', 'Voice intake temporarily unavailable. Retry shortly.', 429)
        }
      }

      let raw: unknown
      try {
        raw = await c.req.json()
      } catch {
        return jsonError(c, 'INVALID_JSON', 'Body must be valid JSON')
      }
      const parsed = intakeBodySchema.safeParse(raw)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return jsonError(c, 'VALIDATION_ERROR', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid body')
      }
      const body = parsed.data

      if (body.audio_path && !body.audio_path.startsWith(`${projectId}/`)) {
        return jsonError(c, 'FORBIDDEN', 'audio_path must be inside this project\'s folder of the voice-intake bucket', 403)
      }

      let audio: { bytes: Uint8Array; mime: string; filename: string; durationSec?: number } | undefined
      if (body.audio_base64 !== undefined) {
        const ext = extensionForMime(body.mime)
        if (!ext) return jsonError(c, 'VALIDATION_ERROR', `Unsupported mime "${body.mime}". Use audio/ogg, audio/mp4, audio/mpeg, audio/webm or audio/wav.`)
        const bytes = decodeBase64(body.audio_base64)
        if (!bytes || bytes.byteLength === 0) return jsonError(c, 'VALIDATION_ERROR', 'audio_base64 is not valid base64')
        if (bytes.byteLength > AUDIO_BASE64_MAX_DECODED || bytes.byteLength > STT_MAX_BYTES) {
          return jsonError(c, 'VALIDATION_ERROR', `Inline audio is capped at ${AUDIO_BASE64_MAX_DECODED / (1024 * 1024)} MB; upload larger clips via /v1/intake/voice/upload-url`, 413)
        }
        audio = {
          bytes,
          mime: mimeForExtension(ext),
          filename: body.filename ?? `voice.${ext}`,
          ...(body.duration_sec !== undefined ? { durationSec: body.duration_sec } : {}),
        }
      }

      const externalId = body.external_id ?? c.req.header('Idempotency-Key')?.trim() ?? crypto.randomUUID()
      const authMethod = c.get('authMethod')

      const result = await ingestVoice(db, {
        projectId,
        source: body.source,
        externalId,
        // JWT callers are the admin themselves; API-key callers resolve to the
        // key owner, which is who the phone belongs to.
        requestedBy: UUID_RE.test(userId) ? userId : null,
        ...(body.transcript !== undefined ? { transcript: body.transcript } : {}),
        ...(body.audio_path !== undefined ? { audioPath: body.audio_path } : {}),
        ...(audio ? { audio } : {}),
        ...(body.languages ? { languages: body.languages } : {}),
        channel: authMethod === 'jwt' && UUID_RE.test(userId) ? { userId } : {},
      })

      if (result.status === 'failed') return failedResponse(c, result)
      return c.json({ ok: true, session: sessionPayload(result) }, 200)
    })
  })

  // ── POST /v1/intake/voice/upload-url ───────────────────────────────────
  app.post('/v1/intake/voice/upload-url', adminOrApiKey({ scope: 'voice:write' }), async (c) => {
    const reporterBlock = rejectReporterHeaders(c)
    if (reporterBlock) return reporterBlock

    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response
    const projectId = resolved.project.id

    const parsed = uploadUrlBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'mime is required (audio/ogg, audio/mp4, audio/mpeg, audio/webm, audio/wav)')
    const ext = extensionForMime(parsed.data.mime)
    if (!ext) return jsonError(c, 'VALIDATION_ERROR', `Unsupported mime "${parsed.data.mime}"`)

    // The voice-intake bucket lives on the cluster's Supabase storage. A
    // project pinned to BYO S3/R2/GCS/MinIO cannot receive a signed upload
    // there — tell the client to fall back to inline audio_base64.
    const storage = await getStorageSettings(projectId).catch(() => null)
    if (storage && storage.provider !== 'supabase') {
      return jsonError(
        c,
        'UNSUPPORTED_STORAGE_PROVIDER',
        `Signed voice uploads need Supabase storage; this project uses ${storage.provider}. Send audio_base64 instead.`,
      )
    }

    const path = `${projectId}/${crypto.randomUUID()}.${ext}`
    const { data, error } = await db.storage.from(VOICE_INTAKE_BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      vlog.error('createSignedUploadUrl failed', { projectId, err: error?.message })
      return jsonError(c, 'UPSTREAM_ERROR', 'Could not mint an upload URL. Retry in a moment.', 502)
    }
    return c.json({
      ok: true,
      data: {
        bucket: VOICE_INTAKE_BUCKET,
        path,
        signedUrl: data.signedUrl,
        token: data.token,
        mime: mimeForExtension(ext),
        expires_in: UPLOAD_URL_TTL_SEC,
      },
    })
  })

  // ── GET /v1/intake/voice/sessions ──────────────────────────────────────
  app.get('/v1/intake/voice/sessions', adminOrApiKey({ scope: ['mcp:read', 'voice:write'] }), async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response

    const limitRaw = Number(c.req.query('limit') ?? '20')
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 20
    const { data, error } = await db
      .from('voice_intake_sessions')
      .select(SESSION_COLUMNS)
      .eq('project_id', resolved.project.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { sessions: data ?? [] } })
  })

  // ── GET /v1/intake/voice/:id ───────────────────────────────────────────
  app.get('/v1/intake/voice/:id', adminOrApiKey({ scope: ['mcp:read', 'voice:write'] }), async (c) => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a UUID')
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response

    const { data, error } = await db
      .from('voice_intake_sessions')
      .select(SESSION_COLUMNS)
      .eq('project_id', resolved.project.id)
      .eq('id', id)
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!data) return jsonError(c, 'NOT_FOUND', 'No such voice session in this project', 404)
    return c.json({ ok: true, session: data })
  })

  // ── POST /v1/intake/voice/:id/confirm ──────────────────────────────────
  app.post('/v1/intake/voice/:id/confirm', adminOrApiKey({ scope: 'voice:write' }), async (c) => {
    const reporterBlock = rejectReporterHeaders(c)
    if (reporterBlock) return reporterBlock
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a UUID')

    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response

    const parsed = gateBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'token is required')

    // Project scoping: the session must belong to the caller's project.
    const { data: owned } = await db
      .from('voice_intake_sessions')
      .select('id')
      .eq('id', id)
      .eq('project_id', resolved.project.id)
      .maybeSingle()
    if (!owned) return jsonError(c, 'NOT_FOUND', 'No such voice session in this project', 404)

    const result = await confirmVoice(db, { sessionId: id, token: parsed.data.token, actor: userId })
    const session = {
      id,
      status: result.status,
      ...(result.reportId ? { report_id: result.reportId } : {}),
      ...(result.dispatchId ? { dispatch_id: result.dispatchId } : {}),
      message: result.message,
    }
    if (result.ok) return c.json({ ok: true, session })
    switch (result.status) {
      case 'invalid_token':
        return jsonError(c, 'INVALID_CONFIRM_TOKEN', result.message, 403, { session })
      case 'expired':
        return jsonError(c, 'EXPIRED', result.message, 410, { session })
      case 'not_found':
        return jsonError(c, 'NOT_FOUND', result.message, 404)
      case 'autofix_disabled':
        return jsonError(c, 'AUTOFIX_DISABLED', result.message, 400, { session })
      case 'failed':
        return jsonError(c, 'UPSTREAM_ERROR', result.message, 502, { session })
      default:
        // Already confirmed / cancelled / dispatched / refused — single use.
        return jsonError(c, 'CONFLICT', result.message, 409, { session })
    }
  })

  // ── POST /v1/intake/voice/:id/cancel ───────────────────────────────────
  app.post('/v1/intake/voice/:id/cancel', adminOrApiKey({ scope: 'voice:write' }), async (c) => {
    const reporterBlock = rejectReporterHeaders(c)
    if (reporterBlock) return reporterBlock
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a UUID')

    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response

    const parsed = gateBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'token is required')

    const { data: owned } = await db
      .from('voice_intake_sessions')
      .select('id')
      .eq('id', id)
      .eq('project_id', resolved.project.id)
      .maybeSingle()
    if (!owned) return jsonError(c, 'NOT_FOUND', 'No such voice session in this project', 404)

    const result = await cancelVoice(db, { sessionId: id, token: parsed.data.token, actor: userId })
    if (result.ok) return c.json({ ok: true, session: { id, status: 'cancelled', message: result.message } })
    const session = { id, message: result.message }
    switch (result.status) {
      case 'invalid_token':
        return jsonError(c, 'INVALID_CONFIRM_TOKEN', result.message, 403, { session })
      case 'expired':
        return jsonError(c, 'EXPIRED', result.message, 410, { session })
      case 'not_found':
        return jsonError(c, 'NOT_FOUND', result.message, 404)
      default:
        return jsonError(c, 'CONFLICT', result.message, 409, { session })
    }
  })
}
