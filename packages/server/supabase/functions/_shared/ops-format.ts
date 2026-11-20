/**
 * FILE: packages/server/supabase/functions/_shared/ops-format.ts
 * PURPOSE: The pure half of the Ops hub (docs/execplans/ops-hub-slack.md):
 *
 *   - the PII guard (an app's event must not carry an email or a phone
 *     number; Mushi Mushi's own sources redact instead of refusing);
 *   - the Slack message for one event (app icon and name, emoji headline,
 *     body, facts, buttons), and the edit a parent gets when its incident
 *     resolves;
 *   - where a new event goes in Slack: a new message, a reply in its thread
 *     (repeats of one fingerprint within 24 h), or a resolve that replies in
 *     the thread and edits the parent's mark to ✅;
 *   - Sentry-style error messages as titles (cleanErrorTitle);
 *   - the slash command grammar.
 *
 * Dependency-free on purpose: `api` (Sentry webhook), webhooks-github-indexer
 * and site-watch-poll import the Ops emitter, which imports this, and `api`
 * sits at Supabase's deploy size limit. The vitest suite imports it directly.
 */

export const OPS_CATEGORIES = ['payments', 'releases', 'alerts'] as const
export type OpsCategory = (typeof OPS_CATEGORIES)[number]
export const OPS_SEVERITIES = ['info', 'warn', 'urgent', 'resolved'] as const
export type OpsSeverity = (typeof OPS_SEVERITIES)[number]
export type OpsSource = 'app' | 'github' | 'sentry' | 'uptime' | 'mushi'

export const OPS_TITLE_MAX = 150
export const OPS_BODY_MAX = 600
export const OPS_FACTS_MAX = 8
export const OPS_FACT_LABEL_MAX = 40
export const OPS_FACT_VALUE_MAX = 200

export interface OpsFact {
  label: string
  value: string
}

/** What a sender (an app, or one of Mushi Mushi's sources) asks to record. */
export interface OpsEventInput {
  category: OpsCategory
  severity: OpsSeverity
  kind: string
  title: string
  body?: string | null
  facts?: OpsFact[]
  url?: string | null
  amountMinor?: number | null
  currency?: string | null
  threadKey?: string | null
  dedupeKey?: string | null
  occurredAt?: string | null
  source?: OpsSource
}

/** The stored row, as the delivery and the console read it. */
export interface OpsEventRow {
  id: string
  organization_id: string
  project_id: string | null
  category: OpsCategory
  severity: OpsSeverity
  kind: string
  title: string
  body: string | null
  facts: OpsFact[]
  url: string | null
  amount_minor: number | null
  currency: string | null
  thread_key: string | null
  dedupe_key: string | null
  parent_id: string | null
  occurred_at: string
  source: OpsSource
  slack_channel: string | null
  slack_ts: string | null
  slack_thread_ts: string | null
  slack_error: string | null
  acked_by: string | null
  acked_at: string | null
  created_at?: string
}

// ── PII guard ───────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})/gi
// International form: + then 8 to 15 digits with optional spaces, dots,
// hyphens and parentheses between them.
const INTL_PHONE_RE = /(?<![\w+])\+\d[\d\s().-]{6,22}\d(?![\w])/g
// Local forms: 090-1234-5678, 03 1234 5678, (555) 123-4567, 555.123.4567.
// Bounded on both sides by a non-word, non-hyphen character, so a run inside a
// UUID, a SHA or an invoice id never matches, and the last group needs 3-4
// digits, so an ISO date (2026-11-17) never matches.
const LOCAL_PHONE_RE = /(?<![\w.-])(?:\(\d{2,4}\)\s?|\d{2,4}[\s.-])\d{2,4}[\s.-]\d{3,4}(?![\w.-])/g

function digitCount(s: string): number {
  return s.replace(/\D/g, '').length
}

function phoneMatches(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(INTL_PHONE_RE)) {
    const n = digitCount(m[0])
    if (n >= 8 && n <= 15) out.push(m[0])
  }
  for (const m of text.matchAll(LOCAL_PHONE_RE)) {
    const n = digitCount(m[0])
    if (n >= 9 && n <= 12) out.push(m[0])
  }
  return out
}

/** 'email' or 'phone' when the text carries one, else null. */
export function findPii(text: string | null | undefined): 'email' | 'phone' | null {
  if (!text) return null
  EMAIL_RE.lastIndex = 0
  if (EMAIL_RE.test(text)) return 'email'
  return phoneMatches(text).length > 0 ? 'phone' : null
}

