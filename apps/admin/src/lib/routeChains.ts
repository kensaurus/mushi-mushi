/**
 * FILE: apps/admin/src/lib/routeChains.ts
 * PURPOSE: The pure rules behind the Routes tab (2026-11-21 redesign):
 *            - fold an app's features whose fallback order is identical into one chain
 *              (glot.it: 42 features, 6 chains), so 332 route rows read as ~23 lines;
 *            - the app × provider overview: each app's role for a provider in its default
 *              order (primary / backup / last resort / off), health, 24 h calls and cost;
 *            - the one-line status, the kill-switch impact, "Used by" from the routes;
 *            - the price book a model picker lists (newest price in effect, token models);
 *            - a chain edit as plain-word changes, and as the ordered route writes that apply
 *              it to every feature in the chain: one `batch` call when kensaurus-ops offers it
 *              (one transaction, one hub notice), else one audited write at a time, stopping
 *              at the first refusal;
 *            - the params a model refuses (gpt-6.x-sol and reasoning effort none), as upstream;
 *            - the weekly model scout's suggestions, read back from its Ops hub event.
 *          No React; every rule here is unit tested (routeChains.test.ts).
 */

import type { AiRoute, ModelPrice, OpsAction, OpsMeta, OpsSnapshot, ProviderAccount, ProviderState, RouteParams } from './kensaurusOpsTypes'

// ── names ───────────────────────────────────────────────────────────────────

const PROVIDER_NAME: Record<string, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  together: 'Together',
  elevenlabs: 'ElevenLabs',
  fal: 'fal.ai',
  voyage: 'Voyage',
}

/** A provider slug as people say it: openai → OpenAI. */
export function providerName(provider: string): string {
  return PROVIDER_NAME[provider] ?? provider
}

/** "openai/gpt-6-luna" on OpenRouter reads "gpt-6-luna": the step's provider already says where. */
export function modelShort(model: string): string {
  const i = model.lastIndexOf('/')
  return i >= 0 ? model.slice(i + 1) : model
}

/**
 * JSON with object keys sorted, so `{a,b}` and `{b,a}` sign the same.
 * @internal Exported for tests.
 */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

// ── chains ──────────────────────────────────────────────────────────────────

/** One step of a fallback order: what the router tries, in this place. */
export interface ChainStep {
  provider: string
  model: string
  params: RouteParams
  enabled: boolean
}

/** A feature in a chain, with its own rows (priorities can differ between twins). */
interface ChainMember {
  feature: string
  /** By priority, best first; rows[i] is the chain's steps[i]. */
  rows: AiRoute[]
}

export interface RouteChain {
  /** `${app}::${signature}`: stable while the order is unchanged. */
  id: string
  app: string
  signature: string
  steps: ChainStep[]
  /** '*' first, then by name. */
  members: ChainMember[]
  /** Holds the app's default ('*'): every feature without its own rows uses it too. */
  isDefault: boolean
}

export interface AppChains {
  app: string
  chains: RouteChain[]
  features: number
}

const stepSig = (s: { provider: string; model: string; enabled: boolean; params?: RouteParams | null }) =>
  `${s.provider}|${s.model}|${s.enabled ? 1 : 0}|${stableJson(s.params ?? {})}`

/** A feature's fallback order as one string: provider, model, on/off and params per step, in order. */
function rowsSignature(rows: readonly AiRoute[]): string {
  return [...rows].sort((a, b) => a.priority - b.priority).map(stepSig).join('>')
}

const byFeature = (a: string, b: string) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b))

/**
 * Every app's features folded into chains: features whose steps are identical (provider + model +
 * params + on/off, in order) share one chain. Per app, never across apps: saving a chain then
 * touches one app only. Apps by name; the default chain first, then the most features first.
 */
export function groupChains(routes: readonly AiRoute[]): AppChains[] {
  const apps = new Map<string, Map<string, AiRoute[]>>()
  for (const r of routes) {
    const features = apps.get(r.app) ?? new Map<string, AiRoute[]>()
    features.set(r.feature, [...(features.get(r.feature) ?? []), r])
    apps.set(r.app, features)
  }
  return [...apps.keys()].sort().map((app) => {
    const features = apps.get(app)!
    const chains = new Map<string, RouteChain>()
    for (const feature of [...features.keys()].sort(byFeature)) {
      const rows = [...features.get(feature)!].sort((a, b) => a.priority - b.priority)
      const signature = rowsSignature(rows)
      const chain = chains.get(signature) ?? {
        id: `${app}::${signature}`,
        app,
        signature,
        steps: rows.map((r) => ({ provider: r.provider, model: r.model, params: r.params ?? {}, enabled: r.enabled })),
        members: [],
        isDefault: false,
      }
      chain.members.push({ feature, rows })
      if (feature === '*') chain.isDefault = true
      chains.set(signature, chain)
    }
    const list = [...chains.values()].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault) || b.members.length - a.members.length || byFeature(a.members[0]!.feature, b.members[0]!.feature),
    )
    return { app, chains: list, features: features.size }
  })
}

