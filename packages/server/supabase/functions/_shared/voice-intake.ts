// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/voice-intake.ts
 * PURPOSE: The one voice pipeline every inbox shares (plan C1–C3, C6, C7):
 *
 *   iOS Shortcut / Slack clip / Telegram voice note / PWA upload / raw API
 *     → ingestVoice(): gate → dedupe → caps → transcript (given, bucket, or
 *       bytes → STT) → sanitise + PII-scrub → privileged-verb refusal →
 *       strict-schema intent → report row (source='voice') → either done
 *       (create_report / unknown) or parked behind the confirmation gate
 *       (open_draft_pr) with a single-use HMAC token
 *     → confirmVoice(): token + expiry + single-use → dispatchFixForReport
 *     → cancelVoice()
 *
 * Every step writes its outcome to `voice_intake_sessions`, which is also the
 * return-path address book (`_shared/voice-return.ts`).
 *
 * Why the report is inserted here instead of through `api/helpers.ts
 * ingestReport`: `_shared/` may not import a sibling function directory
 * (scripts/check-edge-fn-imports.mjs — the deploy bundle for telegram-webhook
 * or slack-interactions would not contain `api/`). `createVoiceReport` mirrors
 * the two things ingestReport does that matter for a voice report — the row
 * plus the stage-1 `processing_queue` entry and fast-filter invocation — so
 * classification still runs.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sanitizeForLLM } from './sanitize.ts'
import { scrubPii } from './pii-scrubber.ts'
import { claimTenantRateLimit } from './tenant-observability.ts'
import { createTrace } from './observability.ts'
import { transcribeAudio, extensionForMime, mimeForExtension, SttError, STT_MAX_DURATION_SEC } from './stt.ts'
import {
  classifyVoiceIntent,
  refusesPrivilegedVerbs,
  mintConfirmToken,
  verifyConfirmToken,
  sha256Hex,
  constantTimeEqualStrings,
  CONFIRM_TOKEN_TTL_MS,
  type VoiceAction,
} from './voice-intent.ts'
import { dispatchFixForReport } from './dispatch.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('voice-intake')

// ── Public contract (other inboxes code against these) ─────────────────────

export type VoiceSource = 'ios_shortcut' | 'slack' | 'telegram' | 'pwa' | 'api'

export interface VoiceIngestInput {
  projectId: string
  source: VoiceSource
  /** Idempotency key within (project, source): Telegram update_id, Slack event_id, a client uuid, … */
  externalId: string
  /** Supabase auth user id when the request came from a signed-in admin (JWT / PWA). */
  requestedBy?: string | null
  /** Already-transcribed text (iOS dictation, Slack slash command, Telegram text). */
  transcript?: string
  /** Raw audio the adapter downloaded server-side (Slack, Telegram) or received inline (API). */
  audio?: { bytes: Uint8Array; mime: string; filename: string; durationSec?: number }
  /** Object path inside the `voice-intake` bucket (PWA signed upload). */
  audioPath?: string
  /** STT language hints; defaults to project_settings.voice_languages. */
  languages?: string[]
  /** Where the return path should reply. Adapters may store extra keys on the row. */
  channel?: {
    slackChannelId?: string
    slackThreadTs?: string
    slackUserId?: string
    telegramChatId?: string
    telegramMessageId?: number
    userId?: string
  }
}

export interface VoiceIngestResult {
  sessionId: string
  status: 'awaiting_confirm' | 'refused' | 'created' | 'duplicate' | 'failed'
  transcript: string
  action: 'create_report' | 'open_draft_pr' | 'unknown'
  summary: string
  confirmToken?: string
  reportId?: string
  /** What the channel speaks / posts back. For `failed`, starts with a stable reason code. */
  message: string
}

export interface VoiceConfirmInput {
  sessionId: string
  token: string
  /** Who confirmed: auth user id, `telegram:<user id>`, `slack:<user id>`, … */
  actor: string
}

export interface VoiceConfirmResult {
  ok: boolean
  status: string
  reportId?: string
  dispatchId?: string
  message: string
}

