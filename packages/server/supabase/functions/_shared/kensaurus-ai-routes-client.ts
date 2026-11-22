/**
 * kensaurus-ai-routes-client.ts — which provider and model an AI feature uses,
 * for every KENSAURUS app. Contract: scratchpad CONTRACT.md (2026-11-21).
 *
 * SYNC: the canonical copy is yen-yen supabase/functions/_shared/
 * kensaurus-ai-routes-client.ts. Every other repo vendors it BYTE-IDENTICAL
 * (glot.it, mushi-mushi, tsumagoi, solo-boss-cloud_backend, the-wanting-mind,
 * cooler-heads). Change it in yen-yen only, then run
 *   node scripts/sync-ai-routes-client.mjs --check <repo> …   (or --write)
 * from the yen-yen checkout. CLIENT_VERSION below moves with every change.
 *
 * Runtime-neutral on purpose: fetch, AbortController and timers only. No
 * Deno.*, no process.*, no imports. The caller passes env values in, so the
 * same file runs in Supabase Edge (Deno), Node (sbc) and tests.
 *
 * What it does:
 *   getRouteCandidates  the routes for (app, feature), read from kenji's
 *                       `kensaurus-ai-routes` endpoint (or a loader the caller
 *                       passes, e.g. the RPC on kenji itself): live (800 ms
 *                       at most) → 60 s cache → last-known-good → baked. It
 *                       never throws, so a kenji outage never blocks a call.
 *   bakedCandidates     the last resort per tier, OpenAI first.
 *   orderCandidates     priority order, with providers marked down by the
 *                       watch or tripped by the breaker moved last.
 *   noteOutcome         the per-isolate circuit breaker: 3 payment, auth or
 *                       outage failures of one provider within 5 minutes
 *                       send it last for 10 minutes.
 *   classifyProviderError, reportProviderFailure
 *                       what a failed call was, and a fire-and-forget report
 *                       of the ones a person must fix (auth, payment, config)
 *                       to kenji's `kensaurus-provider-ingest`: an incident,
 *                       Slack #alerts and Mushi ops.
 *
 * It returns candidates only: it never calls a provider and never meters.
 * Each repo's executor runs the wire formats and its own wallet debit.
 */

export const CLIENT_VERSION = '1.2.0'

export type Tier = 'fast' | 'standard' | 'premium'
export type ProviderState = 'ok' | 'degraded' | 'down'

export interface RouteCandidate {
  priority: number
  provider: string
  model: string
  params: Record<string, unknown>
  provider_state?: ProviderState
}

/** What GET kensaurus-ai-routes answers (and what a `load` override returns). */
export interface RoutesResponse {
  app: string
  feature: string
  /** The feature whose rows answered: the feature itself, or '*'. */
  matched: string
  candidates: RouteCandidate[]
  ttl_s: number
  version: string
}

export interface RoutesConfig {
  /** GET endpoint, e.g. https://jghcferpoaqntpfqvayf.supabase.co/functions/v1/kensaurus-ai-routes */
  url: string
  /**
   * KENSAURUS_ROUTES_TOKEN (CONTRACT §5c): read-only, never the wallet token.
   * Sent as x-kensaurus-routes-token, never logged.
   */
  token: string
  fetchImpl?: typeof fetch
  now?: () => number
  /** Live-read budget. Default 800 ms; past it the cache, last-known-good or baked answer. */
  timeoutMs?: number
  /**
   * Read the routes some other way (kenji's own functions call the RPC). Null
   * or a throw counts as a failed live read.
   */
  load?: (app: string, feature: string) => Promise<RoutesResponse | null>
  /**
   * Providers this project must never call (a documented emergency switch,
   * or a provider its privacy policy does not name). Applied to live, cached
   * and baked candidates alike.
   */
  disabledProviders?: readonly string[]
  /** kensaurus-provider-ingest URL; default: `url` with its last path segment swapped. */
  ingestUrl?: string
}

export type CandidatesSource = 'live' | 'cache' | 'last_known_good' | 'baked'

export const DEFAULT_ROUTES_URL =
  'https://jghcferpoaqntpfqvayf.supabase.co/functions/v1/kensaurus-ai-routes'
export const ROUTES_TOKEN_HEADER = 'x-kensaurus-routes-token'

const LIVE_TIMEOUT_MS = 800
const DEFAULT_TTL_MS = 60_000
const MAX_CACHE_KEYS = 500