/** The first field of an event that carries PII, for a 422 that says where. */
export function findEventPii(input: Pick<OpsEventInput, 'title' | 'body' | 'facts'>): { field: string; kind: 'email' | 'phone' } | null {
  const fields: Array<[string, string | null | undefined]> = [
    ['title', input.title],
    ['body', input.body],
    ...(input.facts ?? []).flatMap((f, i): Array<[string, string]> => [
      [`facts[${i}].label`, f.label],
      [`facts[${i}].value`, f.value],
    ]),
  ]
  for (const [field, value] of fields) {
    const kind = findPii(value)
    if (kind) return { field, kind }
  }
  return null
}

/** An email becomes its domain (`@example.com`), a phone number `[phone]`. */
export function redactPii(text: string): string {
  let out = text.replace(EMAIL_RE, (_m, domain: string) => `@${domain}`)
  for (const p of phoneMatches(out)) out = out.split(p).join('[phone]')
  return out
}

/** Redact every text field of an event (Mushi Mushi's own sources). */
export function redactEventPii(input: OpsEventInput): OpsEventInput {
  return {
    ...input,
    title: redactPii(input.title),
    body: input.body ? redactPii(input.body) : input.body,
    facts: input.facts?.map((f) => ({ label: redactPii(f.label), value: redactPii(f.value) })),
  }
}

/** Trim every field to the stored bounds (a source never fails on length). */
export function clampEvent(input: OpsEventInput): OpsEventInput {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  return {
    ...input,
    title: cut(input.title.replace(/\s+/g, ' ').trim() || input.kind, OPS_TITLE_MAX),
    body: input.body ? cut(input.body.trim(), OPS_BODY_MAX) : null,
    facts: (input.facts ?? [])
      .filter((f) => f.label.trim() && f.value.trim())
      .slice(0, OPS_FACTS_MAX)
      .map((f) => ({ label: cut(f.label.trim(), OPS_FACT_LABEL_MAX), value: cut(f.value.trim(), OPS_FACT_VALUE_MAX) })),
    url: input.url && /^https:\/\//.test(input.url) ? input.url.slice(0, 2000) : null,
    threadKey: input.threadKey ? input.threadKey.slice(0, 200) : null,
    dedupeKey: input.dedupeKey ? input.dedupeKey.slice(0, 200) : null,
  }
}

// ── Money ───────────────────────────────────────────────────────────────────

