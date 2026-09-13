// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/api/routes/slack-events-core.ts
 * PURPOSE: Slack inbox for voice intake (plan C1, "Slack" adapter) — all the
 *          logic, with `ingestVoice` injected so the vitest suite can drive
 *          it. `slack-events.ts` binds the real `_shared/voice-intake.ts`.
 *
 *   POST /v1/webhooks/slack/events
 *     Slack Events API. `url_verification` echoes the challenge; every
 *     `event_callback` is acked with 200 immediately and the work continues
 *     under `EdgeRuntime.waitUntil`. Handled events:
 *       - `message` whose `files[]` carries an audio file (Slack clips arrive
 *         this way — the old `file_share` subtype is no longer served)
 *       - `file_shared` (files.info → skip unless audio)
 *     The clip is downloaded with the bot token (`files:read`), handed to
 *     `ingestVoice`, and the outcome is posted back in-thread. An
 *     `awaiting_confirm` result renders the verbatim transcript with
 *     Confirm / Cancel buttons (`voice_confirm` / `voice_cancel`, handled by
 *     the `slack-interactions` function).
 *
 *   POST /v1/webhooks/slack/commands
 *     `/mushi voice <text>` — text intake (Siri/keyboard dictation in Slack)
 *     `/mushi list`         — last 10 open reports
 *     `/mushi open <id>`    — console deep link + summary
 *     `/mushi resolve <id>` — status → resolved via the shared transition
 *     `/mushi help`
 *     Ports `packages/plugin-slack-app/src/commands.ts buildSlashRouter`
 *     (edge bundles cannot import workspace packages).
 *
 * Project resolution: `project_settings.slack_team_id` (written by the OAuth
 * callback in settings-research.ts), disambiguated by `slack_channel_id`
 * when one workspace is connected to several projects.
 *
 * Idempotency: sessions are keyed on `voice_intake_sessions.external_id`
 * (`slack:file:<file_id>` for clips, `slack:cmd:<trigger_id>` for slash
 * text). The file id — not the event id — is the key because Slack emits
 * BOTH a `message` and a `file_shared` event for one upload, and retries
 * (X-Slack-Retry-Num) re-send the same file id. A cheap existence check runs
 * before the download; the session table's unique constraint is the backstop.
 *
 * Security: `_shared/slack-verify.ts` (v0 HMAC over the raw body, 5-minute
 * window, constant-time compare). The slash route additionally goes through
 * the shared webhook middleware (audit row, replay cache on trigger_id, per-IP
 * rate limit). Slack user ids are recorded as actors but never trusted as
 * project members — the same posture as slack-interactions.
 */

import type { Hono, Context } from 'npm:hono@4'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log as rootLog } from '../../_shared/logger.ts'
import { reportError, reportMessage } from '../../_shared/sentry.ts'
import { fetchWithTimeout } from '../../_shared/http.ts'
import { sendBotMessage, buildReportDeepLink } from '../../_shared/slack.ts'
import { verifySlackRequest } from '../../_shared/slack-verify.ts'
import { applyReportStatusTransition } from '../../_shared/report-transition.ts'
import type { VoiceIngestInput, VoiceIngestResult } from '../../_shared/voice-intake.ts'
import {
  createWebhookMiddleware,
  ReplayAttackError,
  RateLimitError,
} from '../../_shared/webhook-middleware.ts'

const log = rootLog.child('slack-events')

/** Injected so tests (and future adapters) can swap the intake pipeline. */
export interface SlackVoiceDeps {
  ingestVoice(db: SupabaseClient, input: VoiceIngestInput): Promise<VoiceIngestResult>
}

/** Slack's own cap for files.info downloads we are willing to buffer. */
export const MAX_SLACK_AUDIO_BYTES = 25 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
/** `file_shared` fires alongside `message`; give the message path a head
 *  start so the dedupe check usually wins instead of a second transcription. */