/**
 * Stable reason codes that prefix `message` on a `failed` result. Routes map
 * them to HTTP statuses; chat adapters show the human text after the colon.
 */
export const VOICE_FAILURE = {
  disabled: 'voice_intake_disabled',
  rateLimited: 'rate_limited',
  noInput: 'no_input',
  emptyTranscript: 'empty_transcript',
  audioTooLarge: 'audio_too_large',
  audioTooLong: 'audio_too_long',
  unsupportedMime: 'unsupported_mime',
  sttFailed: 'stt_failed',
  storageFailed: 'storage_failed',
  reportFailed: 'report_failed',
  internal: 'internal_error',
} as const

export type VoiceFailureCode = (typeof VOICE_FAILURE)[keyof typeof VOICE_FAILURE]

/** Parse the reason code off a `failed` result's message. */
export function voiceFailureCode(message: string): VoiceFailureCode | null {
  const head = message.split(':')[0]?.trim() ?? ''
  return (Object.values(VOICE_FAILURE) as string[]).includes(head) ? (head as VoiceFailureCode) : null
}

export const VOICE_INTAKE_BUCKET = 'voice-intake'
/** Bound on persisted transcripts; anything longer is not a voice note. */
export const VOICE_TRANSCRIPT_MAX_CHARS = 4000

/** Per-project caps (plan C7). Requests per minute, then audio minutes per day. */
export const VOICE_RATE_PER_MINUTE = 30
export const VOICE_MINUTES_PER_DAY = 120

// ── Internal row shape ─────────────────────────────────────────────────────

interface SessionRow {
  id: string
  project_id: string
  report_id: string | null
  source: VoiceSource
  external_id: string
  status: string
  transcript: string | null
  transcript_sha256: string | null
  audio_path: string | null
  audio_sha256: string | null
  action: VoiceAction | null
  summary: string | null
  confirm_token_hash: string | null
  expires_at: string | null
  channel: Record<string, unknown> | null
  requested_by: string | null
  dispatch_id: string | null
  pr_url: string | null
}

interface VoiceSettings {
  voice_intake_enabled?: boolean | null
  voice_audio_retention_days?: number | null
  voice_languages?: string[] | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function failed(sessionId: string, code: VoiceFailureCode, human: string, transcript = ''): VoiceIngestResult {
  return {
    sessionId,
    status: 'failed',
    transcript,
    action: 'unknown',
    summary: '',
    message: `${code}: ${human}`,
  }
}

function duplicateResult(row: SessionRow): VoiceIngestResult {
  return {
    sessionId: row.id,
    status: 'duplicate',
    transcript: row.transcript ?? '',
    action: row.action ?? 'unknown',
    summary: row.summary ?? '',
    ...(row.report_id ? { reportId: row.report_id } : {}),
    message: 'Already received this request.',
  }
}

async function updateSession(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('voice_intake_sessions').update(patch).eq('id', id)
  if (error) log.warn('voice_intake_sessions update failed', { sessionId: id, err: error.message })
}

async function findSession(
  db: SupabaseClient,
  projectId: string,
  source: VoiceSource,
  externalId: string,
): Promise<SessionRow | null> {
  const { data } = await db
    .from('voice_intake_sessions')
    .select('*')
    .eq('project_id', projectId)
    .eq('source', source)
    .eq('external_id', externalId)
    .maybeSingle()
  return (data as SessionRow | null) ?? null
}

/**
 * Claim `count` slots on a scoped limiter, one claim per slot (the RPC has no
 * weight argument). Stops at the first breach so a 5-minute clip arriving
 * with 2 minutes of budget left burns 2, not 5.
 */
async function claimSlots(db: SupabaseClient, scopeKey: string, count: number, limit: number, windowSec: number) {
  for (let i = 0; i < Math.max(1, count); i++) {
    const verdict = await claimTenantRateLimit(db, scopeKey, limit, windowSec)
    if (!verdict.allowed) return verdict
  }
  return { allowed: true as const }
}

async function downloadFromBucket(
  db: SupabaseClient,
  path: string,
): Promise<{ bytes: Uint8Array; mime: string } | { error: string }> {
  const { data, error } = await db.storage.from(VOICE_INTAKE_BUCKET).download(path)
  if (error || !data) return { error: error?.message ?? 'object not found' }
  const bytes = new Uint8Array(await data.arrayBuffer())
  const ext = extensionForMime(data.type) ?? extensionForMime(mimeFromPath(path))
  return { bytes, mime: ext ? mimeForExtension(ext) : data.type || 'audio/ogg' }
}

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg'
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4'
    case 'mp3':
      return 'audio/mpeg'
    case 'webm':
      return 'audio/webm'
    case 'wav':
      return 'audio/wav'
    default:
      return ''
  }
}