/** Minor units → "¥12,000" / "$1,234.50". Unknown currencies fall back to "12.34 XYZ". */
export function formatMoney(amountMinor: number, currency: string): string {
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2
    return fmt.format(amountMinor / 10 ** digits)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`
  }
}

/** True for an event that takes money back (a refund or a chargeback). */
export function isRefundKind(kind: string): boolean {
  return /refund|chargeback|reversal/i.test(kind)
}

// ── Slack message ───────────────────────────────────────────────────────────

/** Escape the three characters Slack mrkdwn treats as control characters. */
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A glanceable mark: 💳 payment, ↩️ refund, ⚠️ warn, 🔴 urgent, 🚀 release, ✅ resolved, 🔔 other alert. */
export function opsEmoji(e: Pick<OpsEventInput, 'category' | 'severity' | 'kind'>): string {
  if (e.severity === 'resolved') return '✅'
  if (e.severity === 'urgent') return '🔴'
  if (e.severity === 'warn') return '⚠️'
  if (e.category === 'releases') return '🚀'
  if (e.category === 'payments') return isRefundKind(e.kind) ? '↩️' : '💳'
  return '🔔'
}

export interface OpsMessageContext {
  /** The app's name, lowercase, as the team writes it (`glot.it`). */
  appName: string | null
  /** https URL of the app's icon, if any. */
  iconUrl: string | null
  /** The console's Ops feed for this event, if ADMIN_BASE_URL is set. */
  consoleUrl: string | null
}

export const OPS_ACTION_ACK = 'ops_ack'
/** The legacy Mute 24h button (messages posted before 2026-11-20). Muted the whole app; now mutes the alert. */
export const OPS_ACTION_MUTE = 'ops_mute'
/** The ⋯ menu on an alert: "Open in Mushi Mushi" (a link) and "Mute this alert for 24 h" (`ops_mute:<event id>`). */
export const OPS_ACTION_MORE = 'ops_more'
/** The overflow option value that mutes one alert: `ops_mute:<event id>`. */
export const OPS_MUTE_OPTION_PREFIX = 'ops_mute:'

/** At most this many fields under the summary; the rest go in one context line. */
const OPS_FIELDS_MAX = 4
/** At most this many elements in the actions row. */
const OPS_ACTIONS_MAX = 3
/** Repeats of one fingerprint thread under the first post for this long. */
export const OPS_REPEAT_WINDOW_MS = 24 * 60 * 60_000

const CATEGORY_LABEL: Record<OpsCategory, string> = { payments: 'Payments', releases: 'Releases', alerts: 'Alerts' }

/** Every mark opsEmoji uses, so a title that already starts with one is not marked twice. */
const OPS_MARKS = ['✅', '🔴', '⚠️', '⚠', '🚀', '↩️', '↩', '💳', '🔔']

/**
 * The title without a leading mark the renderer adds itself (mushi-mushi's own
 * release posts arrived as "🚀 Admin console 0.1.700 is live" and rendered as
 * "🚀 🚀 …"). Never empty: an all-emoji title keeps its text.
 * @internal Exported for tests.
 */
/**
 * CI and release markers a PR title carries for the pipelines ("[skip ota]",
 * "[skip mobile]", "[skip ci]", "[skip release]", "[release:all]"). They steer
 * the deploy and mean nothing to a reader, so the post never shows them
 * (2026-11-20: "help her take photo web is live · fix(events): … [skip ota]").
 */
const CI_MARKERS = /\s*\[(?:skip[ -](?:ci|mobile|ota|release|actions|android|ios)|release:[^\]]*|no ci)\]/gi

export function stripLeadingMark(title: string): string {
  const unmarked = title.replace(CI_MARKERS, '').trim()
  if (unmarked && unmarked !== title.trim()) title = unmarked
  let t = title.trim()
  for (let i = 0; i < 3; i++) {
    const mark = OPS_MARKS.find((m) => t.startsWith(m))
    if (!mark) break
    t = t.slice(mark.length).replace(/^\uFE0F/, '').trimStart()
  }
  return t || title.trim()
}

/** The environment the sender verified (an `Environment` fact), else null. Never assumed. */
function eventEnvironment(e: Pick<OpsEventRow, 'facts'>): string | null {
  const f = (e.facts ?? []).find((x) => /^environment$/i.test(x.label.trim()))
  const v = f?.value.trim()
  return v && !/^(not set|unknown|none)$/i.test(v) ? v : null
}

/** A fact label as mrkdwn bold, minus the characters that would break the bold. */
function boldLabel(label: string): string {
  const clean = escapeMrkdwn(label.replace(/[*_~`]/g, '').trim()) || 'Detail'
  return `*${clean}*`
}

/** The amount first, then the sender's facts, minus the Environment the context line shows. */
function eventFacts(e: Pick<OpsEventRow, 'facts' | 'amount_minor' | 'currency' | 'kind'>): OpsFact[] {
  const out: OpsFact[] = []
  if (e.amount_minor != null && e.currency) {
    const sign = isRefundKind(e.kind) ? '−' : ''
    out.push({ label: 'Amount', value: `${sign}${formatMoney(Math.abs(e.amount_minor), e.currency)}` })
  }
  const env = eventEnvironment(e as Pick<OpsEventRow, 'facts'>)
  for (const f of e.facts ?? []) {
    // A verified environment is in the context line; "not set" stays a fact so nobody reads it as production.
    if (env && /^environment$/i.test(f.label.trim())) continue
    out.push(f)
  }
  return out
}

/** The facts line used by `/kensaurus` answers: `label: value · …`, the amount first. */
export function factsLine(e: Pick<OpsEventRow, 'facts' | 'amount_minor' | 'currency' | 'kind'>): string | null {
  const parts = eventFacts({ ...e, facts: e.facts ?? [] }).map((f) => `${boldLabel(f.label)}: ${escapeMrkdwn(f.value)}`)
  return parts.length ? parts.join('  ·  ').slice(0, 2900) : null
}

/** `<!date^…>`: Slack shows the reader's local time; the fallback is UTC. */
function slackTime(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return `<!date^${Math.floor(ms / 1000)}^{date_short_pretty} {time}|${shortUtc(iso)}>`
}