/** Find a chain by id in a fresh read; null when its order changed or it is gone. */
export function findChain(apps: readonly AppChains[], id: string): RouteChain | null {
  for (const a of apps) for (const c of a.chains) if (c.id === id) return c
  return null
}

/** The chain's name in a list: "Default", the feature when it is alone, else its first feature and how many more. */
export function chainTitle(chain: RouteChain): string {
  if (chain.isDefault) return 'Default'
  const [first, ...rest] = chain.members
  return rest.length === 0 ? first!.feature : `${first!.feature} + ${rest.length} more`
}

// ── providers: health, kill switch, roles ──────────────────────────────────

type ProviderHealthKind = 'ok' | 'warn' | 'down' | 'stale' | 'unknown' | 'off' | 'no_check'

export interface ProviderHealth {
  provider: string
  kind: ProviderHealthKind
  /** Plain words: "Healthy", "Off for all apps", "No health check yet". */
  word: string
  accounts: ProviderAccount[]
  /** Every account of it is switched off: the router leaves it out of every app. */
  killed: boolean
}

const STATE_RANK: Record<ProviderState, number> = { down: 0, warn: 1, stale: 2, unknown: 3, ok: 4 }
const HEALTH_WORD: Record<ProviderHealthKind, string> = {
  ok: 'Healthy',
  warn: 'Warning',
  down: 'Down',
  stale: 'Not checked lately',
  unknown: 'Not checked',
  off: 'Off for all apps',
  no_check: 'No health check yet',
}

/**
 * A routed provider's health from its accounts: worst enabled account; off when every account is
 * switched off (the kill switch); "no health check yet" when kenji has no account for it at all
 * (OpenRouter, 2026-11-21), which is not the same as a failed check.
 */
export function providerHealth(provider: string, accounts: readonly ProviderAccount[]): ProviderHealth {
  const mine = accounts.filter((a) => a.provider === provider)
  if (mine.length === 0) return { provider, kind: 'no_check', word: HEALTH_WORD.no_check, accounts: [], killed: false }
  const on = mine.filter((a) => a.enabled)
  if (on.length === 0) return { provider, kind: 'off', word: HEALTH_WORD.off, accounts: mine, killed: true }
  const worst = on.map((a) => a.status?.state ?? 'unknown').sort((x, y) => STATE_RANK[x] - STATE_RANK[y])[0]!
  return { provider, kind: worst, word: HEALTH_WORD[worst], accounts: mine, killed: false }
}

/** Providers the routes use, in meta's order, then by name. */
export function routedProviders(routes: readonly AiRoute[], meta: OpsMeta | null): string[] {
  const used = new Set(routes.map((r) => r.provider))
  const order = meta?.route_providers ?? []
  return [...used].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
}

export type ProviderRole = 'primary' | 'backup' | 'last' | 'off' | 'none'

export const ROLE_WORD: Record<ProviderRole, string> = {
  primary: 'Primary',
  backup: 'Backup',
  last: 'Last resort',
  off: 'Off',
  none: '—',
}

export interface OverviewCell {
  role: ProviderRole
  /** Why it is off: a step turned off, or the provider switched off for every app. */
  offReason: 'step' | 'provider' | null
  /** Features with their own order that try this provider (turned on), beside the default. */
  overrides: number
  calls: number
  errors: number
  cost: number
  /** Open incidents an app reported for this provider (its own key), or kenji's watch raised. */
  incidents: number
  crit: boolean
}

export interface OverviewRow {
  app: string
  cells: Map<string, OverviewCell>
  incidents: number
  calls: number
  cost: number
}

/**
 * Open incidents per app and provider, app-reported ones included (they carry no account id).
 * @internal Exported for tests.
 */