async function removeFromBucket(db: SupabaseClient, path: string): Promise<void> {
  const { error } = await db.storage.from(VOICE_INTAKE_BUCKET).remove([path])
  if (error) log.warn('voice audio delete failed', { path, err: error.message })
}

/**
 * Insert the report row + stage-1 queue entry and kick fast-filter, the
 * same three effects `ingestReport` produces for an SDK report. Returns the
 * report id or null when the insert failed (the session records the error).
 */
async function createVoiceReport(
  db: SupabaseClient,
  input: {
    projectId: string
    sessionId: string
    source: VoiceSource
    transcript: string
    summary: string
    language: string | null
    audioPath: string | null
    audioSha256: string | null
    requestedBy: string | null
    lowConfidence: boolean
  },
): Promise<string | null> {
  const reportId = crypto.randomUUID()
  const now = new Date().toISOString()
  const title = (input.summary || input.transcript).replace(/\s+/g, ' ').trim().slice(0, 120)
  const { error } = await db.from('reports').insert({
    id: reportId,
    project_id: input.projectId,
    description: input.transcript,
    category: 'other',
    user_category: 'voice',
    title,
    environment: { platform: `voice:${input.source}`, ...(input.language ? { language: input.language } : {}) },
    custom_metadata: {
      source: 'voice',
      voice_source: input.source,
      voice_session_id: input.sessionId,
      ...(input.lowConfidence ? { voice_intent_confidence: 'low' } : {}),
    },
    status: 'new',
    reporter_token_hash: 'voice-intake',
    reporter_user_id: input.requestedBy,
    source: 'voice',
    voice_transcript: input.transcript,
    voice_audio_path: input.audioPath,
    voice_audio_sha256: input.audioSha256,
    voice_language: input.language,
    synced_at: now,
    created_at: now,
  })
  if (error) {
    log.error('voice report insert failed', { sessionId: input.sessionId, errMsg: error.message, errCode: error.code })
    return null
  }

  const { error: queueError } = await db
    .from('processing_queue')
    .upsert(
      { report_id: reportId, project_id: input.projectId, stage: 'stage1', status: 'pending' },
      { onConflict: 'report_id,stage', ignoreDuplicates: true },
    )
  if (queueError && queueError.code !== '23505') {
    log.error('voice report queued for classification failed', { reportId, errMsg: queueError.message })
  }

  triggerVoiceClassification(db, reportId, input.projectId)
  return reportId
}

/**
 * Fire-and-forget fast-filter invocation (mirrors `api/helpers.ts
 * triggerClassification`). Failures flip the queue row to `failed` so the
 * status-reconciler retries; the voice request itself is already persisted.
 */
