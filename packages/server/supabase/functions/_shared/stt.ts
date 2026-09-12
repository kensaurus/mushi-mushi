// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/stt.ts
 * PURPOSE: Speech-to-text for the voice inbox (plan C2). OpenAI only:
 *          `gpt-transcribe` first (multi-language `languages[]` hint,
 *          $0.0045/min), same-key fallback to `gpt-4o-mini-transcribe`
 *          (single `language`, $0.003/min). Runs inside `withLlmFailover` so
 *          BYOK rotation, the hosted-wallet preflight and `markKeyUsed` apply
 *          exactly as they do for every other OpenAI call.
 *
 * Boundaries enforced here, before any bytes leave the edge:
 *   - 25 MB request cap (OpenAI's documented ceiling for /audio/transcriptions)
 *   - 120 s clip cap when the caller knows the duration
 *   - the multipart filename always carries the extension that matches the
 *     MIME type — OpenAI sniffs the container from the extension, and a
 *     `blob` filename is rejected with 400 "Unsupported file format".
 *
 * Observability: one Langfuse trace `voice.stt` per call with a `transcribe`
 * span, plus an `llm_invocations` row (stage `stt`) so Billing/Health see the
 * call. Token counts are meaningless for audio; cost is derived from minutes.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { withLlmFailover } from './llm-failover.ts'
import { fetchWithTimeout } from './http.ts'
import { createTrace } from './observability.ts'
import { logLlmInvocation } from './telemetry.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('stt')

export const STT_PRIMARY_MODEL = 'gpt-transcribe'
export const STT_FALLBACK_MODEL = 'gpt-4o-mini-transcribe'

/** OpenAI /v1/audio/transcriptions hard limit. */
export const STT_MAX_BYTES = 25 * 1024 * 1024
/** Product cap: voice notes are short; anything longer is a podcast, not a bug. */
export const STT_MAX_DURATION_SEC = 120
/** Outbound timeout — a 2-minute clip transcribes in well under 30 s. */
export const STT_TIMEOUT_MS = 30_000

/** USD per audio minute, used for the cost estimate on the session row. */
const STT_USD_PER_MINUTE: Record<string, number> = {
  [STT_PRIMARY_MODEL]: 0.0045,
  [STT_FALLBACK_MODEL]: 0.003,
}

export type AudioExtension = 'ogg' | 'm4a' | 'mp3' | 'webm' | 'wav'

/**
 * MIME → extension. The keys are the bucket allow-list
 * (20260912003000_voice_intake_bucket.sql) plus the aliases browsers and
 * Telegram actually send (`audio/oga`, `audio/x-wav`, codec suffixes).
 */
export function extensionForMime(mime: string | null | undefined): AudioExtension | null {
  const base = (mime ?? '').split(';')[0]!.trim().toLowerCase()
  switch (base) {
    case 'audio/ogg':
    case 'audio/oga':
    case 'audio/opus':
    case 'application/ogg':
      return 'ogg'
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
    case 'audio/aac':
      return 'm4a'
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/webm':
    case 'video/webm':
      return 'webm'
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav'
    default:
      return null
  }
}

/** Canonical MIME for an extension (what we tell OpenAI and the bucket). */
export function mimeForExtension(ext: AudioExtension): string {
  switch (ext) {
    case 'ogg':
      return 'audio/ogg'
    case 'm4a':
      return 'audio/mp4'
    case 'mp3':
      return 'audio/mpeg'
    case 'webm':
      return 'audio/webm'
    case 'wav':
      return 'audio/wav'
  }
}

/**
 * Make sure the filename we send carries the extension the MIME type
 * implies. `voice` + `audio/ogg` → `voice.ogg`; `clip.blob` + `audio/mp4` →
 * `clip.m4a`. Path separators and control characters are dropped.
 */
export function normalizeAudioFilename(filename: string | null | undefined, ext: AudioExtension): string {
  const raw = (filename ?? 'voice').split(/[\\/]/).pop() ?? 'voice'
  const cleaned = raw.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '')
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'voice'
  return `${stem.slice(0, 80)}.${ext}`
}