const FILE_SHARED_STAGGER_MS = 3_000
const LIST_LIMIT = 10
/** Statuses that mean "still open" for `/mushi list`. */
const CLOSED_STATUSES = ['fixed', 'resolved', 'dismissed', 'verified']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Slack `filetype` values we treat as audio even when `mimetype` is odd. */
const AUDIO_FILETYPES = new Set(['m4a', 'mp4', 'webm', 'ogg', 'oga', 'opus', 'mp3', 'mpga', 'wav', 'aac', 'flac'])
/** Formats our STT layer accepts as-is; anything else falls back to Slack's AAC rendition. */
const STT_NATIVE_FILETYPES = new Set(['m4a', 'mp4', 'webm', 'ogg', 'oga', 'mp3', 'mpga', 'wav', 'flac'])
const MESSAGE_SUBTYPES_WITH_FILES = new Set(['file_share', 'thread_broadcast'])

// ── Slack payload shapes (subset) ────────────────────────────────────────────

export interface SlackFile {
  id?: string
  name?: string
  title?: string
  mimetype?: string
  filetype?: string
  subtype?: string
  mode?: string
  size?: number
  duration_ms?: number
  url_private_download?: string
  url_private?: string
  aac?: string
  shares?: {
    public?: Record<string, Array<{ ts?: string; thread_ts?: string }>>
    private?: Record<string, Array<{ ts?: string; thread_ts?: string }>>
  }
}

export interface SlackMessageEvent {
  type: 'message'
  subtype?: string
  channel?: string
  channel_type?: string
  user?: string
  bot_id?: string
  ts?: string
  thread_ts?: string
  text?: string
  files?: SlackFile[]
  team?: string
}

export interface SlackFileSharedEvent {
  type: 'file_shared'
  file_id?: string
  channel_id?: string
  user_id?: string
  event_ts?: string
  file?: { id?: string }
}

export type SlackEvent = SlackMessageEvent | SlackFileSharedEvent | { type: string }

export interface SlackEventEnvelope {
  type?: string
  token?: string
  challenge?: string
  team_id?: string
  api_app_id?: string
  event_id?: string
  event_time?: number
  event?: SlackEvent
  authorizations?: Array<{ user_id?: string; is_bot?: boolean }>
}

export interface SlashCommandForm {
  command: string
  text: string
  user_id: string
  channel_id: string
  team_id: string
  response_url: string
  trigger_id: string
}