function triggerVoiceClassification(db: SupabaseClient, reportId: string, projectId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return

  const run = fetch(`${supabaseUrl}/functions/v1/fast-filter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ reportId, projectId }),
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      if (res.ok) {
        await db
          .from('processing_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('report_id', reportId)
          .eq('status', 'pending')
        return
      }
      const body = (await res.text().catch(() => '')).slice(0, 300)
      await db
        .from('processing_queue')
        .update({ status: 'failed', last_error: `Stage 1 failed: ${res.status} ${body}`, completed_at: new Date().toISOString() })
        .eq('report_id', reportId)
        .eq('status', 'pending')
    })
    .catch(async (err) => {
      await db
        .from('processing_queue')
        .update({ status: 'failed', last_error: String(err).slice(0, 300), completed_at: new Date().toISOString() })
        .eq('report_id', reportId)
        .eq('status', 'pending')
        .then(() => undefined, () => undefined)
    })

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(run)
}

// ── ingestVoice ────────────────────────────────────────────────────────────

export async function ingestVoice(db: SupabaseClient, input: VoiceIngestInput): Promise<VoiceIngestResult> {
  const { projectId, source } = input
  const externalId = input.externalId.trim()
  const trace = createTrace('voice.intake', { projectId, source })

  // 1. Project gate — voice is personal data, off by default.
  const { data: settingsRow } = await db
    .from('project_settings')
    .select('voice_intake_enabled, voice_audio_retention_days, voice_languages')
    .eq('project_id', projectId)
    .maybeSingle()
  const settings = (settingsRow as VoiceSettings | null) ?? null
  if (!settings?.voice_intake_enabled) {
    void trace.end()
    return failed('', VOICE_FAILURE.disabled, 'Voice intake is turned off for this project. Enable it in Settings → Voice intake.')
  }
  const retentionDays = Math.max(0, Number(settings.voice_audio_retention_days ?? 0))
  const languages = (input.languages?.length ? input.languages : settings.voice_languages) ?? ['en']

  // 2. Dedupe on (project, source, external_id).
  const existing = await findSession(db, projectId, source, externalId)
  if (existing) {
    void trace.end()
    return duplicateResult(existing)
  }

  // 3. Burst cap: requests per minute per project.
  const burst = await claimTenantRateLimit(db, `project:${projectId}:voice`, VOICE_RATE_PER_MINUTE, 60)
  if (!burst.allowed) {
    void trace.end()
    return failed(
      '',
      VOICE_FAILURE.rateLimited,
      `Too many voice requests. Retry in ${burst.retryAfterSec ?? 60} seconds.`,
    )
  }

  // 4. Ledger row first, so a crash mid-pipeline still dedupes the retry.
  const channel = { ...(input.channel ?? {}) }
  const requestedBy = input.requestedBy ?? null
  const { data: inserted, error: insertErr } = await db
    .from('voice_intake_sessions')
    .insert({
      project_id: projectId,
      source,
      external_id: externalId,
      status: 'received',
      channel,
      requested_by: requestedBy,
      ...(input.audioPath ? { audio_path: input.audioPath } : {}),
      ...(input.audio?.durationSec !== undefined ? { audio_duration_sec: input.audio.durationSec } : {}),
    })
    .select('id')
    .single()
  if (insertErr || !inserted) {
    if (insertErr?.code === '23505') {
      const raced = await findSession(db, projectId, source, externalId)
      void trace.end()
      if (raced) return duplicateResult(raced)
    }
    log.error('voice_intake_sessions insert failed', { projectId, source, err: insertErr?.message })
    void trace.end()
    return failed('', VOICE_FAILURE.internal, 'Could not record the request. Try again.')
  }
  const sessionId = (inserted as { id: string }).id
  const span = trace.span('pipeline')

  try {
    // 5. Obtain the transcript.
    let transcript = (input.transcript ?? '').trim()
    let audioSha256: string | null = null
    let language: string | null = null
    let durationSec: number | undefined = input.audio?.durationSec
    let retainedAudioPath: string | null = null
    let sttModel: string | null = null
    let sttCostUsd: number | null = null

    if (!transcript) {
      let bytes: Uint8Array | null = null
      let mime = ''
      let filename = 'voice'

      if (input.audio) {
        bytes = input.audio.bytes
        mime = input.audio.mime
        filename = input.audio.filename
      } else if (input.audioPath) {
        const downloaded = await downloadFromBucket(db, input.audioPath)
        if ('error' in downloaded) {
          await updateSession(db, sessionId, { status: 'failed', refusal_reason: `storage: ${downloaded.error.slice(0, 200)}` })
          return failed(sessionId, VOICE_FAILURE.storageFailed, 'The uploaded audio could not be read.')
        }
        bytes = downloaded.bytes
        mime = downloaded.mime
        filename = input.audioPath.split('/').pop() ?? 'voice'
      } else {
        await updateSession(db, sessionId, { status: 'failed', refusal_reason: 'no_input' })
        return failed(sessionId, VOICE_FAILURE.noInput, 'Send a transcript, an audio_path, or audio bytes.')
      }

      audioSha256 = await sha256Hex(bytes)

      // Daily audio-minutes cap, counted per started minute. When the clip's
      // length is unknown we claim one minute up front and true-up afterwards.
      const preMinutes = Math.max(1, Math.ceil((durationSec ?? 60) / 60))
      const minutes = await claimSlots(db, `project:${projectId}:voice-minutes-day`, preMinutes, VOICE_MINUTES_PER_DAY, 86_400)
      if (!minutes.allowed) {
        await updateSession(db, sessionId, { status: 'failed', refusal_reason: 'daily_minutes_cap', audio_sha256: audioSha256 })
        if (input.audioPath && retentionDays === 0) await removeFromBucket(db, input.audioPath)
        return failed(sessionId, VOICE_FAILURE.rateLimited, 'Daily voice minutes cap reached for this project. Try again tomorrow.')
      }

      let stt
      try {
        stt = await transcribeAudio(db, projectId, { bytes, mime, filename, languages, durationSec })
      } catch (err) {
        const code =
          err instanceof SttError
            ? err.code === 'audio_too_large'
              ? VOICE_FAILURE.audioTooLarge
              : err.code === 'audio_too_long'
                ? VOICE_FAILURE.audioTooLong
                : err.code === 'unsupported_mime'
                  ? VOICE_FAILURE.unsupportedMime
                  : err.code === 'empty_transcript'
                    ? VOICE_FAILURE.emptyTranscript
                    : VOICE_FAILURE.sttFailed
            : VOICE_FAILURE.sttFailed
        const human =
          code === VOICE_FAILURE.audioTooLong
            ? `Voice notes are capped at ${STT_MAX_DURATION_SEC} seconds.`
            : code === VOICE_FAILURE.audioTooLarge
              ? 'The audio file is too large (25 MB max).'
              : code === VOICE_FAILURE.unsupportedMime
                ? 'That audio format is not supported (ogg, m4a, mp3, webm, wav).'
                : code === VOICE_FAILURE.emptyTranscript
                  ? "I couldn't hear anything in that clip."
                  : 'Transcription failed. Check the OpenAI key in Settings → API keys and try again.'
        log.warn('voice transcription failed', { sessionId, code, err: String(err).slice(0, 300) })
        await updateSession(db, sessionId, { status: 'failed', refusal_reason: code, audio_sha256: audioSha256 })
        if (input.audioPath && retentionDays === 0) await removeFromBucket(db, input.audioPath)
        return failed(sessionId, code, human)
      }

      transcript = stt.text
      language = stt.language ?? null
      durationSec = stt.durationSec ?? durationSec
      sttModel = stt.model
      sttCostUsd = stt.costUsd ?? null

      // True-up the minutes cap when the clip turned out longer than claimed.
      const actualMinutes = Math.max(1, Math.ceil((durationSec ?? 60) / 60))
      if (actualMinutes > preMinutes) {
        await claimSlots(db, `project:${projectId}:voice-minutes-day`, actualMinutes - preMinutes, VOICE_MINUTES_PER_DAY, 86_400)
      }

      // Cost ledger (plan C7). `voice_minutes_transcribed` is deliberately NOT
      // in usage-aggregator's `meteredEvents` allowlist, so this records spend
      // for the console and for per-project cost review without pushing a
      // Stripe meter event. Adding it to that allowlist is what would make it
      // billable — do not do that without a priced SKU.
      const { error: usageErr } = await db.from('usage_events').insert({
        project_id: projectId,
        event_name: 'voice_minutes_transcribed',
        quantity: actualMinutes,
        metadata: {
          voice_session_id: sessionId,
          source,
          duration_sec: durationSec ?? null,
          stt_model: sttModel,
          stt_cost_usd: sttCostUsd,
          language,
        },
      })
      if (usageErr) {
        log.warn('usage_events voice_minutes_transcribed insert failed (non-fatal)', {
          sessionId,
          err: usageErr.message,
        })
      }

      // 6. Audio lifecycle (plan C6): delete unless the project retains it.
      if (retentionDays > 0) {
        if (input.audioPath) {
          retainedAudioPath = input.audioPath
        } else if (bytes) {
          const ext = extensionForMime(mime) ?? 'ogg'
          const path = `${projectId}/${sessionId}.${ext}`
          const copy = new Uint8Array(bytes.byteLength)
          copy.set(bytes)
          const { error: upErr } = await db.storage
            .from(VOICE_INTAKE_BUCKET)
            .upload(path, copy, { contentType: mimeForExtension(ext), upsert: true })
          if (upErr) log.warn('voice audio retention upload failed', { sessionId, err: upErr.message })
          else retainedAudioPath = path
        }
      } else if (input.audioPath) {
        await removeFromBucket(db, input.audioPath)
      }
    }

    // 7. Sanitise (invisible Unicode, HTML comments, LLM01 patterns) + PII scrub.
    const sanitized = sanitizeForLLM(transcript)
    const clean = scrubPii(sanitized.text).replace(/\s+/g, ' ').trim().slice(0, VOICE_TRANSCRIPT_MAX_CHARS)
    if (!clean) {
      await updateSession(db, sessionId, { status: 'failed', refusal_reason: 'empty_transcript', audio_sha256: audioSha256, audio_path: retainedAudioPath })
      return failed(sessionId, VOICE_FAILURE.emptyTranscript, 'The transcript was empty after cleaning.')
    }
    const transcriptSha256 = await sha256Hex(clean)

    await updateSession(db, sessionId, {
      status: 'transcribed',
      transcript: clean,
      transcript_sha256: transcriptSha256,
      audio_sha256: audioSha256,
      audio_path: retainedAudioPath,
      audio_duration_sec: durationSec ?? null,
      language,
      channel: {
        ...channel,
        ...(sttModel ? { stt_model: sttModel } : {}),
        ...(sttCostUsd !== null ? { stt_cost_usd: sttCostUsd } : {}),
        ...(sanitized.blocked > 0 ? { sanitizer_blocked: sanitized.blocked } : {}),
      },
    })

    // 8. Privileged verbs never reach an agent from a voice note.
    const verdict = refusesPrivilegedVerbs(clean)
    if (verdict.refused) {
      await updateSession(db, sessionId, { status: 'refused', action: 'unknown', refusal_reason: verdict.matched.join(',') })
      return {
        sessionId,
        status: 'refused',
        transcript: clean,
        action: 'unknown',
        summary: '',
        message:
          `I heard: "${clean}"\n\n` +
          `Refused: it mentions ${verdict.matched.join(', ')}. Voice intake never merges, deploys, deletes, or touches production or secrets — use the console for that.`,
      }
    }

    // 9. Strict-schema intent.
    const intent = await classifyVoiceIntent(db, projectId, clean)
    const summary = intent.summary || clean.slice(0, 280)

    // 10. The report always exists — even an unknown intent is a note worth keeping.
    const reportId = await createVoiceReport(db, {
      projectId,
      sessionId,
      source,
      transcript: clean,
      summary,
      language,
      audioPath: retainedAudioPath,
      audioSha256,
      requestedBy,
      lowConfidence: intent.intent === 'unknown',
    })
    if (!reportId) {
      await updateSession(db, sessionId, { status: 'failed', action: intent.intent, summary, refusal_reason: 'report_insert_failed' })
      return failed(sessionId, VOICE_FAILURE.reportFailed, 'The report could not be stored. Try again.', clean)
    }

    if (intent.intent === 'open_draft_pr') {
      const expiresAtIso = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString()
      const confirmToken = await mintConfirmToken({ sessionId, transcriptSha256, action: 'open_draft_pr', expiresAtIso })
      await updateSession(db, sessionId, {
        status: 'awaiting_confirm',
        action: 'open_draft_pr',
        summary,
        report_id: reportId,
        confirm_token_hash: await sha256Hex(confirmToken),
        expires_at: expiresAtIso,
      })
      return {
        sessionId,
        status: 'awaiting_confirm',
        transcript: clean,
        action: 'open_draft_pr',
        summary,
        confirmToken,
        reportId,
        message: `Voice request (verbatim): ${clean}\n\nAction: open a draft PR. Reply confirm to proceed.`,
      }
    }

    const now = new Date().toISOString()
    await updateSession(db, sessionId, {
      status: 'confirmed',
      action: intent.intent,
      summary,
      report_id: reportId,
      confirmed_at: now,
      confirmed_by: 'auto',
    })
    return {
      sessionId,
      status: 'created',
      transcript: clean,
      action: intent.intent,
      summary,
      reportId,
      message:
        intent.intent === 'unknown'
          ? `Filed a report from: "${clean}"\n\n(I wasn't sure what you wanted done with it — review it in the console.)`
          : `Filed report: ${summary}\n\nFrom: "${clean}"`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('voice intake pipeline failed', { sessionId, projectId, source, err: message.slice(0, 500) })
    await updateSession(db, sessionId, { status: 'failed', refusal_reason: 'internal_error' })
    return failed(sessionId, VOICE_FAILURE.internal, 'Something went wrong while processing the voice note.')
  } finally {
    span.end()
    void trace.end()
  }
}

// ── Confirmation gate ──────────────────────────────────────────────────────

async function loadSessionForGate(db: SupabaseClient, sessionId: string): Promise<SessionRow | null> {
  if (!UUID_RE.test(sessionId)) return null
  const { data } = await db.from('voice_intake_sessions').select('*').eq('id', sessionId).maybeSingle()
  return (data as SessionRow | null) ?? null
}

async function verifyGateToken(db: SupabaseClient, row: SessionRow, token: string): Promise<'ok' | 'expired' | 'invalid'> {
  if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    await updateSession(db, row.id, { status: 'expired', confirm_token_hash: null })
    return 'expired'
  }
  const hashMatches = constantTimeEqualStrings(await sha256Hex(token), row.confirm_token_hash ?? '')
  const signatureValid = await verifyConfirmToken(token, {
    sessionId: row.id,
    transcriptSha256: row.transcript_sha256 ?? '',
    action: (row.action ?? 'open_draft_pr') as VoiceAction,
    expiresAtIso: row.expires_at,
  })
  return hashMatches && signatureValid ? 'ok' : 'invalid'
}