export class SttError extends Error {
  constructor(
    readonly code: 'audio_too_large' | 'audio_too_long' | 'unsupported_mime' | 'empty_transcript' | 'provider_error',
    message: string,
  ) {
    super(message)
    this.name = 'SttError'
  }
}

export interface TranscribeAudioInput {
  bytes: Uint8Array
  mime: string
  filename: string
  /** BCP-47 hints, most likely first (project_settings.voice_languages). */
  languages: string[]
  /** Product vocabulary / spelling hints; also biases the output style. */
  prompt?: string
  /** Caller-known duration (Telegram/Slack report it) — enforced against the cap. */
  durationSec?: number
}

export interface TranscribeAudioResult {
  text: string
  language?: string
  durationSec?: number
  model: string
  costUsd?: number
  /** Which key answered (byok vs platform env) — mirrored on the session row. */
  keySource?: 'byok' | 'env'
}

interface OpenAiTranscriptionJson {
  text?: string
  language?: string
  duration?: number
  usage?: { type?: string; seconds?: number }
}

function normalizeLanguages(languages: string[]): string[] {
  const out: string[] = []
  for (const raw of languages) {
    const tag = String(raw ?? '').trim().toLowerCase().split('-')[0] ?? ''
    if (/^[a-z]{2,3}$/.test(tag) && !out.includes(tag)) out.push(tag)
  }
  return out.length > 0 ? out : ['en']
}

async function postTranscription(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: TranscribeAudioInput,
  ext: AudioExtension,
  languages: string[],
): Promise<{ ok: true; json: OpenAiTranscriptionJson } | { ok: false; status: number; body: string }> {
  const form = new FormData()
  // A fresh ArrayBuffer copy: Blob wants a BufferSource, and slicing avoids
  // handing the provider a view over a larger shared buffer.
  const copy = new Uint8Array(input.bytes.byteLength)
  copy.set(input.bytes)
  form.append('file', new Blob([copy], { type: mimeForExtension(ext) }), normalizeAudioFilename(input.filename, ext))
  form.append('model', model)
  form.append('response_format', 'json')
  if (input.prompt) form.append('prompt', input.prompt.slice(0, 1000))
  if (model === STT_PRIMARY_MODEL) {
    for (const lang of languages) form.append('languages[]', lang)
  } else {
    form.append('language', languages[0]!)
  }

  const res = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, '')}/audio/transcriptions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
    STT_TIMEOUT_MS,
  )
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 500)
    return { ok: false, status: res.status, body }
  }
  const json = (await res.json().catch(() => ({}))) as OpenAiTranscriptionJson
  return { ok: true, json }
}

/**
 * Transcribe one clip. Throws `SttError` for caller-side problems (size,
 * duration, MIME) before any network call, `LlmFailoverError` when no OpenAI
 * key can answer, and a generic Error for a provider failure on both models.
 */