export interface SlackProjectRef {
  projectId: string
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

export function isSlackAudioFile(file: SlackFile | null | undefined): boolean {
  if (!file) return false
  const mime = (file.mimetype ?? '').toLowerCase()
  if (mime.startsWith('audio/')) return true
  if (file.subtype === 'slack_audio') return true
  const ft = (file.filetype ?? '').toLowerCase()
  // `mp4` is ambiguous (video clips are also mp4) — only accept it when the
  // mimetype is not explicitly video.
  if (ft === 'mp4' && mime.startsWith('video/')) return false
  return AUDIO_FILETYPES.has(ft)
}

export type MushiCommand =
  | { sub: 'voice'; text: string }
  | { sub: 'list' }
  | { sub: 'open'; id: string }
  | { sub: 'resolve'; id: string }
  | { sub: 'help' }
  | { sub: 'usage'; text: string }

export function parseMushiCommand(rawText: string | null | undefined): MushiCommand {
  const text = (rawText ?? '').trim()
  if (!text) return { sub: 'help' }
  const [first, ...rest] = text.split(/\s+/)
  const sub = first.toLowerCase()
  switch (sub) {
    case 'voice':
    case 'say':
    case 'v': {
      const body = text.slice(first.length).trim()
      return body ? { sub: 'voice', text: body } : { sub: 'usage', text: 'Usage: `/mushi voice <what you want done>`' }
    }
    case 'list':
    case 'ls':
      return { sub: 'list' }
    case 'open':
    case 'show':
      return rest[0] ? { sub: 'open', id: rest[0] } : { sub: 'usage', text: 'Usage: `/mushi open <report-id>`' }
    case 'resolve':
    case 'fix':
    case 'done':
      return rest[0] ? { sub: 'resolve', id: rest[0] } : { sub: 'usage', text: 'Usage: `/mushi resolve <report-id>`' }
    case 'help':
    default:
      return { sub: 'help' }
  }
}

export const MUSHI_HELP_TEXT = [
  '*Mushi commands*',
  '• `/mushi voice <text>` — dictate a request; Mushi transcribes, proposes an action and asks you to confirm',
  '• `/mushi list` — last 10 open reports',
  '• `/mushi open <id>` — open a report in the console',
  '• `/mushi resolve <id>` — mark a report resolved',
  '• Or drop an *audio clip* in a connected channel and Mushi will transcribe it.',
].join('\n')

/** Escape Slack mrkdwn control characters in untrusted text. */
export function escapeSlackText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function quoteBlock(s: string): string {
  return escapeSlackText(truncate(s, 2500))
    .split('\n')
    .map((line) => `>${line}`)
    .join('\n')
}

/**
 * Message (text + blocks) for a voice intake outcome. Returns null when
 * nothing should be posted (a duplicate — the first delivery already replied).
 */
export function buildVoiceResultMessage(
  result: VoiceIngestResult,
): { text: string; blocks?: unknown[] } | null {
  const transcript = result.transcript ?? ''
  switch (result.status) {
    case 'awaiting_confirm': {
      const value = `${result.sessionId}:${result.confirmToken ?? ''}`
      const blocks: unknown[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:studio_microphone: *I heard:*\n${quoteBlock(transcript)}` },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Proposed action:* ${escapeSlackText(result.action ?? 'unknown')}\n${escapeSlackText(truncate(result.summary ?? '', 1500))}`,
          },
        },
        {
          type: 'actions',
          block_id: `mushi_voice_${result.sessionId}`,
          elements: [
            {
              type: 'button',
              action_id: 'voice_confirm',
              style: 'primary',
              text: { type: 'plain_text', text: 'Confirm', emoji: true },
              value,
            },
            {
              type: 'button',
              action_id: 'voice_cancel',
              style: 'danger',
              text: { type: 'plain_text', text: 'Cancel', emoji: true },
              value,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Confirm within 10 minutes · session \`${result.sessionId.slice(0, 8)}\``,
            },
          ],
        },
      ]
      return { text: `I heard: "${truncate(transcript, 200)}" — confirm?`, blocks }
    }
    case 'created': {
      const link = result.reportId ? buildReportDeepLink(result.reportId) : null
      const text =
        `:white_check_mark: ${escapeSlackText(result.message)}` +
        (link ? ` <${link}|Open report>` : result.reportId ? ` (\`${result.reportId.slice(0, 8)}\`)` : '')
      return { text }
    }
    case 'refused':
      return {
        text: `:no_entry: ${escapeSlackText(result.message)}\n${quoteBlock(transcript)}`,
      }
    case 'failed':
      return { text: `:x: ${escapeSlackText(result.message)}` }
    case 'duplicate':
      return null
    default:
      return { text: escapeSlackText(result.message) }
  }
}

// ── Project + token resolution ───────────────────────────────────────────────

export async function resolveSlackProject(
  db: SupabaseClient,
  input: { teamId?: string | null; channelId?: string | null },
): Promise<SlackProjectRef | null> {
  type Row = { project_id: string; slack_channel_id: string | null; slack_team_id: string | null }
  let rows: Row[] = []
  if (input.teamId) {
    const { data } = await db
      .from('project_settings')
      .select('project_id, slack_channel_id, slack_team_id')
      .eq('slack_team_id', input.teamId)
    rows = (data as Row[] | null) ?? []
  }
  if (rows.length === 0 && input.channelId) {
    const { data } = await db
      .from('project_settings')
      .select('project_id, slack_channel_id, slack_team_id')
      .eq('slack_channel_id', input.channelId)
    rows = (data as Row[] | null) ?? []
  }
  if (rows.length === 0) return null
  const byChannel = input.channelId ? rows.find((r) => r.slack_channel_id === input.channelId) : undefined
  return { projectId: (byChannel ?? rows[0]).project_id }
}

/** Same order as `_shared/slack.ts sendBotMessage`: project vault → env. */
export async function resolveSlackBotToken(db: SupabaseClient, projectId: string): Promise<string | null> {
  try {
    const { data: ps } = await db
      .from('project_settings')
      .select('slack_bot_token_ref')
      .eq('project_id', projectId)
      .maybeSingle()
    const ref = (ps as { slack_bot_token_ref?: string | null } | null)?.slack_bot_token_ref ?? null
    if (ref) {
      const { data: secret } = await db.rpc('vault_get_secret', { secret_id: ref })
      if (typeof secret === 'string' && secret) return secret
    }
  } catch (err) {
    log.warn('slack bot token vault lookup failed', { projectId, err: String(err) })
  }
  return Deno.env.get('SLACK_BOT_TOKEN') ?? null
}