export async function confirmVoice(db: SupabaseClient, input: VoiceConfirmInput): Promise<VoiceConfirmResult> {
  const row = await loadSessionForGate(db, input.sessionId)
  if (!row) return { ok: false, status: 'not_found', message: 'No such voice request.' }
  if (row.status !== 'awaiting_confirm') {
    return {
      ok: false,
      status: row.status,
      ...(row.report_id ? { reportId: row.report_id } : {}),
      ...(row.dispatch_id ? { dispatchId: row.dispatch_id } : {}),
      message: `This request is already ${row.status.replace(/_/g, ' ')}.`,
    }
  }
  const verdict = await verifyGateToken(db, row, input.token)
  if (verdict === 'expired') {
    return { ok: false, status: 'expired', message: 'The confirmation window (10 minutes) has passed. Send the request again.' }
  }
  if (verdict === 'invalid') {
    return { ok: false, status: 'invalid_token', message: 'That confirmation token is not valid for this request.' }
  }
  if (!row.report_id) {
    await updateSession(db, row.id, { status: 'failed', refusal_reason: 'missing_report' })
    return { ok: false, status: 'failed', message: 'The request has no report attached.' }
  }

  // Single use: only the row still in awaiting_confirm flips to confirmed.
  const { data: flipped, error: flipErr } = await db
    .from('voice_intake_sessions')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: input.actor.slice(0, 200),
      confirm_token_hash: null,
    })
    .eq('id', row.id)
    .eq('status', 'awaiting_confirm')
    .select('id')
  if (flipErr || !flipped || (flipped as unknown[]).length === 0) {
    return { ok: false, status: 'confirmed', message: 'This request was already confirmed.' }
  }

  const dispatch = await dispatchFixForReport({
    projectId: row.project_id,
    reportId: row.report_id,
    requestedBy: UUID_RE.test(input.actor) ? input.actor : null,
    skipMembershipCheck: true,
    metadata: { source: 'voice', voice_session_id: row.id, actor: input.actor.slice(0, 200) },
  })

  if (!dispatch.ok) {
    if (dispatch.code === 'ALREADY_DISPATCHED') {
      await updateSession(db, row.id, { status: 'dispatched', dispatch_id: dispatch.dispatchId ?? null })
      return {
        ok: true,
        status: 'dispatched',
        reportId: row.report_id,
        ...(dispatch.dispatchId ? { dispatchId: dispatch.dispatchId } : {}),
        message: 'A fix is already in progress for this report. I will reply here when the draft PR opens.',
      }
    }
    if (dispatch.code === 'AUTOFIX_DISABLED') {
      await updateSession(db, row.id, { status: 'failed', refusal_reason: 'autofix_disabled' })
      return {
        ok: false,
        status: 'autofix_disabled',
        reportId: row.report_id,
        message: 'Autofix is turned off for this project. Enable it in Settings → Fixes, then send the request again.',
      }
    }
    await updateSession(db, row.id, { status: 'failed', refusal_reason: `dispatch:${dispatch.code ?? 'unknown'}` })
    return {
      ok: false,
      status: 'failed',
      reportId: row.report_id,
      message: dispatch.message ?? 'The fix could not be dispatched.',
    }
  }

  await updateSession(db, row.id, { status: 'dispatched', dispatch_id: dispatch.dispatchId ?? null })
  return {
    ok: true,
    status: 'dispatched',
    reportId: row.report_id,
    ...(dispatch.dispatchId ? { dispatchId: dispatch.dispatchId } : {}),
    message: 'Draft PR requested. I will reply here when it opens.',
  }
}