export async function transcribeAudio(
  db: SupabaseClient,
  projectId: string,
  input: TranscribeAudioInput,
): Promise<TranscribeAudioResult> {
  if (input.bytes.byteLength === 0) {
    throw new SttError('audio_too_large', 'Audio payload is empty')
  }
  if (input.bytes.byteLength > STT_MAX_BYTES) {
    throw new SttError('audio_too_large', `Audio exceeds ${STT_MAX_BYTES / (1024 * 1024)} MB`)
  }
  if (input.durationSec !== undefined && input.durationSec > STT_MAX_DURATION_SEC) {
    throw new SttError('audio_too_long', `Audio exceeds ${STT_MAX_DURATION_SEC} s`)
  }
  const ext = extensionForMime(input.mime)
  if (!ext) {
    throw new SttError('unsupported_mime', `Unsupported audio type "${input.mime}"`)
  }

  const languages = normalizeLanguages(input.languages)
  const trace = createTrace('voice.stt', { projectId, mime: input.mime, bytes: input.bytes.byteLength })
  const span = trace.span('transcribe')
  const startedAt = Date.now()

  let usedModel = STT_PRIMARY_MODEL
  let fallbackReason: string | null = null
  let keySource: 'byok' | 'env' | undefined

  try {
    const json = await withLlmFailover(db, projectId, 'openai', async (key) => {
      keySource = key.source
      const baseUrl = key.baseUrl ?? 'https://api.openai.com/v1'
      const primary = await postTranscription(baseUrl, key.key, STT_PRIMARY_MODEL, input, ext, languages)
      if (primary.ok) {
        usedModel = STT_PRIMARY_MODEL
        return primary.json
      }
      // 401/403/429 must surface to withLlmFailover so it rotates the key —
      // retrying the fallback model on a dead key only burns time.
      if (primary.status === 401 || primary.status === 403 || primary.status === 429) {
        throw new Error(`OpenAI STT ${primary.status}: ${primary.body}`)
      }
      fallbackReason = `${STT_PRIMARY_MODEL} ${primary.status}: ${primary.body.slice(0, 200)}`
      log.warn('primary STT model failed; falling back', { projectId, status: primary.status })
      const fallback = await postTranscription(baseUrl, key.key, STT_FALLBACK_MODEL, input, ext, languages)
      if (!fallback.ok) {
        throw new Error(`OpenAI STT ${fallback.status}: ${fallback.body}`)
      }
      usedModel = STT_FALLBACK_MODEL
      return fallback.json
    })

    const text = (json.text ?? '').trim()
    const durationSec =
      typeof json.usage?.seconds === 'number'
        ? json.usage.seconds
        : typeof json.duration === 'number'
          ? json.duration
          : input.durationSec
    const latencyMs = Date.now() - startedAt
    const costUsd =
      durationSec !== undefined ? Number(((durationSec / 60) * (STT_USD_PER_MINUTE[usedModel] ?? 0)).toFixed(6)) : undefined

    span.end({ model: usedModel, latencyMs, durationSec, fallbackUsed: usedModel !== STT_PRIMARY_MODEL })
    void logLlmInvocation(db, {
      projectId,
      functionName: 'voice-intake',
      stage: 'stt',
      primaryModel: STT_PRIMARY_MODEL,
      usedModel,
      fallbackUsed: usedModel !== STT_PRIMARY_MODEL,
      fallbackReason,
      status: text ? 'success' : 'error',
      errorMessage: text ? null : 'empty transcript',
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      keySource: keySource ?? null,
      langfuseTraceId: trace.id,
    }).catch(() => {
      /* telemetry never fails the transcription */
    })
    void trace.end()

    if (!text) throw new SttError('empty_transcript', 'The provider returned an empty transcript')

    return {
      text,
      language: typeof json.language === 'string' ? json.language : undefined,
      durationSec,
      model: usedModel,
      costUsd,
      keySource,
    }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    const message = err instanceof Error ? err.message : String(err)
    span.end({ model: usedModel, latencyMs, error: message.slice(0, 300) })
    if (!(err instanceof SttError)) {
      void logLlmInvocation(db, {
        projectId,
        functionName: 'voice-intake',
        stage: 'stt',
        primaryModel: STT_PRIMARY_MODEL,
        usedModel,
        fallbackUsed: usedModel !== STT_PRIMARY_MODEL,
        fallbackReason,
        status: /timeout|timed out|aborted/i.test(message) ? 'timeout' : 'error',
        errorMessage: message.slice(0, 500),
        latencyMs,
        keySource: keySource ?? null,
        langfuseTraceId: trace.id,
      }).catch(() => {
        /* telemetry never masks the real error */
      })
    }
    void trace.end()
    throw err
  }
}