/** The top-level `text`: the news in one line, for the notification and the fallback. */
function opsNotificationText(e: Pick<OpsEventRow, 'category' | 'severity' | 'kind' | 'title' | 'facts'>, appName: string | null): string {
  const app = escapeMrkdwn(appName ?? 'mushi mushi')
  const env = e.category === 'alerts' ? eventEnvironment(e) : null
  return `${opsEmoji(e)} ${app}: ${escapeMrkdwn(stripLeadingMark(e.title))}${env ? ` (${escapeMrkdwn(env)})` : ''}`
}

function button(actionId: string, text: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { type: 'button', action_id: actionId, text: { type: 'plain_text', text, emoji: true }, ...extra }
}

/**
 * The actions row, at most three elements, by kind:
 *   - an open alert: Acknowledge, Open (the source), and a ⋯ menu with
 *     Open in Mushi Mushi and "Mute this alert for 24 h" (this alert's kind and
 *     fingerprint only: never the app, never payments or releases);
 *   - a release, a payment or a resolve: Open and Open in Mushi Mushi. Nothing
 *     to acknowledge, nothing to mute.
 */
function opsActions(e: Pick<OpsEventRow, 'id' | 'category' | 'severity' | 'url' | 'project_id'>, consoleUrl: string | null): Record<string, unknown>[] {
  const open = e.url ? button('ops_open', 'Open', { url: e.url }) : null
  const consoleBtn = consoleUrl ? button('ops_open_console', 'Open in Mushi Mushi', { url: consoleUrl }) : null
  if (e.category !== 'alerts' || e.severity === 'resolved') return [open, consoleBtn].filter((b): b is Record<string, unknown> => b !== null)

  const out: Record<string, unknown>[] = [button(OPS_ACTION_ACK, 'Acknowledge', { value: e.id, ...(e.severity === 'urgent' ? { style: 'primary' } : {}) })]
  if (open) out.push(open)
  const menu: Record<string, unknown>[] = []
  if (consoleUrl) {
    if (open) menu.push({ text: { type: 'plain_text', text: 'Open in Mushi Mushi', emoji: true }, value: 'ops_open_console', url: consoleUrl })
    else if (consoleBtn) out.push(consoleBtn)
  }
  if (e.project_id) menu.push({ text: { type: 'plain_text', text: 'Mute this alert for 24 h', emoji: true }, value: `${OPS_MUTE_OPTION_PREFIX}${e.id}` })
  // Slack refuses an overflow menu with fewer than two options (invalid_blocks): a lone item is a button.
  if (menu.length >= 2) out.push({ type: 'overflow', action_id: OPS_ACTION_MORE, options: menu })
  else if (menu.length === 1) {
    const only = menu[0] as { value: string; url?: string; text: { text: string } }
    out.push(only.url ? button('ops_open_console', only.text.text, { url: only.url }) : button(OPS_ACTION_MUTE, 'Mute 24h', { value: e.id }))
  }
  return out.slice(0, OPS_ACTIONS_MAX)
}

/**
 * chat.postMessage `text` + `blocks` for one event, one format for every kind:
 *
 *   text      the news in one line ("🚀 yen-yen: Android 1.22.67 sent to Google
 *             Play", "🔴 glot.it: Practice page error (production)");
 *   context   the app icon, then name · category · environment · time;
 *   header    the emoji and the title, plain_text (the title is shown once,
 *             and no sender text is ever parsed as mrkdwn bold);
 *   section   the human summary (mrkdwn, escaped), if any;
 *   section   up to four fields, the rest of the facts in one context line;
 *   actions   up to three (opsActions).
 *
 * Block Kit only, never legacy attachments: with attachments Slack renders the
 * top-level text as a visible line, which doubled every title.
 */
