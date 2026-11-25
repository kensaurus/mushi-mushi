/**
 * FILE: packages/server/supabase/functions/_shared/vendor-cost.ts
 * PURPOSE: The cost a provider reports for a call, which beats any catalog
 *          estimate (cost catalog program, 2026-11-25).
 *
 * OpenRouter returns the cost in every non-streaming chat completion's
 * `usage` (usage accounting, docs read 2026-11-25: "Full usage details are
 * always included automatically in every response"; `usage.cost` is in
 * credits, 1 credit = 1 USD). On a BYOK route `usage.cost` is only
 * OpenRouter's fee and the provider's charge is
 * `cost_details.upstream_inference_cost`; when that is missing the total is
 * unknown and no actual cost is recorded (the catalog prices the call).
 *
 * `withOpenRouterCostCapture` wraps the OpenAI-compatible client's fetch for
 * OpenRouter keys, reads that cost off the response, and keeps it here keyed
 * by the generation id (`gen-…`, which the AI SDK exposes as
 * `result.response.id`). `buildLlmUsageRecord` takes it back when it writes
 * the row. Same isolate, same request; bounded and short-lived. npm-free.
 */

const MAX_ENTRIES = 500
const TTL_MS = 10 * 60_000
const costs = new Map<string, { usd: number; at: number }>()

/** The total USD one OpenRouter usage object reports, or null when it is not knowable. Pure. */
export function openRouterUsageCostUsd(usage: unknown): number | null {
  const u = (usage ?? null) as { cost?: unknown; is_byok?: unknown; cost_details?: { upstream_inference_cost?: unknown } } | null
  if (!u || typeof u.cost !== 'number' || !Number.isFinite(u.cost) || u.cost < 0) return null
  if (u.is_byok === true) {
    const upstream = u.cost_details?.upstream_inference_cost
    if (typeof upstream !== 'number' || !Number.isFinite(upstream) || upstream < 0) return null
    return u.cost + upstream
  }
  return u.cost
}

export function rememberVendorCost(id: string, usd: number, now = Date.now()): void {
  if (costs.size >= MAX_ENTRIES) {
    for (const [k, v] of costs) {
      if (now - v.at > TTL_MS || costs.size >= MAX_ENTRIES) costs.delete(k)
      if (costs.size < MAX_ENTRIES) break
    }
  }
  costs.set(id, { usd, at: now })
}

/** The cost recorded for this generation id, once; null when none (or too old). */
export function takeVendorCost(id: string | null | undefined, now = Date.now()): number | null {
  if (!id) return null
  const hit = costs.get(id)
  if (!hit) return null
  costs.delete(id)
  return now - hit.at > TTL_MS ? null : hit.usd
}

/**
 * fetch wrapper for an OpenRouter key: remembers each non-streaming chat
 * completion's reported cost by its generation id. Never changes the request
 * or the response the caller sees.
 */
export function withOpenRouterCostCapture(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!res.ok || !url.endsWith('/chat/completions')) return res
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return res
    try {
      const body = (await res.clone().json()) as { id?: unknown; usage?: unknown }
      const usd = openRouterUsageCostUsd(body.usage)
      if (typeof body.id === 'string' && usd !== null) rememberVendorCost(body.id, usd)
    } catch {
      // A body we cannot read just means no actual cost; the catalog prices the call.
    }
    return res
  }) as typeof fetch
}
