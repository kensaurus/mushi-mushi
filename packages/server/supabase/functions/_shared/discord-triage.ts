/**
 * FILE: _shared/discord-triage.ts
 * PURPOSE: Centralised, operator-side Discord triage feed. Every kensaurus app
 *          embeds the Mushi SDK with its own MUSHI_PROJECT_ID; this module
 *          funnels the notable reports from ALL of them into one Discord
 *          channel so a human can triage and reply in one place.
 *
 * NOT the per-project path. `_shared/discord.ts` + `project_settings.
 * discord_webhook_url` remain the customer-facing, per-project team channel and
 * are untouched. This module is env-driven and cross-project: it is the
 * operator's firehose, exactly as `_shared/operator-notify.ts` is for
 * revenue events. Consequently it deliberately does NOT honour a project's
 * `notification_prefs` — a customer muting their own channel must not blind
 * the operator.
 *
 * MODES (first configured wins):
 *   webhook — MUSHI_DISCORD_WEBHOOK_URL (+ optional MUSHI_DISCORD_THREAD_ID,
 *             appended as ?thread_id=; webhooks can post into, but not
 *             create, threads).
 *   relay   — MUSHI_TRIAGE_RELAY_URL + MUSHI_TRIAGE_RELAY_TOKEN: POSTs
 *             {content, thread} with an `x-relay-token` header to a bot-token
 *             relay that holds the bot token for a private thread. Targets
 *             tsumagoi-kensaurus-sales-relay, which exists because the bot
 *             lacks MANAGE_WEBHOOKS on that channel so no plain webhook can
 *             be minted for it.
 *
 *             `thread` is load-bearing, not decorative: that relay routes
 *             `thread === 'support'` to DISCORD_SUPPORT_THREAD_ID and
 *             *anything else, including an absent field*, to the sales
 *             thread. Omitting it would file bug reports into #llm-sales.
 *             Defaults to 'support'; override via MUSHI_TRIAGE_RELAY_THREAD.
 * Nothing configured → silent no-op, so self-hosters and CI never post.
 *
 * GUARANTEES:
 *   - Fail-soft: never throws into the caller. Report ingest and
 *     classification must succeed even when Discord is down.
 *   - Hard 2s timeout via AbortController; the notifier can never extend
 *     classification latency by more than that, and callers fire-and-forget.
 *   - No PII: user identifiers are pseudonymised to 6 hex chars before they
 *     reach Discord. Never pass an email or a raw external user id.
 *   - Content truncated to Discord's practical 1900-char message budget.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const triageLog = log.child('discord-triage')

const DISCORD_HOST = 'discord.com'
const DISCORDAPP_HOST = 'discordapp.com'

/** Hard ceiling on the notify round-trip. Classification must not wait longer. */
const NOTIFY_TIMEOUT_MS = 2000

/** Discord's hard cap is 2000; leave headroom for the trailing truncation mark. */
const MAX_CONTENT_CHARS = 1900

/**
 * Report severities as produced by the Stage-1/Stage-2 classifiers. Matches the
 * `SEVERITY_RANK` maps in fast-filter and classify-report — this repo has no
 * `error`/`warn`/`info` levels for reports, so those are accepted only as
 * aliases (see `LEVEL_ALIASES`) to keep the env var readable.
 */
const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 }

/**
 * Log-style level names map onto report severities. `error` is the documented
 * default for MUSHI_DISCORD_MIN_LEVEL and resolves to `high`, so `low` and
 * `medium` chatter stays out of the triage channel.
 */
const LEVEL_ALIASES: Record<string, string> = {
  error: 'high',
  fatal: 'critical',
  warn: 'medium',
  warning: 'medium',
  info: 'low',
  debug: 'low',
}

const DEFAULT_MIN_LEVEL = 'error'

/**
 * Occurrence counts at which a recurring group is re-announced. A group is
 * announced on its first sighting and then only when its blast radius crosses
 * one of these, so a storm of duplicates costs at most a handful of messages.
 */