// ─── Baked last resort ──────────────────────────────────────────────────────

const BAKED: Readonly<Record<Tier, ReadonlyArray<[string, string, Record<string, unknown>]>>> = {
  fast: [
    ['openai', 'gpt-6-luna', { reasoning_effort: 'none' }],
    ['openrouter', 'openai/gpt-6-luna', { reasoning_effort: 'none' }],
    ['anthropic', 'claude-haiku-5-5', { thinking: { type: 'disabled' }, effort: 'low' }],
  ],
  standard: [
    ['openai', 'gpt-6.1-terra', { reasoning_effort: 'low' }],
    ['openrouter', 'openai/gpt-6.1-terra', { reasoning_effort: 'low' }],
    ['anthropic', 'claude-sonnet-5-5', { effort: 'low' }],
  ],
  premium: [
    // gpt-6.2-sol answers 400 to reasoning effort 'none' ("Reasoning is mandatory").
    ['openai', 'gpt-6.2-sol', { reasoning_effort: 'low' }],
    ['openrouter', 'openai/gpt-6.2-sol', { reasoning_effort: 'low' }],
    ['anthropic', 'claude-opus-5-5', { effort: 'medium' }],
  ],
}

/** The built-in route when kenji cannot be read and nothing is cached. OpenAI first. */
export function bakedCandidates(tier: Tier): RouteCandidate[] {
  return (BAKED[tier] ?? BAKED.fast).map(([provider, model, params], i) => ({
    priority: i + 1,
    provider,
    model,
    params: structuredClone(params),
    provider_state: 'ok',
  }))
}

// ─── Reading the routes ─────────────────────────────────────────────────────

interface CacheEntry {
  at: number
  ttlMs: number
  candidates: RouteCandidate[]
}
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<RouteCandidate[] | null>>()

function isCandidate(c: unknown): c is RouteCandidate {
  const r = c as RouteCandidate
  return (
    !!r &&
    typeof r.priority === 'number' &&
    typeof r.provider === 'string' &&
    r.provider.length > 0 &&
    typeof r.model === 'string' &&
    r.model.length > 0 &&
    !!r.params &&
    typeof r.params === 'object' &&
    !Array.isArray(r.params)
  )
}

async function readLive(
  cfg: RoutesConfig,
  app: string,
  feature: string,
): Promise<{
  candidates: RouteCandidate[]
  ttlMs: number
} | null> {
  const timeoutMs = cfg.timeoutMs ?? LIVE_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, timeoutMs)
  })
  const attempt = (async (): Promise<RoutesResponse | null> => {
    if (cfg.load) return await cfg.load(app, feature)
    if (!cfg.url || !cfg.token) return null
    const u = new URL(cfg.url)
    u.searchParams.set('app', app)
    u.searchParams.set('feature', feature)
    const res = await (cfg.fetchImpl ?? fetch)(u.toString(), {
      method: 'GET',
      headers: { [ROUTES_TOKEN_HEADER]: cfg.token },
      signal: controller.signal,
    })
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    return (await res.json()) as RoutesResponse
  })().catch(() => null)
  try {
    const body = await Promise.race([attempt, deadline])
    const list = Array.isArray(body?.candidates) ? body!.candidates.filter(isCandidate) : []
    if (list.length === 0) return null
    const ttl =
      typeof body?.ttl_s === 'number' && body.ttl_s > 0 ? body.ttl_s * 1000 : DEFAULT_TTL_MS
    return { candidates: list, ttlMs: Math.min(ttl, 10 * DEFAULT_TTL_MS) }
  } finally {
    clearTimeout(timer)
  }
}

function withoutDisabled(cfg: RoutesConfig, list: RouteCandidate[]): RouteCandidate[] {
  const off = cfg.disabledProviders
  return off && off.length ? list.filter((c) => !off.includes(c.provider)) : list
}

/**
 * The routes for (app, feature): live → cache (fresh) → last-known-good (any
 * age) → baked for `tier`. Never throws and never returns an empty list: an
 * app or feature with no rows (and no '*' rows) gets the baked candidates.
 * `tier` is used only for baked.
 */