export type VoiceCancelStatus = 'cancelled' | 'not_found' | 'conflict' | 'expired' | 'invalid_token'

export async function cancelVoice(
  db: SupabaseClient,
  input: VoiceConfirmInput,
): Promise<{ ok: boolean; status: VoiceCancelStatus; message: string }> {
  const row = await loadSessionForGate(db, input.sessionId)
  if (!row) return { ok: false, status: 'not_found', message: 'No such voice request.' }
  if (row.status !== 'awaiting_confirm') {
    return { ok: false, status: 'conflict', message: `This request is already ${row.status.replace(/_/g, ' ')}; nothing to cancel.` }
  }
  const verdict = await verifyGateToken(db, row, input.token)
  if (verdict === 'expired') return { ok: false, status: 'expired', message: 'The confirmation window had already passed; nothing was dispatched.' }
  if (verdict === 'invalid') return { ok: false, status: 'invalid_token', message: 'That confirmation token is not valid for this request.' }

  const { data: flipped } = await db
    .from('voice_intake_sessions')
    .update({
      status: 'cancelled',
      confirmed_by: input.actor.slice(0, 200),
      confirm_token_hash: null,
    })
    .eq('id', row.id)
    .eq('status', 'awaiting_confirm')
    .select('id')
  if (!flipped || (flipped as unknown[]).length === 0) {
    return { ok: false, status: 'conflict', message: 'This request was already handled.' }
  }
  return { ok: true, status: 'cancelled', message: 'Cancelled. Nothing was dispatched; the report stays in the console.' }
}