export function buildOpsMessage(e: OpsEventRow, ctx: OpsMessageContext): { text: string; blocks: unknown[] } {
  const app = ctx.appName ?? 'mushi mushi'
  const title = stripLeadingMark(e.title)
  const env = eventEnvironment(e)
  const blocks: unknown[] = []

  const meta = [escapeMrkdwn(app), CATEGORY_LABEL[e.category] ?? e.category, env ? escapeMrkdwn(env) : null, slackTime(e.occurred_at)].filter(Boolean).join('  ·  ')
  const contextElements: unknown[] = []
  if (ctx.iconUrl) contextElements.push({ type: 'image', image_url: ctx.iconUrl, alt_text: app })
  contextElements.push({ type: 'mrkdwn', text: meta })
  blocks.push({ type: 'context', elements: contextElements })

  blocks.push({ type: 'header', text: { type: 'plain_text', text: `${opsEmoji(e)} ${title}`.slice(0, 150), emoji: true } })
  if (e.body?.trim()) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: escapeMrkdwn(e.body.trim()).slice(0, 2900) } })

  const facts = eventFacts(e)
  const fields = facts.slice(0, OPS_FIELDS_MAX).map((f) => ({ type: 'mrkdwn', text: `${boldLabel(f.label)}\n${escapeMrkdwn(f.value)}`.slice(0, 2000) }))
  if (fields.length) blocks.push({ type: 'section', fields })
  const rest = facts.slice(OPS_FIELDS_MAX)
  if (rest.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: rest.map((f) => `${boldLabel(f.label)}: ${escapeMrkdwn(f.value)}`).join('  ·  ').slice(0, 2900) }] })

  const actions = opsActions(e, ctx.consoleUrl)
  if (actions.length) blocks.push({ type: 'actions', elements: actions })
  // `text` is the notification and the fallback: escaped too, or a title such
  // as "<!channel>" from a Sentry error message would ping the whole channel.
  return { text: opsNotificationText(e, app), blocks }
}