export async function getRouteCandidates(
  cfg: RoutesConfig,
  app: string,
  feature: string,
  tier: Tier,
): Promise<{ candidates: RouteCandidate[]; source: CandidatesSource }> {
  const now = (cfg.now ?? Date.now)()
  const key = `${app}\u0000${feature}`
  const hit = cache.get(key)
  if (hit && now - hit.at < hit.ttlMs) {
    const list = withoutDisabled(cfg, clone(hit.candidates))
    if (list.length) return { candidates: list, source: 'cache' }
  }
  // One live read per key at a time; concurrent callers share it.
  let pending = inflight.get(key)
  if (!pending) {
    pending = readLive(cfg, app, feature)
      .then((live) => {
        if (!live) return null
        cache.delete(key)
        cache.set(key, {
          at: (cfg.now ?? Date.now)(),
          ttlMs: live.ttlMs,
          candidates: live.candidates,
        })
        while (cache.size > MAX_CACHE_KEYS) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
        return live.candidates
      })
      .catch(() => null)
      .finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  const live = await pending
  if (live) {
    const list = withoutDisabled(cfg, clone(live))
    if (list.length) return { candidates: list, source: 'live' }
  }
  if (hit) {
    const list = withoutDisabled(cfg, clone(hit.candidates))
    if (list.length) return { candidates: list, source: 'last_known_good' }
  }
  return { candidates: bakedFor(cfg, tier), source: 'baked' }
}

/**
 * Baked for `tier`, minus disabledProviders. Never empty: if the project's
 * switch removes every baked provider, the OpenAI candidate alone is kept
 * (every app's policy names OpenAI), so a call always has a route.
 */
function bakedFor(cfg: RoutesConfig, tier: Tier): RouteCandidate[] {
  const baked = bakedCandidates(tier)
  const list = withoutDisabled(cfg, baked)
  return list.length ? list : baked.filter((c) => c.provider === 'openai')
}

function clone(list: RouteCandidate[]): RouteCandidate[] {
  return list.map((c) => ({ ...c, params: structuredClone(c.params) }))
}

// ─── Breaker and order ──────────────────────────────────────────────────────

export type CallOutcome =
  | 'ok'
  | 'payment'
  | 'auth'
  | 'outage'
  | 'rate_limit'
  | 'timeout'
  | 'config'
  | 'other'

const TRIP_AFTER = 3
const TRIP_WINDOW_MS = 5 * 60_000
const TRIP_FOR_MS = 10 * 60_000
const TRIPPING: readonly CallOutcome[] = ['payment', 'auth', 'outage']
const failures = new Map<string, number[]>()
const trippedUntil = new Map<string, number>()
let clock: () => number = () => Date.now()

/** Record how a call to `provider` ended. Feeds the per-isolate breaker. */
export function noteOutcome(provider: string, outcome: CallOutcome): void {
  const now = clock()
  if (outcome === 'ok') {
    failures.delete(provider)
    trippedUntil.delete(provider)
    return
  }
  if (!TRIPPING.includes(outcome)) return
  const recent = (failures.get(provider) ?? []).filter((t) => now - t < TRIP_WINDOW_MS)
  recent.push(now)
  failures.set(provider, recent)
  if (recent.length >= TRIP_AFTER) trippedUntil.set(provider, now + TRIP_FOR_MS)
}

/** True while the breaker holds `provider` back. */
export function isTripped(provider: string): boolean {
  const until = trippedUntil.get(provider)
  if (until === undefined) return false
  if (clock() < until) return true
  trippedUntil.delete(provider)
  failures.delete(provider)
  return false
}

/**
 * The order to try: by priority, healthy first; a provider the watch marks
 * `down` or the breaker has tripped goes last (still tried, never dropped).
 */
export function orderCandidates(c: RouteCandidate[]): RouteCandidate[] {
  const sorted = [...c].sort((a, b) => a.priority - b.priority)
  const held = (x: RouteCandidate) => x.provider_state === 'down' || isTripped(x.provider)
  return [...sorted.filter((x) => !held(x)), ...sorted.filter(held)]
}

// ─── Classifying and reporting a failed call ────────────────────────────────

/** Lower-case substrings that mean "this account needs money", whatever the status. */
const PAYMENT_MARKERS: readonly string[] = [
  'credit balance is too low',
  'api usage limits',
  'usage limit',
  'enforced_spend_limit_reached',
  'billing_error',
  'insufficient_quota',
  'billing_hard_limit',
  'billing_not_active',
  'quota_exceeded',
  'exceeds your quota',
  'exhausted balance',
  'user is locked',
  'insufficient credits',
  'requires more credits',
]

/** Anthropic's real answer for an empty prepaid balance (HTTP 400), for tests and drills. */
export const ANTHROPIC_LOW_CREDIT_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message:
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
})