async function voiceSessionExists(db: SupabaseClient, projectId: string, externalId: string): Promise<boolean> {
  const { data } = await db
    .from('voice_intake_sessions')
    .select('id')
    .eq('project_id', projectId)
    .eq('external_id', externalId)
    .limit(1)
  return Array.isArray(data) && data.length > 0
}

// ── Slack Web API helpers ────────────────────────────────────────────────────

async function slackFilesInfo(token: string, fileId: string): Promise<SlackFile | null> {
  const res = await fetchWithTimeout(
    `https://slack.com/api/files.info?file=${encodeURIComponent(fileId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const json = (await res.json()) as { ok?: boolean; error?: string; file?: SlackFile }
  if (!json.ok || !json.file) {
    log.warn('files.info failed', { fileId, error: json.error ?? `http_${res.status}` })
    return null
  }
  return json.file
}

export interface DownloadedSlackAudio {
  bytes: Uint8Array
  mime: string
  filename: string
  durationSec?: number
}

/**
 * Pick the rendition our STT layer can consume. The original is preferred
 * when its container is natively supported; otherwise Slack's AAC rendition
 * (present on clips) is used. Files are capped at 25 MB.
 */
export function pickSlackDownload(file: SlackFile): { url: string; mime: string; filename: string } | null {
  const ft = (file.filetype ?? '').toLowerCase()
  const original = file.url_private_download ?? file.url_private ?? null
  const baseName = (file.name ?? file.title ?? file.id ?? 'clip').replace(/[^\w.-]+/g, '_')
  if (original && (STT_NATIVE_FILETYPES.has(ft) || !file.aac)) {
    const mime = file.mimetype && file.mimetype.startsWith('audio/') ? file.mimetype : mimeForFiletype(ft)
    const filename = /\.[a-z0-9]{2,4}$/i.test(baseName) ? baseName : `${baseName}.${ft || 'm4a'}`
    return { url: original, mime, filename }
  }
  if (file.aac) {
    return { url: file.aac, mime: 'audio/aac', filename: `${baseName.replace(/\.[a-z0-9]{2,4}$/i, '')}.aac` }
  }
  return null
}

function mimeForFiletype(ft: string): string {
  switch (ft) {
    case 'm4a':
    case 'mp4':
      return 'audio/mp4'
    case 'webm':
      return 'audio/webm'
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg'
    case 'mp3':
    case 'mpga':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'aac':
      return 'audio/aac'
    default:
      return 'application/octet-stream'
  }
}

export async function downloadSlackAudio(token: string, file: SlackFile): Promise<DownloadedSlackAudio> {
  if (typeof file.size === 'number' && file.size > MAX_SLACK_AUDIO_BYTES) {
    throw new Error(`clip too large (${file.size} bytes > ${MAX_SLACK_AUDIO_BYTES})`)
  }
  const pick = pickSlackDownload(file)
  if (!pick) throw new Error('no downloadable rendition on file object')

  const res = await fetchWithTimeout(
    pick.url,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' },
    DOWNLOAD_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(`download failed: http ${res.status}`)
  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  // Slack serves an HTML login page (200) when the token lacks files:read.
  if (ct.includes('text/html')) throw new Error('download returned HTML — bot token is missing the files:read scope')
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_SLACK_AUDIO_BYTES) throw new Error(`clip too large (${declared} bytes)`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_SLACK_AUDIO_BYTES) throw new Error(`clip too large (${bytes.byteLength} bytes)`)
  if (bytes.byteLength === 0) throw new Error('download returned an empty body')

  return {
    bytes,
    mime: pick.mime,
    filename: pick.filename,
    durationSec: typeof file.duration_ms === 'number' ? Math.round(file.duration_ms / 1000) : undefined,
  }
}

// ── Event processing ─────────────────────────────────────────────────────────

export interface SlackAudioIntakeInput {
  projectId: string
  file: SlackFile
  channelId: string
  /** Message ts to thread the reply under (undefined → top-level post). */
  threadTs?: string
  slackUserId?: string
  /** Pre-resolved bot token (file_shared path already fetched files.info). */
  botToken?: string | null
}

async function postThreaded(
  db: SupabaseClient,
  projectId: string,
  channelId: string,
  threadTs: string | undefined,
  msg: { text: string; blocks?: unknown[] },
): Promise<void> {
  const res = await sendBotMessage({
    channel: channelId,
    threadTs: threadTs ?? null,
    text: msg.text,
    blocks: msg.blocks,
    db,
    projectId,
  })
  if (!res.ok) log.warn('voice reply post failed', { projectId, channelId, error: res.error })
}

/** Download one Slack audio file, ingest it, and reply in-thread. */
export async function ingestSlackAudioFile(
  db: SupabaseClient,
  input: SlackAudioIntakeInput,
  deps: SlackVoiceDeps,
): Promise<VoiceIngestResult | null> {
  const fileId = input.file.id
  if (!fileId) return null
  const externalId = `slack:file:${fileId}`
  if (await voiceSessionExists(db, input.projectId, externalId)) {
    log.info('slack clip already ingested', { projectId: input.projectId, fileId })
    return null
  }

  const token = input.botToken ?? (await resolveSlackBotToken(db, input.projectId))
  if (!token) {
    log.warn('no Slack bot token for project — cannot download clip', { projectId: input.projectId })
    return null
  }

  // Message events sometimes carry a trimmed file object; refetch when the
  // download URL is missing so we always work from the canonical shape.
  let file = input.file
  if (!file.url_private_download && !file.aac) {
    const full = await slackFilesInfo(token, fileId)
    if (!full) return null
    file = full
  }

  let audio: DownloadedSlackAudio
  try {
    audio = await downloadSlackAudio(token, file)
  } catch (err) {
    log.error('slack clip download failed', { projectId: input.projectId, fileId, err: String(err) })
    await postThreaded(db, input.projectId, input.channelId, input.threadTs, {
      text: `:x: I couldn't fetch that clip — ${escapeSlackText(String((err as Error).message ?? err))}`,
    })
    return null
  }

  const result = await deps.ingestVoice(db, {
    projectId: input.projectId,
    source: 'slack',
    externalId,
    audio,
    channel: {
      slackChannelId: input.channelId,
      slackThreadTs: input.threadTs,
      slackUserId: input.slackUserId,
    },
  })

  const msg = buildVoiceResultMessage(result)
  if (msg) await postThreaded(db, input.projectId, input.channelId, input.threadTs, msg)
  return result
}