const ESCALATION_THRESHOLDS = [10, 100, 1000]

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\u{1F6A8}', // 🚨
  high: '❗',
  medium: '⚠️',
  low: '\u{1F41B}', // 🐛
}

function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim()
}

/**
 * Keep the isolate alive until `p` settles.
 *
 * Supabase tears an Edge Function isolate down once the handler's Response
 * resolves. A plain `void somePromise()` that outlives the Response is dropped
 * mid-flight with no error and no log — the notify simply never happens. That
 * matters here because a triage post is several round trips (group lookup,
 * blast radius, then the Discord fetch), unlike the single-fetch per-project
 * notifiers that mostly survive on luck.
 *
 * Same cast pattern as api/helpers.ts. Falls back to a bare `void` when
 * EdgeRuntime is absent, so local `supabase functions serve` still works.
 */
export function detachTriage(p: Promise<unknown>): void {
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(p)
    return
  }
  void p
}

/** True when either transport is configured. Callers can skip work when false. */
export function isTriageConfigured(): boolean {
  return Boolean(env('MUSHI_DISCORD_WEBHOOK_URL') || (env('MUSHI_TRIAGE_RELAY_URL') && env('MUSHI_TRIAGE_RELAY_TOKEN')))
}

/**
 * Resolved floor for the triage feed, as a `SEVERITY_RANK` value. Unknown env
 * values fall back to the default rather than silently disabling the filter —
 * a typo must not turn the channel into a firehose or a black hole.
 */
function minSeverityRank(): number {
  const raw = (env('MUSHI_DISCORD_MIN_LEVEL') || DEFAULT_MIN_LEVEL).toLowerCase()
  const normalised = LEVEL_ALIASES[raw] ?? raw
  const rank = SEVERITY_RANK[normalised]
  if (rank === undefined) {
    triageLog.warn('unknown MUSHI_DISCORD_MIN_LEVEL — falling back to default', {
      value: raw,
      fallback: DEFAULT_MIN_LEVEL,
    })
    return SEVERITY_RANK[LEVEL_ALIASES[DEFAULT_MIN_LEVEL]]
  }
  return rank
}

/** SHA-256 hex of `input`. Private per-module, matching end-user-identity.ts. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * First 6 hex chars of SHA-256(identifier) — a stable, non-reversible label so
 * "same user hit this twice" is visible in Discord without an email or user id
 * ever leaving the cluster. Already-hashed inputs (reporter_token_hash) are
 * simply shortened.
 */
export async function triagePseudonym(identifier: string | null | undefined): Promise<string | null> {
  const raw = (identifier ?? '').trim()
  if (!raw) return null
  return (await sha256Hex(raw)).slice(0, 6)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'invalid'
  }
}

function truncate(text: string): string {
  return text.length <= MAX_CONTENT_CHARS ? text : `${text.slice(0, MAX_CONTENT_CHARS - 1)}…`
}

/**
 * Post a raw line to the triage channel. Returns whether delivery succeeded so
 * callers that must tell a human "someone was paged" can. Never throws.
 */
