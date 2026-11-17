/**
 * FILE: packages/server/supabase/functions/_shared/ops-format.ts
 * PURPOSE: The pure half of the Ops hub (docs/execplans/ops-hub-slack.md):
 *
 *   - the PII guard (an app's event must not carry an email or a phone
 *     number; Mushi Mushi's own sources redact instead of refusing);
 *   - the Slack message for one event (app icon and name, emoji headline,
 *     body, facts, buttons), and the edit a parent gets when its incident
 *     resolves;
 *   - where a new event goes in Slack: a new message, a reply in its thread,
 *     or a resolve that is broadcast to the channel and edits the parent;
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
export const OPS_ACTION_MUTE = 'ops_mute'

/** The facts line: `label: value · …`, the amount first when there is one. */
export function factsLine(e: Pick<OpsEventRow, 'facts' | 'amount_minor' | 'currency' | 'kind'>): string | null {
  const parts: string[] = []
  if (e.amount_minor != null && e.currency) {
    const sign = isRefundKind(e.kind) ? '−' : ''
    parts.push(`*Amount:* ${sign}${formatMoney(Math.abs(e.amount_minor), e.currency)}`)
  }
  for (const f of e.facts ?? []) parts.push(`*${escapeMrkdwn(f.label)}:* ${escapeMrkdwn(f.value)}`)
  return parts.length ? parts.join('  ·  ').slice(0, 2900) : null
}

/** chat.postMessage `text` + `blocks` for one event. */
export function buildOpsMessage(e: OpsEventRow, ctx: OpsMessageContext): { text: string; blocks: unknown[] } {
  const app = ctx.appName ?? 'mushi mushi'
  const head = `${opsEmoji(e)} ${escapeMrkdwn(e.title)}`
  const blocks: unknown[] = []
  const contextElements: unknown[] = []
  if (ctx.iconUrl) contextElements.push({ type: 'image', image_url: ctx.iconUrl, alt_text: app })
  contextElements.push({ type: 'mrkdwn', text: `*${escapeMrkdwn(app)}*  ·  ${e.category}` })
  blocks.push({ type: 'context', elements: contextElements })
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: e.body ? `*${head}*\n${escapeMrkdwn(e.body)}` : `*${head}*` } })
  const facts = factsLine(e)
  if (facts) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: facts }] })

  const buttons: unknown[] = []
  if (e.severity !== 'resolved') {
    buttons.push({ type: 'button', action_id: OPS_ACTION_ACK, text: { type: 'plain_text', text: 'Acknowledge' }, value: e.id, ...(e.severity === 'urgent' ? { style: 'primary' } : {}) })
    if (e.project_id) buttons.push({ type: 'button', action_id: OPS_ACTION_MUTE, text: { type: 'plain_text', text: 'Mute 24h' }, value: e.id })
  }
  if (e.url) buttons.push({ type: 'button', action_id: 'ops_open', text: { type: 'plain_text', text: 'Open' }, url: e.url })
  if (ctx.consoleUrl) buttons.push({ type: 'button', action_id: 'ops_open_console', text: { type: 'plain_text', text: 'Open in Mushi Mushi' }, url: ctx.consoleUrl })
  if (buttons.length) blocks.push({ type: 'actions', elements: buttons.slice(0, 5) })
  return { text: `${app} · ${e.title}`, blocks }
}

/** HH:MM UTC, short enough for a context line. */
export function shortUtc(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(11, 16)} UTC` : ''
}

/**
 * The parent's new look once its incident resolved: the original message with
 * a ✅ line on top ("✅ fixed by the next deploy · 14:02 UTC") and no buttons.
 */
export function buildResolvedParent(parent: OpsEventRow, resolved: Pick<OpsEventRow, 'title' | 'occurred_at'>, ctx: OpsMessageContext): { text: string; blocks: unknown[] } {
  const original = buildOpsMessage({ ...parent, severity: 'resolved' }, { ...ctx })
  const line = `✅ ${escapeMrkdwn(resolved.title)} · ${shortUtc(resolved.occurred_at)}`
  const blocks = original.blocks.filter((b) => (b as { type?: string }).type !== 'actions')
  return { text: `${ctx.appName ?? 'mushi mushi'} · ✅ ${resolved.title}`, blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: line }] }, ...blocks] }
}

// ── Threads ─────────────────────────────────────────────────────────────────

export interface ThreadPlan {
  /** Post as a reply under this message ts. */
  threadTs: string | null
  /** Show the reply in the channel too (a resolve). */
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
  const resolved = e.severity === 'resolved'
  return { threadTs: ts, broadcast: resolved, updateParent: resolved }
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