export function incidentsByAppProvider(snapshot: Pick<OpsSnapshot, 'incidents' | 'providers'>): Map<string, { total: number; crit: boolean }> {
  const providerOf = new Map(snapshot.providers.map((p) => [p.id, p.provider]))
  const out = new Map<string, { total: number; crit: boolean }>()
  for (const i of snapshot.incidents) {
    const provider = i.provider ?? (i.account_id ? providerOf.get(i.account_id) : undefined)
    if (!i.app || !provider) continue
    const key = `${i.app}|${provider}`
    const cur = out.get(key) ?? { total: 0, crit: false }
    out.set(key, { total: cur.total + 1, crit: cur.crit || i.severity === 'crit' })
  }
  return out
}

/**
 * The overview matrix: per app, each provider's role in the app's default order, counting only
 * what the router actually tries (a step turned on, its provider not switched off). The default
 * alone decides the role: a drill or one feature's override never makes a provider "primary".
 */
export function buildOverview(snapshot: OpsSnapshot, providers: readonly string[], health: ReadonlyMap<string, ProviderHealth>): OverviewRow[] {
  const apps = groupChains(snapshot.routes)
  const incidents = incidentsByAppProvider(snapshot)
  const usage = new Map<string, { calls: number; errors: number; cost: number }>()
  for (const r of snapshot.spend.last_24h.rows) {
    const key = `${r.app}|${r.provider}`
    const u = usage.get(key) ?? { calls: 0, errors: 0, cost: 0 }
    usage.set(key, { calls: u.calls + r.calls, errors: u.errors + r.errors, cost: u.cost + (r.cost_micro ?? 0) })
  }
  const killed = (p: string) => health.get(p)?.killed ?? false
  return apps.map(({ app, chains }) => {
    const def = chains.find((c) => c.isDefault) ?? null
    const live = def ? def.steps.filter((s) => s.enabled && !killed(s.provider)).map((s) => s.provider) : []
    const order = [...new Set(live)]
    const cells = new Map<string, OverviewCell>()
    let rowIncidents = 0
    let rowCalls = 0
    let rowCost = 0
    for (const p of providers) {
      const inDefault = def?.steps.some((s) => s.provider === p) ?? false
      const pos = order.indexOf(p)
      let role: ProviderRole = 'none'
      let offReason: OverviewCell['offReason'] = null
      if (pos === 0) role = 'primary'
      else if (pos > 0 && pos === order.length - 1) role = 'last'
      else if (pos > 0) role = 'backup'
      else if (inDefault) {
        role = 'off'
        offReason = killed(p) ? 'provider' : 'step'
      }
      const overrides = chains
        .filter((c) => !c.isDefault)
        .filter((c) => c.steps.some((s) => s.provider === p && s.enabled))
        .reduce((n, c) => n + c.members.length, 0)
      if (role === 'none' && overrides > 0 && killed(p)) {
        role = 'off'
        offReason = 'provider'
      }
      const u = usage.get(`${app}|${p}`) ?? { calls: 0, errors: 0, cost: 0 }
      const inc = incidents.get(`${app}|${p}`)
      rowIncidents += inc?.total ?? 0
      rowCalls += u.calls
      rowCost += u.cost
      cells.set(p, { role, offReason, overrides, ...u, incidents: inc?.total ?? 0, crit: inc?.crit ?? false })
    }
    return { app, cells, incidents: rowIncidents, calls: rowCalls, cost: rowCost }
  })
}

/**
 * The page's one line: each routed provider in a word or two, then open incidents.
 * "OpenAI healthy · OpenRouter no health check yet · Anthropic off for all apps · 0 open incidents".
 */
export function routesStatusLine(health: readonly ProviderHealth[], openIncidents: number): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  const parts = health.map((h) => `${providerName(h.provider)} ${h.kind === 'ok' ? 'healthy' : h.word.charAt(0).toLowerCase() + h.word.slice(1)}`)
  parts.push(`${openIncidents} open incident${openIncidents === 1 ? '' : 's'}`)
  const down = health.some((h) => h.kind === 'down')
  const warn = health.some((h) => h.kind === 'warn' || h.kind === 'stale' || h.kind === 'unknown' || h.kind === 'off')
  return { text: parts.join(' · '), tone: down ? 'danger' : warn || openIncidents > 0 ? 'warn' : 'ok' }
}

export interface KillImpact {
  /** Apps with a step turned on for this provider. */
  apps: string[]
  /** Features that would have nothing left to try: every live step of theirs is on this provider. */
  stranded: Array<{ app: string; features: string[] }>
}