function threadTsFromShares(file: SlackFile, channelId: string): string | undefined {
  const entries = file.shares?.public?.[channelId] ?? file.shares?.private?.[channelId]
  const first = entries?.[0]
  return first?.thread_ts ?? first?.ts
}

/**
 * Handle one `event_callback` envelope (runs after the 200 has been sent).
 * Exported for tests; `sleep` is injectable so the file_shared stagger does
 * not slow the suite.
 */
export async function processSlackEventEnvelope(
  db: SupabaseClient,
  envelope: SlackEventEnvelope,
  deps: SlackVoiceDeps,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const event = envelope.event
  if (!event || typeof event.type !== 'string') return
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const botUserIds = new Set(
    (envelope.authorizations ?? []).filter((a) => a.is_bot && a.user_id).map((a) => a.user_id as string),
  )

  if (event.type === 'message') {
    const msg = event as SlackMessageEvent
    if (msg.subtype && !MESSAGE_SUBTYPES_WITH_FILES.has(msg.subtype)) return
    if (msg.bot_id) return
    if (msg.user && botUserIds.has(msg.user)) return
    if (!msg.channel) return
    const audioFiles = (msg.files ?? []).filter(isSlackAudioFile)
    if (audioFiles.length === 0) return

    const project = await resolveSlackProject(db, { teamId: envelope.team_id ?? msg.team, channelId: msg.channel })
    if (!project) {
      log.info('slack message from unconnected workspace', { teamId: envelope.team_id, channel: msg.channel })
      return
    }
    for (const file of audioFiles) {
      await ingestSlackAudioFile(
        db,
        {
          projectId: project.projectId,
          file,
          channelId: msg.channel,
          threadTs: msg.thread_ts ?? msg.ts,
          slackUserId: msg.user,
        },
        deps,
      )
    }
    return
  }

  if (event.type === 'file_shared') {
    const shared = event as SlackFileSharedEvent
    const fileId = shared.file_id ?? shared.file?.id
    if (!fileId || !shared.channel_id) return
    if (shared.user_id && botUserIds.has(shared.user_id)) return
    const project = await resolveSlackProject(db, { teamId: envelope.team_id, channelId: shared.channel_id })
    if (!project) return

    // Both events fire for one upload; let the message path claim it first.
    await sleep(FILE_SHARED_STAGGER_MS)
    if (await voiceSessionExists(db, project.projectId, `slack:file:${fileId}`)) return

    const token = await resolveSlackBotToken(db, project.projectId)
    if (!token) return
    const file = await slackFilesInfo(token, fileId)
    if (!file || !isSlackAudioFile(file)) return

    await ingestSlackAudioFile(
      db,
      {
        projectId: project.projectId,
        file,
        channelId: shared.channel_id,
        threadTs: threadTsFromShares(file, shared.channel_id),
        slackUserId: shared.user_id,
        botToken: token,
      },
      deps,
    )
  }
}