/** HH:MM UTC, short enough for a context line. */
export function shortUtc(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(11, 16)} UTC` : ''
}

/**
 * The parent's new look once its incident resolved: the same message with ✅
 * in place of its status mark, a "Resolved: …" line, and no buttons but the
 * links. The resolve itself is a reply in the thread.
 */
export function buildResolvedParent(parent: OpsEventRow, resolved: Pick<OpsEventRow, 'title' | 'occurred_at'>, ctx: OpsMessageContext): { text: string; blocks: unknown[] } {
  const original = buildOpsMessage({ ...parent, severity: 'resolved' }, { ...ctx })
  const when = slackTime(resolved.occurred_at)
  const line = `✅ Resolved: ${escapeMrkdwn(stripLeadingMark(resolved.title))}${when ? `  ·  ${when}` : ''}`
  const blocks = [...original.blocks]
  const headerAt = blocks.findIndex((b) => (b as { type?: string }).type === 'header')
  blocks.splice(headerAt + 1, 0, { type: 'context', elements: [{ type: 'mrkdwn', text: line }] })
  return { text: `✅ ${escapeMrkdwn(ctx.appName ?? 'mushi mushi')}: ${escapeMrkdwn(stripLeadingMark(parent.title))} (resolved)`, blocks }
}

// ── Fingerprints and mutes ──────────────────────────────────────────────────

/**
 * The thread an event belongs to. The sender's thread key when it gave one;
 * else, for an alert, `fp:<kind>:<title>`, so a repeat with a fresh run id
 * ("Android 1.22.62 release failed", three runs in 20 minutes) threads under
 * the first post instead of posting anew. Payments and releases have none.
 */
export function opsThreadKey(e: Pick<OpsEventInput, 'category' | 'kind' | 'title' | 'threadKey'>): string | null {
  if (e.threadKey) return e.threadKey.slice(0, 200)
  if (e.category !== 'alerts') return null
  const t = stripLeadingMark(e.title).toLowerCase().replace(/\s+/g, ' ').trim()
  return t ? `fp:${e.kind}:${t}`.slice(0, 200) : null
}

/**
 * What a Mute 24h on this event silences: its category, kind and fingerprint
 * (`alerts:deploy.failed:fp:…`). The empty scope is the whole app (the
 * `mute <app>` slash command). Only an alert can be muted from its message.
 */
export function opsMuteScope(e: Pick<OpsEventRow, 'category' | 'kind' | 'thread_key'>): string {
  return `${e.category}:${e.kind}:${e.thread_key ?? ''}`.slice(0, 300)
}

/** True when a mute row with this scope silences the event. */
export function muteCovers(scope: string | null | undefined, e: Pick<OpsEventRow, 'category' | 'kind' | 'thread_key'>): boolean {
  const s = scope ?? ''
  return s === '' || s === opsMuteScope(e)
}

/** The slack_error prefix of a GitHub release post that the app's own post for the same commit replaced. */
export const OPS_SUPERSEDED_PREFIX = 'superseded by'

/** True for a release row the app's own post replaced: counted and listed once, as the app's post. */
export function isSupersededRelease(e: { slack_error?: string | null }): boolean {
  return String(e.slack_error ?? '').startsWith(OPS_SUPERSEDED_PREFIX)
}

/** The short sha an event names (its `Commit` fact), lowercased, else null. */
export function eventCommit(e: Pick<OpsEventRow, 'facts'>): string | null {
  const f = (e.facts ?? []).find((x) => /^commit$/i.test(x.label.trim()))
  const m = /^([0-9a-f]{7,40})\b/i.exec(f?.value.trim() ?? '')
  return m ? m[1].slice(0, 7).toLowerCase() : null
}

// ── Titles from error messages ──────────────────────────────────────────────

export const OPS_ERROR_TITLE_MAX = 120

/** Cut at a word boundary to at most `max` characters, with "…" when cut. Text with no spaces (Japanese) is cut hard. */
export function cutAtWord(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  const head = t.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  return `${(space >= max * 0.5 ? head.slice(0, space) : head).replace(/[\s,:;.-]+$/, '')}…`
}

/**
 * An error message as a title: the first line, a JSON payload moved out into a
 * code snippet, and at most 120 characters. "Langfuse HTTP 410:
 * {"_deprecation":…}" → title "Langfuse HTTP 410", snippet the JSON.
 * Empty in, empty title out: the caller picks the fallback.
 */
export function cleanErrorTitle(raw: string | null | undefined): { title: string; snippet: string | null } {
  const text = (raw ?? '').replace(/\r\n?/g, '\n').trim()
  const lines = text.split('\n')
  let first = (lines[0] ?? '').trim()
  let snippet: string | null = lines.length > 1 ? lines.slice(1).join('\n').trim() || null : null
  const json = /[{[]\s*["{[]/.exec(first)
  if (json && json.index > 0) {
    snippet = [first.slice(json.index).trim(), snippet].filter(Boolean).join('\n')
    first = first.slice(0, json.index).replace(/[\s:=-]+$/, '').trim()
  }
  first = first.replace(/^Error:\s+/, '')
  return { title: cutAtWord(first, OPS_ERROR_TITLE_MAX), snippet: snippet ? snippet.slice(0, 400) : null }
}

// ── Threads ─────────────────────────────────────────────────────────────────

export interface ThreadPlan {
  /** Post as a reply under this message ts. */
  threadTs: string | null
  /** Show the reply in the channel too. Always false since 2026-11-20: a resolve is a thread reply and edits the parent's mark. */
  broadcast: boolean
  /** Edit the parent with `chat.update` (a resolve under a posted parent). */
  updateParent: boolean
}

/**
 * Where an event goes, given the first event of its thread in the same org
 * and category (Slack threads live in one channel). A parent that never
 * reached Slack has no ts to reply under, so the event posts on its own.
 */
export function planThread(e: Pick<OpsEventRow, 'severity'>, parent: Pick<OpsEventRow, 'slack_ts' | 'slack_channel'> | null, channel: string): ThreadPlan {
  const ts = parent && parent.slack_ts && parent.slack_channel === channel ? parent.slack_ts : null
  if (!ts) return { threadTs: null, broadcast: false, updateParent: false }
  return { threadTs: ts, broadcast: false, updateParent: e.severity === 'resolved' }
}

// ── Slash command grammar ───────────────────────────────────────────────────

export type SalesRange = 'today' | 'week' | 'month'

export type OpsCommand =
  | { sub: 'help' }
  | { sub: 'status' }
  | { sub: 'sales'; range: SalesRange }
  | { sub: 'releases'; n: number }
  | { sub: 'alerts' }
  | { sub: 'bugs' }
  | { sub: 'ci' }
  | { sub: 'apps' }
  | { sub: 'mute'; app: string; ms: number; label: string }
  | { sub: 'unmute'; app: string }
  | { sub: 'usage'; text: string }

export const MUTE_MAX_MS = 7 * 24 * 60 * 60_000

/** `30m`, `2h`, `1d` → ms (at most 7 days), else null. */
export function parseMuteDuration(raw: string | undefined): { ms: number; label: string } | null {
  const m = /^(\d{1,3})\s*(m|min|h|hr|d|day)s?$/i.exec((raw ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  if (!n) return null
  const unit = m[2].toLowerCase()[0]
  const ms = n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000)
  if (ms > MUTE_MAX_MS) return null
  return { ms, label: `${n}${unit}` }
}

/** Parse the text after the command (`/kensaurus sales week` → `sales week`). */
export function parseOpsCommand(rawText: string | null | undefined): OpsCommand {
  const text = (rawText ?? '').trim()
  if (!text) return { sub: 'help' }
  const [first, ...rest] = text.split(/\s+/)
  const sub = first.toLowerCase()
  switch (sub) {
    case 'help':
    case '?':
      return { sub: 'help' }
    case 'status':
    case 'st':
      return { sub: 'status' }
    case 'sales':
    case 'revenue': {
      const r = (rest[0] ?? 'today').toLowerCase()
      if (r === 'today' || r === 'day' || r === 'd') return { sub: 'sales', range: 'today' }
      if (r === 'week' || r === 'w' || r === '7d') return { sub: 'sales', range: 'week' }
      if (r === 'month' || r === 'm' || r === '30d') return { sub: 'sales', range: 'month' }
      return { sub: 'usage', text: 'Usage: `sales [today|week|month]`' }
    }
    case 'releases':
    case 'deploys': {
      const n = rest[0] ? Number(rest[0]) : 5
      if (!Number.isInteger(n) || n < 1) return { sub: 'usage', text: 'Usage: `releases [n]` (1 to 20)' }
      return { sub: 'releases', n: Math.min(20, n) }
    }
    case 'alerts':
      return { sub: 'alerts' }
    case 'bugs':
    case 'reports':
      return { sub: 'bugs' }
    case 'ci':
      return { sub: 'ci' }
    case 'apps':
      return { sub: 'apps' }
    case 'mute': {
      const dur = parseMuteDuration(rest[rest.length - 1])
      const app = (dur ? rest.slice(0, -1) : rest).join(' ').trim()
      if (!app || !dur) return { sub: 'usage', text: 'Usage: `mute <app> <2h|1d>` (at most 7d)' }
      return { sub: 'mute', app, ms: dur.ms, label: dur.label }
    }
    case 'unmute': {
      const app = rest.join(' ').trim()
      return app ? { sub: 'unmute', app } : { sub: 'usage', text: 'Usage: `unmute <app>`' }
    }
    default:
      return { sub: 'usage', text: `Unknown command \`${escapeMrkdwn(first.slice(0, 30))}\`. Try \`help\`.` }
  }
}