/**
 * What a failed provider call was. `status` 0 means no HTTP answer (network
 * error); 408 or an abort is a timeout. The body is scanned for a payment
 * marker before the status is trusted: Anthropic answers an empty balance
 * with 400, ElevenLabs with 401, fal with 403, OpenRouter with 402.
 */
export function classifyProviderError(status: number, body: string): CallOutcome {
  const text = (body ?? '').slice(0, 2000).toLowerCase()
  if (text && PAYMENT_MARKERS.some((m) => text.includes(m))) return 'payment'
  if (status === 402) return 'payment'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'config'
  if (status === 429) return 'rate_limit'
  if (status === 408) return 'timeout'
  if (status === 0) return text.includes('timeout') || text.includes('abort') ? 'timeout' : 'outage'
  if (status >= 500) return 'outage'
  return 'other'
}

/** The classes a person must fix; only these are reported. */
export const REPORTED_OUTCOMES: readonly CallOutcome[] = ['auth', 'payment', 'config']

const REPORT_EVERY_MS = 60_000
const lastReport = new Map<string, number>()

function ingestUrlOf(cfg: RoutesConfig): string {
  if (cfg.ingestUrl) return cfg.ingestUrl
  const base = cfg.url || DEFAULT_ROUTES_URL
  return base.replace(/\/[^/]*$/, '/kensaurus-provider-ingest')
}

/**
 * Report a failed call a person must fix (auth, payment, config) to kenji's
 * kensaurus-provider-ingest: it opens or bumps the incident, which posts to
 * Slack #alerts and Mushi ops. Other classes are ignored. Never throws; one
 * report per (project, provider, class) per minute per isolate. Only names
 * and the status leave: never a body, a prompt or a key.
 */
export async function reportProviderFailure(
  cfg: RoutesConfig,
  r: {
    project: string
    app: string
    feature: string
    provider: string
    model: string
    class: string
    status?: number
  },
): Promise<void> {
  if (!(REPORTED_OUTCOMES as readonly string[]).includes(r.class)) return
  if (!cfg.token) return
  const now = (cfg.now ?? Date.now)()
  const key = `${r.project}:${r.provider}:${r.class}`
  const last = lastReport.get(key)
  if (last !== undefined && now - last < REPORT_EVERY_MS) return
  lastReport.set(key, now)
  try {
    const res = await (cfg.fetchImpl ?? fetch)(ingestUrlOf(cfg), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [ROUTES_TOKEN_HEADER]: cfg.token },
      body: JSON.stringify({
        project: r.project,
        incidents: [
          {
            provider: r.provider,
            class: r.class,
            app: r.app,
            feature: r.feature,
            model: r.model,
            http_status: typeof r.status === 'number' && r.status > 0 ? r.status : null,
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) lastReport.delete(key)
    await res.body?.cancel().catch(() => undefined)
  } catch {
    lastReport.delete(key)
  }
}

// ─── Drill ──────────────────────────────────────────────────────────────────

/**
 * The drill hook (CONTRACT §4): with `drill` = "<provider>:payment" (from
 * KENSAURUS_LLM_DRILL, honoured by the executor only for a call that carries
 * `drill: true`, or in tests), the executor treats `provider` as answering
 * Anthropic's low-credit 400 instead of calling it. Null when not drilled.
 */
export function drillFailure(
  drill: string | null | undefined,
  provider: string,
): { status: number; body: string } | null {
  if (!drill) return null
  const [p, kind] = drill.split(':')
  if (p !== provider) return null
  if (kind === 'payment') return { status: 400, body: ANTHROPIC_LOW_CREDIT_BODY }
  if (kind === 'auth') return { status: 401, body: '{"error":{"type":"authentication_error"}}' }
  if (kind === 'outage') return { status: 503, body: '{"error":{"type":"overloaded_error"}}' }
  return null
}

// ─── Test seams ─────────────────────────────────────────────────────────────

/** Forget the cache, the breaker and the report throttle; optionally fix the clock. */
export function resetRoutesClient(opts: { clock?: () => number } = {}): void {
  cache.clear()
  inflight.clear()
  failures.clear()
  trippedUntil.clear()
  lastReport.clear()
  clock = opts.clock ?? (() => Date.now())
}