// ── Slash commands ───────────────────────────────────────────────────────────

interface ReportRow {
  id: string
  title: string | null
  summary: string | null
  description?: string | null
  status: string
  severity: string | null
  created_at?: string
}

function reportLabel(r: ReportRow): string {
  return escapeSlackText(truncate((r.title ?? r.summary ?? r.description ?? '(untitled)').replace(/\s+/g, ' '), 80))
}

async function listOpenReports(db: SupabaseClient, projectId: string, limit: number): Promise<ReportRow[]> {
  const { data } = await db
    .from('reports')
    .select('id, title, summary, description, status, severity, created_at')
    .eq('project_id', projectId)
    .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data as ReportRow[] | null) ?? []
}

/** Full UUID or a ≥ 6-char hex prefix matched against the project's recent reports. */
async function findProjectReport(
  db: SupabaseClient,
  projectId: string,
  idOrPrefix: string,
): Promise<{ ok: true; report: ReportRow } | { ok: false; message: string }> {
  const needle = idOrPrefix.trim().toLowerCase()
  if (UUID_RE.test(needle)) {
    const { data } = await db
      .from('reports')
      .select('id, title, summary, description, status, severity, created_at')
      .eq('project_id', projectId)
      .eq('id', needle)
      .maybeSingle()
    return data ? { ok: true, report: data as ReportRow } : { ok: false, message: 'No report with that id in this project.' }
  }
  if (!/^[0-9a-f]{6,}$/.test(needle)) {
    return { ok: false, message: 'Pass a report id (full UUID or at least 6 leading characters).' }
  }
  const { data } = await db
    .from('reports')
    .select('id, title, summary, description, status, severity, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)
  const matches = ((data as ReportRow[] | null) ?? []).filter((r) => r.id.toLowerCase().startsWith(needle))
  if (matches.length === 1) return { ok: true, report: matches[0] }
  if (matches.length === 0) return { ok: false, message: 'No recent report starts with that id.' }
  return { ok: false, message: `${matches.length} reports start with \`${escapeSlackText(needle)}\` — add more characters.` }
}

export interface SlashReply {
  response_type: 'ephemeral' | 'in_channel'
  text: string
  blocks?: unknown[]
  replace_original?: boolean
}

function eph(text: string, blocks?: unknown[]): SlashReply {
  return blocks ? { response_type: 'ephemeral', text, blocks } : { response_type: 'ephemeral', text }
}

/**
 * Synchronous subcommands (everything except `voice`). Exported for tests.
 */
export async function runMushiCommand(
  db: SupabaseClient,
  projectId: string,
  cmd: MushiCommand,
  form: Pick<SlashCommandForm, 'user_id'>,
): Promise<SlashReply> {
  switch (cmd.sub) {
    case 'help':
      return eph(MUSHI_HELP_TEXT)
    case 'usage':
      return eph(cmd.text)
    case 'list': {
      const rows = await listOpenReports(db, projectId, LIST_LIMIT)
      if (rows.length === 0) return eph('No open reports. :tada:')
      const lines = rows.map((r) => {
        const link = buildReportDeepLink(r.id, projectId)
        const id = link ? `<${link}|\`${r.id.slice(0, 8)}\`>` : `\`${r.id.slice(0, 8)}\``
        return `• ${id} *${escapeSlackText(r.severity ?? '?')}* [${escapeSlackText(r.status)}] ${reportLabel(r)}`
      })
      return eph(`*Open reports (latest ${rows.length}):*\n${lines.join('\n')}`)
    }
    case 'open': {
      const found = await findProjectReport(db, projectId, cmd.id)
      if (!found.ok) return eph(`:mag: ${found.message}`)
      const r = found.report
      const link = buildReportDeepLink(r.id, projectId)
      const body =
        `*${reportLabel(r)}* — [${escapeSlackText(r.status)}]` +
        (r.severity ? ` · ${escapeSlackText(r.severity)}` : '') +
        `\n${escapeSlackText(truncate((r.summary ?? r.description ?? '(no summary yet)').trim(), 600))}` +
        (link ? `\n<${link}|Open in console>` : `\n\`${r.id}\``)
      return eph(body)
    }
    case 'resolve': {
      const found = await findProjectReport(db, projectId, cmd.id)
      if (!found.ok) return eph(`:mag: ${found.message}`)
      const result = await applyReportStatusTransition(db, {
        reportId: found.report.id,
        requestedStatus: 'resolved',
        actor: { kind: 'slack', id: form.user_id },
      })
      if (!result.ok) return eph(`:x: Could not resolve — ${escapeSlackText(result.message)}`)
      return eph(`:white_check_mark: Resolved \`${found.report.id.slice(0, 8)}\` — ${reportLabel(found.report)}`)
    }
    case 'voice':
      // Never reached: the route defers voice work behind an ack.
      return eph(':hourglass_flowing_sand: Working on it…')
  }
}

/** Deferred `/mushi voice <text>` — ingest, then deliver via response_url. */
export async function runVoiceCommand(
  db: SupabaseClient,
  projectId: string,
  form: SlashCommandForm,
  text: string,
  deps: SlackVoiceDeps,
): Promise<VoiceIngestResult> {
  const result = await deps.ingestVoice(db, {
    projectId,
    source: 'slack',
    externalId: `slack:cmd:${form.trigger_id}`,
    transcript: text,
    channel: { slackChannelId: form.channel_id, slackUserId: form.user_id },
  })
  const msg = buildVoiceResultMessage(result) ?? { text: ':repeat: Already received that request.' }
  if (form.response_url) {
    await fetch(form.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: true, ...msg }),
    }).catch((err) => log.error('response_url POST failed', { err: String(err) }))
  }
  return result
}

