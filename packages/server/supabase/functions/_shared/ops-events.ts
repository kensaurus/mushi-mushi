/**
 * FILE: packages/server/supabase/functions/_shared/ops-events.ts
 * PURPOSE: Record an Ops event and deliver it to the organization's Slack
 *          (docs/execplans/ops-hub-slack.md §1-§4).
 *
 *   recordOpsEvent   insert one event; a repeated dedupe_key returns the
 *                    stored one (a retried webhook posts once). The first
 *                    event of its thread in the same category becomes its
 *                    parent (Slack threads live in one channel).
 *   deliverOpsEvent  post it with the org's bot (chat.postMessage, ts kept),
 *                    as a reply under its parent; a resolve is broadcast and
 *                    edits the parent. No bot token: the category's incoming
 *                    webhook, else store only. A muted app is stored, not
 *                    posted. Never throws: a Slack failure is written to
 *                    slack_error and never fails the ingest.
 *   emitOpsEvent     what Mushi Mushi's own sources call (GitHub deploys,
 *                    Sentry, edge canaries): only for organizations with the
 *                    Slack bot switched on, PII redacted rather than refused,
 *                    run under waitUntil so the caller's webhook answers first.
 *   ackOpsEvent      Acknowledge (console or Slack button): set acked_*,
 *                    then ✅ on the message and "Seen by …" in its thread.
 *
 * Small and dependency-free apart from the logger, because `api` (Sentry
 * webhook) and webhooks-github-indexer import it.
 */

import { log as rootLog } from './logger.ts'
import {
  buildOpsMessage,
  buildResolvedParent,
  clampEvent,
  planThread,
  redactEventPii,
  type OpsCategory,
  type OpsEventInput,
  type OpsEventRow,
  type OpsMessageContext,
} from './ops-format.ts'
import { postSlackWebhook, slackApi, type SlackCallDeps } from './ops-slack.ts'

const log = rootLog.child('ops-hub')

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export const OPS_EVENT_COLUMNS =
  'id, organization_id, project_id, category, severity, kind, title, body, facts, url, amount_minor, currency, thread_key, dedupe_key, parent_id, occurred_at, source, slack_channel, slack_ts, slack_thread_ts, slack_error, acked_by, acked_at, created_at'

export interface OpsSettingsRow {
  organization_id: string
  enabled: boolean
  team_id: string | null
  bot_user_id: string | null
  bot_token_secret_id: string | null
  signing_secret_id: string | null
  payments_webhook_secret_id: string | null
  releases_webhook_secret_id: string | null
  alerts_webhook_secret_id: string | null
  channel_payments: string | null
  channel_releases: string | null
  channel_alerts: string | null
  command: string
  icon_base_url: string | null
  updated_at?: string
}

export const OPS_SETTINGS_COLUMNS =
  'organization_id, enabled, team_id, bot_user_id, bot_token_secret_id, signing_secret_id, payments_webhook_secret_id, releases_webhook_secret_id, alerts_webhook_secret_id, channel_payments, channel_releases, channel_alerts, command, icon_base_url, updated_at'

/** PostgREST / Postgres "relation does not exist": the migration is not applied yet. */
export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === '42P01' || err.code === 'PGRST205' || /does not exist|schema cache/i.test(err.message ?? '')
}

export type SettingsRead = { ok: true; row: OpsSettingsRow | null } | { ok: false; missing: boolean; error: string }

export async function readOpsSettings(db: Db, organizationId: string): Promise<SettingsRead> {
  const { data, error } = await db.from('ops_slack_settings').select(OPS_SETTINGS_COLUMNS).eq('organization_id', organizationId).maybeSingle()
  if (error) return { ok: false, missing: isMissingRelation(error), error: String(error.message ?? 'read failed') }
  return { ok: true, row: (data as OpsSettingsRow | null) ?? null }
}