/** The help card, with the team's own command name. */
export function opsHelpText(command: string): string {
  const c = escapeMrkdwn(command)
  return [
    `*${c}* — your apps at a glance`,
    `• \`${c} status\` — each app's last release, open alerts, open bugs and today's CI failures`,
    `• \`${c} sales [today|week|month]\` — payments by app and currency, refunds taken off`,
    `• \`${c} releases [n]\` — the last n releases (5 by default)`,
    `• \`${c} alerts\` — alerts nobody has acknowledged yet`,
    `• \`${c} bugs\` — the newest open bug reports per app, with links`,
    `• \`${c} ci\` — today's CI runs per app`,
    `• \`${c} apps\` — every app and when each last reported`,
    `• \`${c} mute <app> <2h|1d>\` / \`${c} unmute <app>\` — pause an app's messages here (events are still kept)`,
  ].join('\n')
}

/** Find an app by name, slug or a unique prefix of either (case-insensitive). */
export function matchApp<T extends { id: string; name: string | null; slug?: string | null }>(apps: T[], query: string): { ok: true; app: T } | { ok: false; message: string } {
  const q = query.trim().toLowerCase()
  const names = (a: T) => [a.name, a.slug].filter((v): v is string => typeof v === 'string' && v.length > 0).map((v) => v.toLowerCase())
  const exact = apps.filter((a) => names(a).includes(q))
  if (exact.length === 1) return { ok: true, app: exact[0] }
  const prefix = apps.filter((a) => names(a).some((n) => n.startsWith(q)))
  if (prefix.length === 1) return { ok: true, app: prefix[0] }
  if (prefix.length === 0) return { ok: false, message: `No app called \`${escapeMrkdwn(query)}\`. Try \`apps\`.` }
  return { ok: false, message: `\`${escapeMrkdwn(query)}\` matches ${prefix.length} apps: ${prefix.slice(0, 5).map((a) => `\`${escapeMrkdwn((a.name ?? a.id).toLowerCase())}\``).join(', ')}.` }
}