/** What switching a provider off for every app does, for the confirm. */
export function killImpact(routes: readonly AiRoute[], provider: string, health: ReadonlyMap<string, ProviderHealth>): KillImpact {
  const killed = (p: string) => p === provider || (health.get(p)?.killed ?? false)
  const apps = new Set<string>()
  const stranded = new Map<string, string[]>()
  for (const { app, chains } of groupChains(routes)) {
    for (const c of chains) {
      const live = c.steps.filter((s) => s.enabled && !(health.get(s.provider)?.killed ?? false))
      if (!live.some((s) => s.provider === provider)) continue
      apps.add(app)
      if (live.every((s) => killed(s.provider))) stranded.set(app, [...(stranded.get(app) ?? []), ...c.members.map((m) => m.feature)])
    }
  }
  return { apps: [...apps].sort(), stranded: [...stranded].map(([app, features]) => ({ app, features })) }
}

export interface RouteUse {
  app: string
  features: string[]
}

/**
 * "Used by" from the routes (2026-11-21: provider_accounts.depends was stale): the apps whose
 * routes try this provider, turned on, with their features. An app that brings its own key
 * (glot.it, Mushi Mushi, tsumagoi, solo-boss) routes to the provider without spending this key.
 */
export function routeUsers(routes: readonly AiRoute[], provider: string, appName: (app: string) => string = (a) => a): RouteUse[] {
  const by = new Map<string, Set<string>>()
  for (const r of routes) {
    if (r.provider !== provider || !r.enabled) continue
    by.set(r.app, (by.get(r.app) ?? new Set()).add(r.feature === '*' ? 'default' : r.feature))
  }
  return [...by]
    .map(([app, f]) => ({ app, features: [...f].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b))) }))
    .sort((a, b) => appName(a.app).localeCompare(appName(b.app)))
}

// ── price book ──────────────────────────────────────────────────────────────

type ModelTier = 'small' | 'mid' | 'top'

export interface PricedModel {
  model: string
  /** Micro-USD per 1M tokens. */
  input: number
  output: number
  tier: ModelTier
}

/**
 * A model's size class. The price book has no tier column, so the name decides when it says
 * (luna / haiku / mini / nano → small, terra / sonnet → mid, sol / opus → top), else the
 * blended price (3 input : 1 output) does.
 * @internal Exported for tests.
 */
export function modelTier(model: string, input: number, output: number): ModelTier {
  const named = tierByName(model)
  if (named) return named
  const blended = (3 * input + output) / 4
  return blended <= 500_000 ? 'small' : blended <= 4_000_000 ? 'mid' : 'top'
}

/** The size class a model's name says, or null when it says none. */
function tierByName(model: string): ModelTier | null {
  const m = model.toLowerCase()
  if (/(luna|haiku|mini|nano|lite|flash)/.test(m)) return 'small'
  if (/(terra|sonnet)/.test(m)) return 'mid'
  if (/(sol|opus)/.test(m)) return 'top'
  return null
}

const TIER_RANK: Record<ModelTier, number> = { small: 0, mid: 1, top: 2 }

/**
 * The models a step on this provider can switch to: token-priced chat models with the newest
 * price in effect (claude-sonnet-5 has two rows), cheapest first. Embeddings (no output price),
 * speech and per-unit models are left out.
 */
export function priceBook(prices: readonly ModelPrice[], provider: string, now: number): PricedModel[] {
  const newest = new Map<string, ModelPrice>()
  for (const p of prices) {
    if (p.provider !== provider || p.unit_kind !== 'tokens') continue
    const at = Date.parse(p.effective_from)
    if (Number.isFinite(at) && at > now) continue
    const cur = newest.get(p.model)
    if (!cur || Date.parse(cur.effective_from) < at) newest.set(p.model, p)
  }
  return [...newest.values()]
    .filter((p) => p.input_per_mtok_micro != null && (p.output_per_mtok_micro ?? 0) > 0)
    .map((p) => {
      const input = p.input_per_mtok_micro!
      const output = p.output_per_mtok_micro!
      return { model: p.model, input, output, tier: modelTier(p.model, input, output) }
    })
    .sort((a, b) => a.input + a.output - (b.input + b.output) || a.model.localeCompare(b.model))
}

