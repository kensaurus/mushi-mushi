/**
 * FILE: _shared/kensaurus-ai-routes-client.ts
 *
 * PLACEHOLDER (mushi, 2026-11-21): written to the KENSAURUS AI routes contract
 * (scratchpad CONTRACT.md §2) until llm-router publishes the canonical copy
 * (yen-yen supabase/functions/_shared/). Replace this file byte-identically
 * with that copy; the exported names and shapes below are the contract's.
 *
 * Which provider and model each platform-key LLM call uses, from kenji
 * `kensaurus_ai_routes`. Runtime-neutral: fetch only, no Deno or process
 * globals (the caller passes the env values in).
 */

export type Tier = 'fast' | 'standard' | 'premium'

export interface RouteCandidate {
  priority: number
  provider: string
  model: string
  params: Record<string, unknown>
  provider_state?: 'ok' | 'degraded' | 'down'
}

export interface RoutesConfig {
  url: string
  token: string
  fetchImpl?: typeof fetch
  now?: () => number
}

export type RouteSource = 'live' | 'cache' | 'last_known_good' | 'baked'

const TTL_MS = 60_000
const LIVE_TIMEOUT_MS = 800
const cache = new Map<string, { at: number; candidates: RouteCandidate[] }>()

/** The built-in last resort when kenji is unreachable. OpenAI first. */
export function bakedCandidates(tier: Tier): RouteCandidate[] {
  const models: Record<Tier, [string, string]> = {
    fast: ['gpt-6-luna', 'claude-haiku-5-5'],
    standard: ['gpt-6.1-terra', 'claude-sonnet-5-5'],
    premium: ['gpt-6.2-sol', 'claude-opus-5-5'],
  }
  const [gpt, claude] = models[tier]
  return [
    { priority: 1, provider: 'openai', model: gpt, params: {} },
    { priority: 2, provider: 'openrouter', model: `openai/${gpt}`, params: {} },
    { priority: 3, provider: 'anthropic', model: claude, params: {} },
  ]
}

/** live → 60 s cache → last-known-good (any age) → baked. Never throws. */
export async function getRouteCandidates(
  cfg: RoutesConfig,
  app: string,
  feature: string,
  tier: Tier,
): Promise<{ candidates: RouteCandidate[]; source: RouteSource }> {
  const now = (cfg.now ?? Date.now)()
  const key = `${app}\u0000${feature}`
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return { candidates: hit.candidates, source: 'cache' }
  if (cfg.url && cfg.token) {
    try {
      const url = `${cfg.url}?app=${encodeURIComponent(app)}&feature=${encodeURIComponent(feature)}`
      const res = await (cfg.fetchImpl ?? fetch)(url, {
        headers: { 'x-kensaurus-internal-token': cfg.token },
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      })
      if (res.ok) {
        const body = (await res.json()) as { candidates?: RouteCandidate[] }
        if (Array.isArray(body.candidates) && body.candidates.length > 0) {
          cache.set(key, { at: now, candidates: body.candidates })
          return { candidates: body.candidates, source: 'live' }
        }
      }
    } catch {
      // Fall through to the last-known-good copy, then the baked list.
    }
  }
  if (hit) return { candidates: hit.candidates, source: 'last_known_good' }
  return { candidates: bakedCandidates(tier), source: 'baked' }
}

const WINDOW_MS = 5 * 60_000
const BENCH_MS = 10 * 60_000
const failures = new Map<string, number[]>()
const benchedUntil = new Map<string, number>()

/** Per-isolate circuit breaker: 3 payment/auth/outage failures in 5 min → that provider goes last for 10 min. */
export function noteOutcome(
  provider: string,
  outcome: 'ok' | 'payment' | 'auth' | 'outage' | 'rate_limit' | 'timeout' | 'config' | 'other',
): void {
  const now = Date.now()
  if (outcome === 'ok') {
    failures.delete(provider)
    return
  }
  if (outcome !== 'payment' && outcome !== 'auth' && outcome !== 'outage') return
  const recent = (failures.get(provider) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  failures.set(provider, recent)
  if (recent.length >= 3) benchedUntil.set(provider, now + BENCH_MS)
}

/** Priority order, with `down` providers and benched ones last. */
export function orderCandidates(c: RouteCandidate[]): RouteCandidate[] {
  const now = Date.now()
  const last = (x: RouteCandidate) => x.provider_state === 'down' || (benchedUntil.get(x.provider) ?? 0) > now
  return [...c].sort((a, b) => Number(last(a)) - Number(last(b)) || a.priority - b.priority)
}

/** Fire-and-forget report of a failed provider call to kenji kensaurus-provider-ingest. */
export async function reportProviderFailure(
  cfg: RoutesConfig,
  r: { project: string; app: string; feature: string; provider: string; model: string; class: string; status?: number },
): Promise<void> {
  if (!cfg.url || !cfg.token) return
  if (r.class !== 'auth' && r.class !== 'payment' && r.class !== 'config') return
  try {
    const url = cfg.url.replace(/kensaurus-ai-routes\/?$/, 'kensaurus-provider-ingest')
    await (cfg.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kensaurus-internal-token': cfg.token },
      body: JSON.stringify(r),
      signal: AbortSignal.timeout(2_000),
    })
  } catch {
    // Reporting never turns into a failed call.
  }
}

/** Classifies a provider error. Anthropic "credit balance is too low" (400) → 'payment'. */
export function classifyProviderError(status: number, body: string): string {
  const b = body.toLowerCase()
  if (status === 402 || b.includes('credit balance is too low') || b.includes('insufficient_quota') || b.includes('insufficient credits')) return 'payment'
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 404 && b.includes('model')) return 'config'
  if (status >= 500) return 'outage'
  return 'other'
}

/** Forget cached routes and breaker state (tests). */
export function resetRoutesClient(): void {
  cache.clear()
  failures.clear()
  benchedUntil.clear()
}
