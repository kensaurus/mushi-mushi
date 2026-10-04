/**
 * FILE: _shared/provider-credits.ts
 * PURPOSE: Remaining credits for a BYOK key, read from the provider itself,
 *          for the providers that publish one.
 *
 * Checked against the providers' docs on 2026-10-04:
 *   - Firecrawl: GET https://api.firecrawl.dev/v2/team/credit-usage
 *     → { data: { remainingCredits, planCredits, billingPeriodStart, billingPeriodEnd } }
 *   - OpenRouter (an OpenAI-compatible key whose base URL is openrouter.ai):
 *     GET https://openrouter.ai/api/v1/key → { data: { limit, limit_remaining,
 *     usage, … } }. limit_remaining is null when the key has no cap; the
 *     account balance (/api/v1/credits) needs a management key, so it is not read.
 *   - Anthropic and OpenAI: no balance endpoint for an inference key (Anthropic's
 *     cost report needs an Admin key; OpenAI has none), so these say so instead
 *     of guessing.
 *
 * Every call is a free read with a short timeout. Nothing here throws.
 */

export type CreditsResult =
  | {
      kind: 'credits'
      /** What remains; null when the key has no cap (OpenRouter). */
      remaining: number | null
      unit: 'credits' | 'usd'
      /** Plan or key allowance, when the provider gives one. */
      limit: number | null
      /** Spent so far in the period, when the provider gives it. */
      used: number | null
      periodEnd: string | null
      source: string
    }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; message: string }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 8_000

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; status: number; message: string }
> {
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) }
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, status: res.status, message: text.slice(0, 160) || res.statusText }
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' ? { ok: true, body } : { ok: false, status: res.status, message: 'not JSON' }
  } catch {
    return { ok: false, status: res.status, message: 'not JSON' }
  }
}

/** True when an OpenAI-compatible base URL points at OpenRouter. */
export function isOpenRouterBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

export async function fetchProviderCredits(
  provider: string,
  secret: string,
  baseUrl: string | null | undefined,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<CreditsResult> {
  if (provider === 'firecrawl') {
    const r = await getJson(fetchImpl, 'https://api.firecrawl.dev/v2/team/credit-usage', { Authorization: `Bearer ${secret}` })
    if (!r.ok) return { kind: 'error', message: `Firecrawl answered ${r.status || 'no response'}: ${r.message}` }
    const d = (r.body.data ?? {}) as Record<string, unknown>
    const remaining = num(d.remainingCredits) ?? num(d.remaining_credits)
    if (remaining === null) return { kind: 'error', message: 'Firecrawl did not say how many credits remain.' }
    const limit = num(d.planCredits) ?? num(d.plan_credits)
    return {
      kind: 'credits',
      remaining,
      unit: 'credits',
      limit,
      used: limit !== null ? Math.max(0, limit - remaining) : null,
      periodEnd: typeof d.billingPeriodEnd === 'string' ? d.billingPeriodEnd : null,
      source: 'Firecrawl /v2/team/credit-usage',
    }
  }

  if (provider === 'openrouter' || (provider === 'openai' && isOpenRouterBaseUrl(baseUrl))) {
    const r = await getJson(fetchImpl, 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${secret}` })
    if (!r.ok) return { kind: 'error', message: `OpenRouter answered ${r.status || 'no response'}: ${r.message}` }
    const d = (r.body.data ?? {}) as Record<string, unknown>
    return {
      kind: 'credits',
      remaining: num(d.limit_remaining),
      unit: 'usd',
      limit: num(d.limit),
      used: num(d.usage),
      periodEnd: null,
      source: 'OpenRouter /api/v1/key',
    }
  }

  const reasons: Record<string, string> = {
    anthropic: 'Anthropic does not report a balance to an API key (its cost report needs an Admin key). Check console.anthropic.com → Billing.',
    openai: 'OpenAI has no API for the remaining balance. Check platform.openai.com → Billing.',
    cursor: 'Cursor does not report remaining usage through the API key. Check cursor.com → Dashboard → Usage.',
    supabase: 'A Supabase token has no credit balance.',
    browserbase: 'Browserbase usage is not read yet. Check browserbase.com → Usage.',
  }
  return { kind: 'unavailable', reason: reasons[provider] ?? 'This provider does not publish a balance.' }
}