export function parseSlashCommandForm(rawBody: string): SlashCommandForm {
  const p = new URLSearchParams(rawBody)
  return {
    command: p.get('command') ?? '',
    text: p.get('text') ?? '',
    user_id: p.get('user_id') ?? '',
    channel_id: p.get('channel_id') ?? '',
    team_id: p.get('team_id') ?? '',
    response_url: p.get('response_url') ?? '',
    trigger_id: p.get('trigger_id') ?? '',
  }
}

// ── Route wiring ─────────────────────────────────────────────────────────────

/** Keep the isolate alive for background work; falls back to fire-and-forget. */
function waitUntil(p: Promise<unknown>): void {
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') edgeRuntime.waitUntil(p)
}

type Ctx = Context<{ Variables: Variables }>

async function verifyOrReject(c: Ctx, rawBody: string): Promise<Response | null> {
  const secret = Deno.env.get('SLACK_SIGNING_SECRET')
  if (!secret) {
    log.error('SLACK_SIGNING_SECRET is not set')
    reportMessage('Slack signing secret missing', 'error', { tags: { source: 'slack-events' } })
    return c.json(
      { ok: false, error: { code: 'SERVER_MISCONFIGURED', message: 'Slack signing secret not configured' } },
      500,
    )
  }
  const verdict = await verifySlackRequest({
    signingSecret: secret,
    timestamp: c.req.header('x-slack-request-timestamp'),
    signature: c.req.header('x-slack-signature'),
    rawBody,
  })
  if (!verdict.ok) {
    log.warn('slack signature rejected', { reason: verdict.reason })
    return c.json({ ok: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid Slack signature' } }, 401)
  }
  return null
}

export function registerSlackEventsRoutesWith(app: Hono<{ Variables: Variables }>, deps: SlackVoiceDeps): void {
  // ── Events API ───────────────────────────────────────────────────────────
  app.post('/v1/webhooks/slack/events', async (c) => {
    const rawBody = await c.req.text()
    const rejected = await verifyOrReject(c, rawBody)
    if (rejected) return rejected

    let envelope: SlackEventEnvelope
    try {
      envelope = JSON.parse(rawBody) as SlackEventEnvelope
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_JSON', message: 'Body is not JSON' } }, 400)
    }

    if (envelope.type === 'url_verification') {
      return c.json({ challenge: envelope.challenge ?? '' })
    }
    if (envelope.type !== 'event_callback') {
      return c.json({ ok: true, data: { ignored: 'unsupported_type' } })
    }

    const retryNum = c.req.header('x-slack-retry-num')
    if (retryNum) {
      log.info('slack event retry', { eventId: envelope.event_id, retryNum, reason: c.req.header('x-slack-retry-reason') })
    }
    // Slack retries on any non-2xx or slow response; we always ack here and
    // rely on the session dedupe, so tell Slack not to bother retrying.
    c.header('X-Slack-No-Retry', '1')

    const db = getServiceClient()
    const work = processSlackEventEnvelope(db, envelope, deps).catch((err) => {
      log.error('slack event processing failed', { eventId: envelope.event_id, err: String(err) })
      reportError(err, { tags: { source: 'slack-events', eventType: envelope.event?.type ?? 'unknown' } })
    })
    waitUntil(work)
    return c.json({ ok: true })
  })

  // ── Slash commands ───────────────────────────────────────────────────────
  app.post('/v1/webhooks/slack/commands', async (c) => {
    const t0 = Date.now()
    const rawBody = await c.req.text()
    const form = parseSlashCommandForm(rawBody)

    const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('slack')
    const sourceIp =
      c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null
    const auditRow = await audit(c as never, rawBody, form.trigger_id || null)
    try {
      checkRateLimit(sourceIp)
      await checkReplay(auditRow.id, form.trigger_id || null)
    } catch (err) {
      if (err instanceof RateLimitError) {
        await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message)
        return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Rate limited' } }, 429)
      }
      if (err instanceof ReplayAttackError) {
        await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message)
        return c.json({ ok: false, error: { code: 'DUPLICATE', message: 'Duplicate delivery' } }, 409)
      }
      throw err
    }

    const rejected = await verifyOrReject(c, rawBody)
    if (rejected) {
      await auditRow.resolve('rejected_signature', rejected.status, Date.now() - t0, 'Signature rejected')
      return rejected
    }

    const db = getServiceClient()
    const project = await resolveSlackProject(db, { teamId: form.team_id, channelId: form.channel_id })
    if (!project) {
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'Workspace not connected')
      return c.json(
        eph(
          ':link: This Slack workspace is not connected to a Mushi project yet. Open the console → *Integrations → Slack* and click *Add to Slack*.',
        ),
      )
    }
    await auditRow.setProject(project.projectId).catch(() => {})

    const cmd = parseMushiCommand(form.text)
    if (cmd.sub === 'voice') {
      const work = runVoiceCommand(db, project.projectId, form, cmd.text, deps).catch((err) => {
        log.error('voice command failed', { projectId: project.projectId, err: String(err) })
        reportError(err, { tags: { source: 'slack-events', command: 'voice' } })
      })
      waitUntil(work)
      await auditRow.resolve('accepted', 200, Date.now() - t0)
      return c.json(eph(':studio_microphone: Got it — working out what you asked for…'))
    }

    const reply = await runMushiCommand(db, project.projectId, cmd, form)
    await auditRow.resolve('accepted', 200, Date.now() - t0)
    return c.json(reply)
  })
}