/** Micro-USD per 1M tokens as "$0.10". */
function perMillion(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`
}

/** "$0.10 in / $0.50 out per 1M · small" for a picker option. */
export function priceLabel(p: PricedModel): string {
  return `${perMillion(p.input)} in / ${perMillion(p.output)} out per 1M · ${p.tier}`
}

// ── params a model refuses ─────────────────────────────────────────────────

const SOL_RE = /(^|\/)gpt-[0-9.]+-sol$/

/**
 * The one param pairing upstream refuses (yen-yen kensaurus-ops `paramsProblem` and the routes
 * guard trigger, 2026-11-21): gpt-6.x-sol on OpenAI or OpenRouter answers 400 to reasoning effort
 * `none` and `minimal`, so a route never stores it. Null when the step is fine.
 */
export function paramsProblem(provider: string, model: string, params: RouteParams | null | undefined): string | null {
  const effort = params?.reasoning_effort
  if ((provider === 'openai' || provider === 'openrouter') && SOL_RE.test(model) && (effort === 'none' || effort === 'minimal')) {
    return `${modelShort(model)} needs reasoning effort low or higher`
  }
  return null
}

/**
 * The step's params after its model changes: a switch to Sol with effort none or minimal moves
 * the effort to `low` (the cheapest it takes) and says so; anything else keeps the params.
 */
export function paramsForModel(provider: string, model: string, params: RouteParams): { params: RouteParams; note: string | null } {
  if (!paramsProblem(provider, model, params)) return { params, note: null }
  return { params: { ...params, reasoning_effort: 'low' }, note: `${modelShort(model)} needs reasoning effort low or higher, so it is now low.` }
}

const EFFORT_WORD: Record<string, string> = { reasoning_effort: 'reasoning', effort: 'effort' }

/** What changed in a step's settings, in words: "reasoning none → low"; "settings changed" otherwise. */
function settingsChange(before: RouteParams, after: RouteParams): string | null {
  if (stableJson(before) === stableJson(after)) return null
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => stableJson(before[k]) !== stableJson(after[k]))
  if (keys.every((k) => k in EFFORT_WORD)) {
    return keys.map((k) => `${EFFORT_WORD[k]} ${String(before[k] ?? 'unset')} → ${String(after[k] ?? 'unset')}`).join(', ')
  }
  return 'settings changed'
}

// ── editing a chain ─────────────────────────────────────────────────────────

/** A step in the drawer: an existing one (`origin` = its index in the chain) or a new one. */
export interface DraftStep extends ChainStep {
  origin: number | null
}

export function draftFrom(chain: RouteChain): DraftStep[] {
  return chain.steps.map((s, i) => ({ ...s, params: { ...s.params }, origin: i }))
}

/** The draft with step `index` moved one place up (-1) or down (+1); the same draft at an edge. */
export function moveStep(draft: readonly DraftStep[], index: number, dir: -1 | 1): DraftStep[] {
  const to = index + dir
  if (index < 0 || index >= draft.length || to < 0 || to >= draft.length) return [...draft]
  const next = [...draft]
  ;[next[index], next[to]] = [next[to]!, next[index]!]
  return next
}

const stepLabel = (s: { provider: string; model: string }) => `${providerName(s.provider)} ${modelShort(s.model)}`

/** The edit in plain words, one line each; empty when nothing changed. */
export function draftChanges(chain: RouteChain, draft: readonly DraftStep[]): string[] {
  const out: string[] = []
  const kept = new Set(draft.filter((d) => d.origin != null).map((d) => d.origin!))
  chain.steps.forEach((s, i) => {
    if (!kept.has(i)) out.push(`Remove ${stepLabel(s)}`)
  })
  draft.forEach((d, pos) => {
    if (d.origin == null) {
      out.push(`Add ${stepLabel(d)} as step ${pos + 1}${d.enabled ? '' : ' (off)'}`)
      return
    }
    const s = chain.steps[d.origin]!
    if (d.model !== s.model) out.push(`${providerName(s.provider)}: ${modelShort(s.model)} → ${modelShort(d.model)}`)
    const settings = settingsChange(s.params ?? {}, d.params ?? {})
    if (settings) out.push(`${stepLabel(d)}: ${settings}`)
    if (d.enabled !== s.enabled) out.push(`Turn ${d.enabled ? 'on' : 'off'} ${stepLabel(d)}`)
  })
  const before = chain.steps.map((_, i) => i).filter((i) => kept.has(i))
  const after = draft.filter((d) => d.origin != null).map((d) => d.origin!)
  if (before.join(',') !== after.join(',')) out.push(`New order: ${draft.map(stepLabel).join(' → ')}`)
  return out
}

/** Why the draft cannot be saved, or null. */
export function draftProblem(chain: RouteChain, draft: readonly DraftStep[], meta: OpsMeta | null): string | null {
  const max = (meta?.priority.max ?? 9) - (meta?.priority.min ?? 1) + 1
  if (draft.length === 0) return 'Keep at least one step.'
  if (draft.length > max) return `At most ${max} steps.`
  if (chain.isDefault && !draft.some((d) => d.enabled)) return 'The default needs at least one step turned on.'
  if (draft.some((d) => !d.model)) return 'Pick a model for every step.'
  for (const d of draft) {
    const problem = paramsProblem(d.provider, d.model, d.params)
    if (problem) return `${providerName(d.provider)}: ${problem}.`
  }
  return null
}

export interface FeaturePlan {
  app: string
  feature: string
  ops: OpsAction[]
}

/**
 * The single-row writes that turn one feature's rows into the draft, in an order that never trips
 * upstream's last-default guard (409) and never writes a priority a reorder has renumbered:
 *   adds (at free priorities) → turn-ons → model switches → turn-offs → deletes → one reorder.
 * Adds go after the deletes only when the chain is too full to add first. A model switch sends no
 * params unless the step's settings changed too, then the step's full params (twins share them:
 * the signature covers params). A step never changes provider: remove and add.
 * @internal Exported for tests.
 */
export function planFeature(app: string, member: ChainMember, draft: readonly DraftStep[], meta: OpsMeta | null): FeaturePlan {
  const min = meta?.priority.min ?? 1
  const max = meta?.priority.max ?? 9
  const rows = member.rows
  const feature = member.feature
  const kept = new Set(draft.filter((d) => d.origin != null).map((d) => d.origin!))
  const removed = rows.filter((_, i) => !kept.has(i))
  const added = draft.filter((d) => d.origin == null)
  const freeAmong = (taken: ReadonlySet<number>) => {
    const out: number[] = []
    for (let p = min; p <= max; p++) if (!taken.has(p)) out.push(p)
    return out
  }
  let free = freeAmong(new Set(rows.map((r) => r.priority)))
  const deletesFirst = free.length < added.length
  if (deletesFirst) free = freeAmong(new Set(rows.filter((_, i) => kept.has(i)).map((r) => r.priority)))
  const assigned = new Map<DraftStep, number>()
  added.forEach((d, i) => assigned.set(d, free[i]!))

  const key = (priority: number) => ({ app, feature, priority })
  const adds: OpsAction[] = added.map((d) => ({
    action: 'upsert_route',
    ...key(assigned.get(d)!),
    provider: d.provider,
    model: d.model,
    params: d.params,
    enabled: d.enabled,
  }))
  const existing = draft.filter((d) => d.origin != null).map((d) => ({ d, row: rows[d.origin!]! }))
  const enables: OpsAction[] = existing.filter(({ d, row }) => d.enabled && !row.enabled).map(({ row }) => ({ action: 'enable_route', ...key(row.priority) }))
  const models: OpsAction[] = existing
    .filter(({ d, row }) => d.model !== row.model || stableJson(d.params ?? {}) !== stableJson(row.params ?? {}))
    .map(({ d, row }) => ({
      action: 'upsert_route',
      ...key(row.priority),
      provider: row.provider,
      model: d.model,
      ...(stableJson(d.params ?? {}) !== stableJson(row.params ?? {}) ? { params: d.params } : {}),
    }))
  const disables: OpsAction[] = existing.filter(({ d, row }) => !d.enabled && row.enabled).map(({ row }) => ({ action: 'disable_route', ...key(row.priority) }))
  const deletes: OpsAction[] = removed.map((r) => ({ action: 'delete_route', ...key(r.priority) }))
  const order = draft.map((d) => (d.origin != null ? rows[d.origin]!.priority : assigned.get(d)!))
  const ascending = order.every((p, i) => i === 0 || p > order[i - 1]!)
  const reorder: OpsAction[] = ascending ? [] : [{ action: 'reorder', app, feature, order }]
  const ops = deletesFirst ? [...deletes, ...adds, ...enables, ...models, ...disables, ...reorder] : [...adds, ...enables, ...models, ...disables, ...deletes, ...reorder]
  return { app, feature, ops }
}

/** The whole save: one plan per feature in the chain, the default first. */
export function planChainSave(chain: RouteChain, draft: readonly DraftStep[], meta: OpsMeta | null): FeaturePlan[] {
  return chain.members.map((m) => planFeature(chain.app, m, draft, meta))
}

/** What the console read for one feature, so a batch refuses when the rows changed since. */
interface FeatureExpect {
  feature: string
  count: number
  /** The newest updated_at among its rows, exactly as the snapshot sent it; null for none. */
  updated_at: string | null
}

/** A snapshot timestamp in microseconds (Postgres sends six fractional digits; Date keeps three). */
function micros(t: string): number {
  const frac = /\.(\d+)/.exec(t)?.[1] ?? ''
  const ms = Date.parse(frac ? t.replace(/\.\d+/, `.${frac.slice(0, 3).padEnd(3, '0')}`) : t)
  return ms * 1000 + Number(frac.slice(3, 6).padEnd(3, '0'))
}

/** The newest of the snapshot's timestamps, as sent (the server compares it exactly). */
function newest(stamps: readonly string[]): string | null {
  let best: string | null = null
  for (const t of stamps) if (best === null || micros(t) > micros(best)) best = t
  return best
}

/** @internal Exported for tests. */
export function featureExpect(member: ChainMember): FeatureExpect {
  return { feature: member.feature, count: member.rows.length, updated_at: newest(member.rows.map((r) => r.updated_at)) }
}

/** The batch body for a chain save: every plan's writes in order, the expect per feature, the edit in words. */
export function chainBatch(chain: RouteChain, plans: readonly FeaturePlan[], note: string): Extract<OpsAction, { action: 'batch' }> {
  return {
    action: 'batch',
    app: chain.app,
    ops: plans.flatMap((p) => p.ops) as Extract<OpsAction, { action: 'batch' }>['ops'],
    expect: chain.members.map(featureExpect),
    ...(note ? { note: note.length > 300 ? `${note.slice(0, 299)}…` : note } : {}),
  }
}

/** Whether this upstream takes a batch, and whether this one fits its limits. */
export function batchFits(meta: OpsMeta | null, batch: Extract<OpsAction, { action: 'batch' }>): boolean {
  if (!meta?.actions?.includes('batch')) return false
  const maxOps = meta.batch?.max_ops ?? 300
  const maxBytes = meta.batch?.max_body_bytes ?? 64 * 1024
  // The server adds the actor (~45 bytes); leave room for it.
  return batch.ops.length <= maxOps && new TextEncoder().encode(JSON.stringify(batch)).length + 200 <= maxBytes
}

export interface SaveFailure {
  app: string
  feature: string
  /** Writes of this feature that went through before the refusal. */
  done: number
  of: number
  error: { code: string; message: string; issues?: unknown[] }
}

export interface SaveReport {
  saved: string[]
  failed: SaveFailure | null
  /** Features not touched because the save stopped first. */
  untouched: string[]
  writes: number
}

type WriteResult = { ok: boolean; error?: { code: string; message: string; issues?: unknown[] } }

/**
 * Send the plans one write at a time (kensaurus-ops has no batch action; each write is audited
 * upstream). Stops at the first refusal, since later writes may rest on it, and says exactly which
 * features changed, which one stopped part-way, and which were never touched.
 */
export async function runChainSave(
  plans: readonly FeaturePlan[],
  write: (action: OpsAction) => Promise<WriteResult>,
  onProgress?: (featuresDone: number, total: number) => void,
): Promise<SaveReport> {
  const saved: string[] = []
  let writes = 0
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!
    for (let k = 0; k < plan.ops.length; k++) {
      const res = await write(plan.ops[k]!)
      if (!res.ok) {
        return {
          saved,
          failed: { app: plan.app, feature: plan.feature, done: k, of: plan.ops.length, error: res.error ?? { code: 'ERROR', message: 'Not saved.' } },
          untouched: plans.slice(i + 1).map((p) => p.feature),
          writes,
        }
      }
      writes++
    }
    saved.push(plan.feature)
    onProgress?.(saved.length, plans.length)
  }
  return { saved, failed: null, untouched: [], writes }
}

/** Features of the chain whose rows no longer match it in a fresh read (or are gone). */
export function driftedFeatures(chain: RouteChain, routes: readonly AiRoute[]): string[] {
  return chain.members
    .map((m) => m.feature)
    .filter((feature) => {
      const rows = routes.filter((r) => r.app === chain.app && r.feature === feature)
      return rows.length === 0 || rowsSignature(rows) !== chain.signature
    })
}

const featureWord = (f: string) => (f === '*' ? 'default' : f)

/** The save's outcome in one or two sentences, for the toast and the banner. */
export function saveReportText(app: string, report: SaveReport, total: number, errorText: (e: SaveFailure['error']) => string): string {
  if (!report.failed) return `Saved to ${total === 1 ? '1 feature' : `all ${total} features`} of ${app}.`
  const f = report.failed
  const part = f.done > 0 ? ` (${f.done} of its ${f.of} changes went through)` : ''
  const rest = report.untouched.length > 0 ? ` ${report.untouched.length} not changed: ${report.untouched.slice(0, 4).map(featureWord).join(', ')}${report.untouched.length > 4 ? '…' : ''}.` : ''
  return `Saved ${report.saved.length} of ${total} features. Stopped at ${featureWord(f.feature)}${part}: ${errorText(f.error)}.${rest} The rest keep the old order; open it again to finish.`
}

// ── model scout ─────────────────────────────────────────────────────────────

export interface ScoutSuggestion {
  provider: string
  model: string
  /** OpenRouter id, e.g. "openai/gpt-6-nano". */
  candidate: string
  currentPerM: string
  candidatePerM: string
  savingPct: number
  /** "glot-it/chat p1" as the scout writes them (first three). */
  uses: string[]
  /** Chains (ids) that try `model` on `provider` today. */
  chains: string[]
  /**
   * The candidate is a smaller class of model (Sonnet → Haiku): cheaper because it does less,
   * not the same work for less. The scout ranks by price alone (2026-11-21: all three of its
   * first suggestions were such drops), so the card says it.
   */
  smaller: boolean
}

// `${provider} ${model} ($X/M) → ${candidate} ($Y/M, −N%), used by a, b, c` (yen-yen
// _shared/kensaurus-model-scout.ts scoutLines). The hub joins lines with " · " in the body.
const SCOUT_LINE = /([a-z][a-z0-9-]*) (\S+) \((\$[0-9.]+)\/M\) → (\S+) \((\$[0-9.]+)\/M, [−-](\d+)%\), used by ([^·\n]+)/g
// Since yen-yen PR 608 the scout words a smaller model apart, never as a swap.
const SCOUT_SMALLER_LINE =
  /([a-z][a-z0-9-]*) (\S+) \((\$[0-9.]+)\/M\) has a smaller, cheaper option, not a like-for-like swap: (\S+) \((\$[0-9.]+)\/M, [−-](\d+)%\), used by ([^·\n]+)/g

/**
 * The newest model-scout event's lines, parsed, with the chains each one would touch: `items` are
 * like-for-like swaps (same size class or larger), `smaller` the cheaper smaller models, which
 * are never offered as a swap. An older event wrote a downgrade as a swap line; its size by name
 * moves it to `smaller` too. Price-drift lines are for the price book, so they are left out.
 */
export function scoutSuggestions(events: ReadonlyArray<{ kind: string; body: string | null; occurred_at: string }>, apps: readonly AppChains[]): { at: string; items: ScoutSuggestion[]; smaller: ScoutSuggestion[] } | null {
  const latest = events.filter((e) => e.kind === 'ai.model_scout').sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0]
  if (!latest) return null
  const all: ScoutSuggestion[] = []
  const read = (re: RegExp, markedSmaller: boolean) => {
    for (const m of (latest.body ?? '').matchAll(re)) {
      const [, provider, model, currentPerM, candidate, candidatePerM, pct, uses] = m
      const chains = apps.flatMap((a) => a.chains.filter((c) => c.steps.some((s) => s.provider === provider && s.model === model)).map((c) => c.id))
      const from = tierByName(model!)
      const to = tierByName(candidate!)
      all.push({
        provider: provider!,
        model: model!,
        candidate: candidate!,
        currentPerM: currentPerM!,
        candidatePerM: candidatePerM!,
        savingPct: Number(pct),
        uses: uses!.split(',').map((u) => u.trim()).filter(Boolean),
        chains,
        smaller: markedSmaller || (from !== null && to !== null && TIER_RANK[to] < TIER_RANK[from]),
      })
    }
  }
  read(SCOUT_LINE, false)
  read(SCOUT_SMALLER_LINE, true)
  return { at: latest.occurred_at, items: all.filter((s) => !s.smaller), smaller: all.filter((s) => s.smaller) }
}