/** A Vault secret by id; null when unset or unreadable (callers fail closed). */
export async function readVaultSecret(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) return null
  return typeof data === 'string' && data.length > 0 ? data : null
}

export function channelFor(row: OpsSettingsRow, category: OpsCategory): string | null {
  return category === 'payments' ? row.channel_payments : category === 'releases' ? row.channel_releases : row.channel_alerts
}

function webhookSecretFor(row: OpsSettingsRow, category: OpsCategory): string | null {
  return category === 'payments' ? row.payments_webhook_secret_id : category === 'releases' ? row.releases_webhook_secret_id : row.alerts_webhook_secret_id
}

export interface OpsDeps extends SlackCallDeps {
  now?: () => Date
  /** The console's base URL (ADMIN_BASE_URL); read lazily from the env when omitted. */
  adminBaseUrl?: string | null
}

function adminBase(deps: OpsDeps): string | null {
  if (deps.adminBaseUrl !== undefined) return deps.adminBaseUrl
  try {
    const raw = (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get('ADMIN_BASE_URL')
    return raw ? raw.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

/** The console feed, opened on this app. */
export function opsConsoleUrl(base: string | null, e: Pick<OpsEventRow, 'id' | 'project_id'>): string | null {
  if (!base) return null
  const q = new URLSearchParams({ event: e.id })
  if (e.project_id) q.set('project', e.project_id)
  return `${base}/ops?${q.toString()}`
}

// ── record ──────────────────────────────────────────────────────────────────

export type RecordResult =
  | { status: 'created'; event: OpsEventRow }
  | { status: 'duplicate'; event: OpsEventRow }
  | { status: 'error'; missing: boolean; error: string }

/** The first event of this thread in this org and category, if any. */
async function findThreadParent(db: Db, organizationId: string, threadKey: string, category: OpsCategory): Promise<OpsEventRow | null> {
  const { data, error } = await db
    .from('ops_events')
    .select(OPS_EVENT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('thread_key', threadKey)
    .eq('category', category)
    .is('parent_id', null)
    .order('occurred_at', { ascending: true })
    .limit(1)
  if (error) return null
  return ((data as OpsEventRow[] | null) ?? [])[0] ?? null
}

export async function recordOpsEvent(
  db: Db,
  args: { organizationId: string; projectId: string | null; input: OpsEventInput },
  deps: OpsDeps = {},
): Promise<RecordResult> {
  const e = clampEvent(args.input)
  const now = (deps.now ?? (() => new Date()))()
  const parent = e.threadKey ? await findThreadParent(db, args.organizationId, e.threadKey, e.category) : null
  const row = {
    organization_id: args.organizationId,
    project_id: args.projectId,
    category: e.category,
    severity: e.severity,
    kind: e.kind,
    title: e.title,
    body: e.body ?? null,
    facts: e.facts ?? [],
    url: e.url ?? null,
    amount_minor: e.amountMinor ?? null,
    currency: e.amountMinor != null ? (e.currency ?? null) : null,
    thread_key: e.threadKey ?? null,
    dedupe_key: e.dedupeKey ?? null,
    parent_id: parent?.id ?? null,
    occurred_at: e.occurredAt ?? now.toISOString(),
    source: e.source ?? 'app',
  }
  const { data, error } = await db.from('ops_events').insert(row).select(OPS_EVENT_COLUMNS).single()
  if (!error && data) return { status: 'created', event: data as OpsEventRow }
  if (error?.code === '23505' && row.dedupe_key) {
    const { data: existing } = await db
      .from('ops_events')
      .select(OPS_EVENT_COLUMNS)
      .eq('organization_id', args.organizationId)
      .eq('dedupe_key', row.dedupe_key)
      .maybeSingle()
    if (existing) return { status: 'duplicate', event: existing as OpsEventRow }
  }
  return { status: 'error', missing: isMissingRelation(error), error: String(error?.message ?? 'insert failed').slice(0, 200) }
}

// ── deliver ─────────────────────────────────────────────────────────────────

export type DeliverResult =
  | { delivered: true; via: 'bot' | 'webhook'; ts?: string }
  | { delivered: false; reason: 'slack_off' | 'muted' | 'no_channel' | 'failed'; error?: string }

interface ProjectLook {
  name: string | null
  slug: string | null
  icon_url: string | null
}

async function projectLook(db: Db, projectId: string | null): Promise<ProjectLook | null> {
  if (!projectId) return null
  const { data } = await db.from('projects').select('name, slug, icon_url').eq('id', projectId).maybeSingle()
  return (data as ProjectLook | null) ?? null
}

/** Name in lowercase, as the team writes it, and the app's icon. */
export function messageContext(project: ProjectLook | null, settings: Pick<OpsSettingsRow, 'icon_base_url'> | null, consoleUrl: string | null): OpsMessageContext {
  const iconFromBase = settings?.icon_base_url && project?.slug ? `${settings.icon_base_url.replace(/\/+$/, '')}/${encodeURIComponent(project.slug)}.png` : null
  const icon = project?.icon_url && /^https:\/\//.test(project.icon_url) ? project.icon_url : iconFromBase
  return { appName: project?.name ? project.name.toLowerCase() : null, iconUrl: icon, consoleUrl }
}

async function setSlackState(db: Db, id: string, patch: Partial<Pick<OpsEventRow, 'slack_channel' | 'slack_ts' | 'slack_thread_ts' | 'slack_error'>>): Promise<void> {
  const { error } = await db.from('ops_events').update(patch).eq('id', id)
  if (error) log.warn('ops event slack state not saved', { id, err: String(error.message ?? '') })
}

export async function isProjectMuted(db: Db, organizationId: string, projectId: string | null, now: Date): Promise<string | null> {
  if (!projectId) return null
  const { data } = await db.from('ops_mutes').select('until').eq('organization_id', organizationId).eq('project_id', projectId).maybeSingle()
  const until = (data as { until?: string } | null)?.until
  return until && Date.parse(until) > now.getTime() ? until : null
}

export async function deliverOpsEvent(db: Db, event: OpsEventRow, deps: OpsDeps = {}): Promise<DeliverResult> {
  try {
    const now = (deps.now ?? (() => new Date()))()
    const read = await readOpsSettings(db, event.organization_id)
    const settings = read.ok ? read.row : null
    if (!settings?.enabled) return { delivered: false, reason: 'slack_off' }

    const mutedUntil = await isProjectMuted(db, event.organization_id, event.project_id, now)
    if (mutedUntil) {
      await setSlackState(db, event.id, { slack_error: `muted until ${mutedUntil.slice(0, 16).replace('T', ' ')} UTC` })
      return { delivered: false, reason: 'muted' }
    }

    const ctx = messageContext(await projectLook(db, event.project_id), settings, opsConsoleUrl(adminBase(deps), event))
    const channel = channelFor(settings, event.category)
    const token = await readVaultSecret(db, settings.bot_token_secret_id)

    if (token && channel) {
      let parent: OpsEventRow | null = null
      if (event.parent_id) {
        const { data } = await db.from('ops_events').select(OPS_EVENT_COLUMNS).eq('id', event.parent_id).maybeSingle()
        parent = (data as OpsEventRow | null) ?? null
      }
      const plan = planThread(event, parent, channel)
      const msg = buildOpsMessage(event, ctx)
      const posted = await slackApi<{ ts?: string; channel?: string }>(
        token,
        'chat.postMessage',
        {
          channel,
          text: msg.text,
          blocks: msg.blocks,
          unfurl_links: false,
          unfurl_media: false,
          ...(plan.threadTs ? { thread_ts: plan.threadTs } : {}),
          ...(plan.broadcast ? { reply_broadcast: true } : {}),
        },
        deps,
      )
      if (!posted.ok) {
        await setSlackState(db, event.id, { slack_channel: channel, slack_error: posted.error })
        return { delivered: false, reason: 'failed', error: posted.error }
      }
      await setSlackState(db, event.id, {
        slack_channel: channel,
        slack_ts: typeof posted.ts === 'string' ? posted.ts : null,
        slack_thread_ts: plan.threadTs,
        slack_error: null,
      })
      if (plan.updateParent && parent?.slack_ts && parent.slack_channel) {
        const edit = buildResolvedParent(parent, event, messageContext(await projectLook(db, parent.project_id), settings, opsConsoleUrl(adminBase(deps), parent)))
        const updated = await slackApi(token, 'chat.update', { channel: parent.slack_channel, ts: parent.slack_ts, text: edit.text, blocks: edit.blocks }, deps)
        if (!updated.ok) log.warn('ops parent edit failed', { id: parent.id, err: updated.error })
      }
      return { delivered: true, via: 'bot', ts: typeof posted.ts === 'string' ? posted.ts : undefined }
    }

    const hookUrl = await readVaultSecret(db, webhookSecretFor(settings, event.category))
    if (hookUrl) {
      // An incoming webhook takes no button clicks: keep only the link buttons.
      const msg = buildOpsMessage(event, ctx)
      const blocks = msg.blocks.flatMap((b) => {
        const block = b as { type?: string; elements?: Array<{ url?: string }> }
        if (block.type !== 'actions') return [block]
        const links = (block.elements ?? []).filter((el) => typeof el.url === 'string')
        return links.length ? [{ ...block, elements: links }] : []
      })
      const sent = await postSlackWebhook(hookUrl, { text: msg.text, blocks }, deps)
      if (!sent.ok) {
        await setSlackState(db, event.id, { slack_channel: 'webhook', slack_error: sent.error })
        return { delivered: false, reason: 'failed', error: sent.error }
      }
      await setSlackState(db, event.id, { slack_channel: 'webhook', slack_error: null })
      return { delivered: true, via: 'webhook' }
    }

    const why = !channel ? `no ${event.category} channel set` : 'no bot token or webhook set'
    await setSlackState(db, event.id, { slack_error: why })
    return { delivered: false, reason: 'no_channel', error: why }
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 200)
    log.error('ops delivery threw', { id: event.id, err: msg })
    await setSlackState(db, event.id, { slack_error: msg.slice(0, 300) }).catch(() => {})
    return { delivered: false, reason: 'failed', error: msg }
  }
}

// ── Mushi Mushi's own sources ───────────────────────────────────────────────

/** Keep the isolate alive for background work; without EdgeRuntime the promise just runs. */
export function runInBackground(p: Promise<unknown>): void {
  const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (edge && typeof edge.waitUntil === 'function') edge.waitUntil(p)
}

/**
 * Record and deliver an event from one of Mushi Mushi's own sources, for the
 * project's organization, only when its Slack bot is switched on. Never throws.
 */
export interface EmitArgs {
  projectId: string
  input: OpsEventInput
  /**
   * Only record when the thread's latest event in this category is still
   * open (not a resolve). A "back up" or "deploy succeeded" resolve with no
   * incident before it would otherwise post "✅ fixed" on every good run.
   */
  requireOpenThread?: boolean
}

/** True when the thread's latest event in this org and category exists and is not a resolve. */
export async function threadIsOpen(db: Db, organizationId: string, threadKey: string, category: OpsCategory): Promise<boolean> {
  const { data, error } = await db
    .from('ops_events')
    .select('severity')
    .eq('organization_id', organizationId)
    .eq('thread_key', threadKey)
    .eq('category', category)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return false
  const last = ((data as Array<{ severity: string }> | null) ?? [])[0]
  return Boolean(last && last.severity !== 'resolved')
}

export async function emitOpsEvent(db: Db, args: EmitArgs, deps: OpsDeps = {}): Promise<RecordResult['status'] | 'skipped'> {
  try {
    const { data: project, error } = await db.from('projects').select('organization_id').eq('id', args.projectId).maybeSingle()
    const orgId = (project as { organization_id?: string | null } | null)?.organization_id
    if (error || !orgId) return 'skipped'
    const read = await readOpsSettings(db, orgId)
    if (!read.ok || !read.row?.enabled) return 'skipped'
    if (args.requireOpenThread && (!args.input.threadKey || !(await threadIsOpen(db, orgId, args.input.threadKey, args.input.category)))) return 'skipped'
    const recorded = await recordOpsEvent(db, { organizationId: orgId, projectId: args.projectId, input: redactEventPii(args.input) }, deps)
    if (recorded.status === 'created') await deliverOpsEvent(db, recorded.event, deps)
    if (recorded.status === 'error') log.warn('ops source event not stored', { projectId: args.projectId, kind: args.input.kind, err: recorded.error })
    return recorded.status
  } catch (err) {
    log.warn('ops source event threw', { projectId: args.projectId, kind: args.input.kind, err: String(err).slice(0, 200) })
    return 'skipped'
  }
}

/** emitOpsEvent under waitUntil: the caller's webhook or cron answers first. */
export function scheduleOpsEvent(db: Db, args: EmitArgs, deps: OpsDeps = {}): Promise<unknown> {
  const p = emitOpsEvent(db, args, deps)
  runInBackground(p)
  return p
}

// ── acknowledge ─────────────────────────────────────────────────────────────

export interface AckActor {
  /** Stored in acked_by: `slack:U123` or `console`. Never a name or an email. */
  id: string
  /** How the thread reply names them: a Slack mention, or "someone in Mushi Mushi". */
  mention: string
}

/** Set acked_* once; then ✅ on the Slack message and a "Seen by" reply. */
export async function ackOpsEvent(db: Db, event: OpsEventRow, actor: AckActor, deps: OpsDeps = {}): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const now = (deps.now ?? (() => new Date()))()
  if (event.acked_at) return { ok: true, already: true }
  const { data, error } = await db
    .from('ops_events')
    .update({ acked_by: actor.id.slice(0, 120), acked_at: now.toISOString() })
    .eq('id', event.id)
    .is('acked_at', null)
    .select('id')
  if (error) return { ok: false, error: String(error.message ?? 'update failed') }
  if (!data || (data as unknown[]).length === 0) return { ok: true, already: true }
  if (event.slack_ts && event.slack_channel && event.slack_channel !== 'webhook') {
    const read = await readOpsSettings(db, event.organization_id)
    const token = read.ok && read.row ? await readVaultSecret(db, read.row.bot_token_secret_id) : null
    if (token) {
      const react = await slackApi(token, 'reactions.add', { channel: event.slack_channel, timestamp: event.slack_ts, name: 'white_check_mark' }, deps)
      if (!react.ok && react.error !== 'already_reacted') log.warn('ops ack reaction failed', { id: event.id, err: react.error })
      const reply = await slackApi(token, 'chat.postMessage', { channel: event.slack_channel, thread_ts: event.slack_thread_ts ?? event.slack_ts, text: `Seen by ${actor.mention}` }, deps)
      if (!reply.ok) log.warn('ops ack reply failed', { id: event.id, err: reply.error })
    }
  }
  return { ok: true, already: false }
}

/** Mute an app's Slack messages until `until` (events are still stored). */
export async function muteProject(db: Db, args: { organizationId: string; projectId: string; until: Date; by: string }): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from('ops_mutes')
    .upsert({ organization_id: args.organizationId, project_id: args.projectId, until: args.until.toISOString(), muted_by: args.by.slice(0, 120) }, { onConflict: 'organization_id,project_id' })
  return error ? { ok: false, error: String(error.message ?? 'mute failed') } : { ok: true }
}