export async function postTriageNotice(content: string): Promise<boolean> {
  const webhookUrl = env('MUSHI_DISCORD_WEBHOOK_URL')
  const threadId = env('MUSHI_DISCORD_THREAD_ID')
  const relayUrl = env('MUSHI_TRIAGE_RELAY_URL')
  const relayToken = env('MUSHI_TRIAGE_RELAY_TOKEN')

  let url: string
  let headers: Record<string, string>
  let transport: 'webhook' | 'relay'
  const payload: Record<string, unknown> = { content: truncate(content) }

  if (webhookUrl) {
    const host = safeHost(webhookUrl)
    // Compare the parsed host, not a substring: `includes('discord.com')` also
    // matches hostile hosts like `discord.com.evil.test`.
    if (host !== DISCORD_HOST && host !== DISCORDAPP_HOST) {
      triageLog.warn('discord_url_host_mismatch', { host })
    }
    url = threadId
      ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}thread_id=${encodeURIComponent(threadId)}`
      : webhookUrl
    headers = { 'Content-Type': 'application/json' }
    transport = 'webhook'
  } else if (relayUrl && relayToken) {
    url = relayUrl
    headers = { 'Content-Type': 'application/json', 'x-relay-token': relayToken }
    // Must be sent explicitly — the relay treats an absent `thread` as sales.
    payload.thread = env('MUSHI_TRIAGE_RELAY_THREAD') || 'support'
    transport = 'relay'
  } else {
    return false
  }

  const body = JSON.stringify(payload)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS)
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      if (!res.ok) {
        triageLog.warn('triage post failed', { transport, status: res.status })
        return false
      }
      return true
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    // Includes the AbortError from the 2s timeout. Non-fatal by construction.
    triageLog.warn('triage post threw (non-fatal)', {
      transport,
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export interface TriageNotice {
  /** Report severity: critical | high | medium | low. */
  severity?: string | null
  /** Classifier category (bug, slow, visual, …). */
  category?: string | null
  /** `projects.name` — which kensaurus app this came from. */
  projectName?: string | null
  /** One-line classifier summary. Only the first line is posted. */
  summary?: string | null
  /** Resolved component, when Stage 2 identified one. */
  component?: string | null
  reportId: string
  /**
   * Raw user identifier — pseudonymised here before it reaches Discord.
   * Pass `end_user_id`, `reporter_user_id`, or `reporter_token_hash`.
   */
  userIdentifier?: string | null
  /** Total reports in this dedup group, when it is a recurring issue. */
  occurrenceCount?: number | null
  /** Set when this post is an escalation rather than a first sighting. */
  escalation?: boolean
}

/** Deep link into the console for this report, when ADMIN_BASE_URL is set. */
function reportUrl(reportId: string): string | null {
  const adminBase = env('ADMIN_BASE_URL').replace(/\/$/, '')
  return adminBase ? `${adminBase}/reports/${encodeURIComponent(reportId)}` : null
}

/** Collapse a multi-line summary to its first meaningful line. */
function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

/**
 * Post one compact triage line for a report. Applies the severity floor, so a
 * caller can invoke this unconditionally. Fire-and-forget: callers should not
 * await this on the request path.
 */
export async function notifyTriage(notice: TriageNotice): Promise<boolean> {
  if (!isTriageConfigured()) return false

  const severity = (notice.severity ?? 'low').toLowerCase()
  const rank = SEVERITY_RANK[severity] ?? 0
  if (rank < minSeverityRank()) return false

  try {
    const pseudonym = await triagePseudonym(notice.userIdentifier)
    const emoji = SEVERITY_EMOJI[severity] ?? SEVERITY_EMOJI.low
    const app = notice.projectName?.trim() || 'unknown app'
    const category = notice.category?.trim() || 'other'
    const summary = firstLine(notice.summary ?? '') || `report ${notice.reportId.slice(0, 8)}…`

    const parts: string[] = [
      `${emoji} **${severity}** · \`${app}\` · ${category}`,
      summary,
    ]

    const meta: string[] = []
    if (notice.component) meta.push(`component: ${notice.component}`)
    if (pseudonym) meta.push(`user: \`${pseudonym}\``)
    if (notice.occurrenceCount && notice.occurrenceCount > 1) {
      meta.push(`${notice.escalation ? 'now ' : ''}×${notice.occurrenceCount}`)
    }
    if (meta.length) parts.push(meta.join(' · '))

    const url = reportUrl(notice.reportId)
    parts.push(url ?? `report id: \`${notice.reportId}\``)

    return await postTriageNotice(parts.join('\n'))
  } catch (err) {
    triageLog.warn('notifyTriage threw (non-fatal)', {
      reportId: notice.reportId,
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export interface TriageDedupeVerdict {
  notify: boolean
  /** Total reports sharing this fingerprint, when the group is known. */
  occurrenceCount: number | null
  /** True when this is a re-announcement at a threshold, not a first sighting. */
  escalation: boolean
}

/**
 * Decide whether a report is worth a triage post given its dedup group.
 *
 * Grouping is done by the pgvector similarity pass, which runs fire-and-forget
 * during Stage 1 — so `report_group_id` is frequently still null when a brand
 * new report reaches a notify site. That is the correct default: an ungrouped
 * report is a first sighting and gets announced.
 *
 * For a grouped report the true blast radius comes from the
 * `report_group_blast_radius` RPC (the same source /v1/admin/reports uses);
 * `report_groups.report_count` is only ever set to `similar.length + 1` with
 * `similar` capped at 3, so it is not a running total.
 *
 * The canonical check closes a narrow race. When two similar reports arrive
 * close together, the second one's grouping pass backfills a group id onto the
 * FIRST report — which may land before the first report's own notify reads it.
 * Counting alone would then see 2 and suppress both, and the issue would go
 * unannounced until the ×10 escalation. `canonical_report_id` is the earliest
 * member, so treating it as a first sighting keeps that announcement.
 *
 * Never throws — on any DB failure it falls back to notifying, because a
 * missed triage line is worse than a duplicate one.
 */
export async function evaluateTriageDedupe(
  db: SupabaseClient,
  groupId: string | null | undefined,
  reportId?: string,
): Promise<TriageDedupeVerdict> {
  if (!groupId) return { notify: true, occurrenceCount: null, escalation: false }

  try {
    const [{ data, error }, { data: group }] = await Promise.all([
      db.rpc('report_group_blast_radius', { p_group_ids: [groupId] }),
      db.from('report_groups').select('canonical_report_id').eq('id', groupId).maybeSingle(),
    ])
    if (error) throw new Error(error.message)

    const row = (data as { report_group_id: string; report_count: number }[] | null)?.[0]
    const count = Number(row?.report_count ?? 0)

    // 0 or 1 means this report is the group's first member we can see.
    if (count <= 1) return { notify: true, occurrenceCount: count || 1, escalation: false }

    const canonicalId = (group as { canonical_report_id?: string | null } | null)?.canonical_report_id
    if (reportId && canonicalId && canonicalId === reportId) {
      return { notify: true, occurrenceCount: count, escalation: false }
    }

    // Escalate in a WINDOW past each threshold, not on exact equality: dedup
    // batches make the count jump (8 → 14 skips 10 entirely), so
    // `.includes(count)` silently missed most threshold crossings
    // (2026-08-16 audit P2-1). The +5 window bounds re-notification spam
    // while catching bursty crossings; a per-group last-notified-count column
    // would be exact but isn't worth the migration yet.
    if (ESCALATION_THRESHOLDS.some((t) => count >= t && count <= t + 5)) {
      return { notify: true, occurrenceCount: count, escalation: true }
    }
    return { notify: false, occurrenceCount: count, escalation: false }
  } catch (err) {
    triageLog.warn('blast radius lookup failed — notifying anyway', {
      groupId,
      err: err instanceof Error ? err.message : String(err),
    })
    return { notify: true, occurrenceCount: null, escalation: false }
  }
}

/**
 * Convenience wrapper: resolve the dedup verdict, then post if warranted.
 * Returns whether a message was delivered. Never throws.
 */
export async function notifyTriageDeduped(
  db: SupabaseClient,
  groupId: string | null | undefined,
  notice: Omit<TriageNotice, 'occurrenceCount' | 'escalation'>,
): Promise<boolean> {
  if (!isTriageConfigured()) return false
  const verdict = await evaluateTriageDedupe(db, groupId, notice.reportId)
  if (!verdict.notify) return false
  return await notifyTriage({
    ...notice,
    occurrenceCount: verdict.occurrenceCount,
    escalation: verdict.escalation,
  })
}

declare const Deno: { env: { get(name: string): string | undefined } }
