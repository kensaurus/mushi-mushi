/**
 * FILE: packages/server/supabase/functions/_shared/llm-cost.ts
 * PURPOSE: What one model call cost, from the shared KENSAURUS price book.
 *
 * Mushi Mushi keeps no price table of its own (owner rule, 2026-11-25: never
 * hard-code a price). Every cost comes from `priceFor` in the vendored
 * `kensaurus-spine/price.ts` (the KENSAURUS spine), reading the catalog in Supabase project
 * kensaurus-shared through the kensaurus-wallet-api `price` action (the same
 * bridge hosted billing uses: KENSAURUS_WALLET_URL +
 * KENSAURUS_WALLET_INTERNAL_TOKEN). Rows are cached for 5 minutes per isolate.
 *
 * A call the book cannot price is `unpriced`: costUsd is null and
 * `unpricedReason` says why. It is never $0 and never a fallback rate. A
 * self-hosted install without the bridge has no price source, so its calls
 * are unpriced with that reason, and the Costs page says so.
 *
 * Zero usage (a failed call, the heuristic Stage 1 path) is $0 with source
 * `no_usage`: no rate is involved, so nothing is invented.
 *
 * Provider: a bare `claude-*` id is Anthropic, a bare `gpt-*` / `o1*` /
 * `text-embedding-*` id is OpenAI, and an id with a vendor prefix
 * (`openai/gpt-5.4`) went through OpenRouter, whose catalog rows carry the
 * prefixed id. Callers that know better pass `provider`.
 */

import {
  isUnpriced,
  makeRemotePriceSource,
  priceFor,
  type PriceSource,
  type PriceUsage,
} from './kensaurus-spine/price.ts'

export interface LlmCostInput {
  model: string | null | undefined
  /** Defaults to the provider named by the model id. */
  provider?: string
  inputTokens?: number | null
  outputTokens?: number | null
  /** Prompt-cache hits. OpenAI counts them inside inputTokens; Anthropic does not. */
  cacheReadTokens?: number | null
  /** Anthropic prompt-cache writes (5-minute TTL, the default Mushi uses). */
  cacheWriteTokens?: number | null
  /** Seconds, characters or other units for a model not priced per token. */
  units?: number | null
  /** When the call happened. Default: now. */
  at?: Date | string
}

export interface LlmCost {
  /** USD, or null when unpriced. */
  costUsd: number | null
  /** The price row's source (pricing_page, vendor_api, legacy, …), `no_usage`, or null when unpriced. */
  source: string | null
  /** The price row's effective_from, or null. */
  version: string | null
  /** 'base' or the prompt-size tier that applied, or null. */
  tier: string | null
  /** Why the call could not be priced; null when priced. */
  unpricedReason: string | null
  provider: string
  model: string
}

/** The provider a model id belongs to, or 'unknown'. */
export function providerForModel(model: string | null | undefined): string {
  const id = (model ?? '').trim().toLowerCase()
  if (id.includes('/')) return 'openrouter'
  if (id.startsWith('claude-')) return 'anthropic'
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('text-embedding-')) return 'openai'
  return 'unknown'
}

function count(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** The priceFor usage for one call. Pure; exported for tests and the re-cost script. */
export function priceUsageFor(provider: string, input: LlmCostInput): PriceUsage {
  const cachedRead = count(input.cacheReadTokens)
  const inputTokens = count(input.inputTokens)
  const usage: PriceUsage = {
    // Token kinds are additive in the price book: OpenAI's input_tokens
    // already includes the cached tokens, Anthropic's does not.
    input: provider === 'anthropic' ? inputTokens : Math.max(0, inputTokens - cachedRead),
    output: count(input.outputTokens),
    cachedRead,
    cacheWrite5m: count(input.cacheWriteTokens),
  }
  // Units (audio seconds, characters) may be fractional; the book rounds the cost up.
  const units = input.units
  if (typeof units === 'number' && Number.isFinite(units) && units > 0) usage.units = units
  return usage
}

function hasUsage(u: PriceUsage): boolean {
  return Boolean(u.input || u.output || u.cachedRead || u.cacheWrite5m || u.cacheWrite1h || u.units)
}

const NO_SOURCE = 'no price source: KENSAURUS_WALLET_URL and KENSAURUS_WALLET_INTERNAL_TOKEN are not set'
const PRICE_TIMEOUT_MS = 4_000

let source: PriceSource | null = null

function env(name: string): string {
  try {
    return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name) ?? ''
  } catch {
    return ''
  }
}

function defaultSource(): PriceSource {
  const url = env('KENSAURUS_WALLET_URL')
  const internalToken = env('KENSAURUS_WALLET_INTERNAL_TOKEN')
  if (!url || !internalToken) {
    return { book: () => Promise.reject(new Error(NO_SOURCE)) }
  }
  return makeRemotePriceSource({
    url,
    internalToken,
    externalProject: 'mushi',
    // The bridge answers in well under a second; a hung lookup must not
    // hold up the call it is pricing.
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(PRICE_TIMEOUT_MS) })) as typeof fetch,
  })
}

function priceSource(): PriceSource {
  source ??= defaultSource()
  return source
}

/**
 * True when a call is unpriced only because the price book could not be
 * reached (bridge down, timeout, no source configured), not because it has
 * no price. Such rows are re-priced later (repriceTransientInvocations).
 */
export function isTransientUnpriced(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.startsWith('price lookup failed')
}

/** Tests and the re-cost script swap the source (a fixture book, or null to reset). */
export function setLlmPriceSource(next: PriceSource | null): void {
  source = next
}

/** Price one call. Never throws: a failed lookup is `unpriced` with the reason. */
export async function priceLlmCall(input: LlmCostInput): Promise<LlmCost> {
  const raw = (input.model ?? '').trim()
  const provider = input.provider ?? providerForModel(raw)
  const model = raw.includes('/') ? raw : raw.toLowerCase()
  const usage = priceUsageFor(provider, input)
  if (!hasUsage(usage)) {
    return { costUsd: 0, source: 'no_usage', version: null, tier: null, unpricedReason: null, provider, model }
  }
  if (!model || provider === 'unknown') {
    return {
      costUsd: null, source: null, version: null, tier: null, provider, model,
      unpricedReason: `no provider known for model "${model.slice(0, 80)}"`,
    }
  }
  const r = await priceFor({ provider, model, usage, at: input.at }, priceSource())
  if (isUnpriced(r)) {
    return { costUsd: null, source: null, version: null, tier: null, unpricedReason: r.reason.slice(0, 300), provider, model }
  }
  return {
    costUsd: r.micros / 1_000_000,
    source: r.origin === 'override' ? `override:${r.source}`.slice(0, 60) : r.source,
    version: r.version,
    tier: r.tier,
    unpricedReason: null,
    provider,
    model,
  }
}

/**
 * The model ids Mushi Mushi knows how to call. A model registry, not a price
 * list: prices live in the catalog. `servedModel` keeps a provider-reported
 * id only when it is one of these (a dated `gpt-4.1-2025-04-14` would not
 * match any catalog row), and PDCA validates its Claude choices against it.
 */
export const KNOWN_MODEL_IDS: ReadonlySet<string> = new Set([
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-6',
  'claude-haiku-3-5',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-6',
  'claude-sonnet-3-7',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-5',
  'gpt-5.4',
  'gpt-6.2-sol',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-luna',
  'gpt-6-astra',
  'gpt-5.4-mini',
  'gpt-transcribe',
  'gpt-4o-mini-transcribe',
  'text-embedding-3-small',
  'text-embedding-3-large',
])

/** True when `model` (with or without a vendor prefix) is a model Mushi knows. */
export function isKnownModel(model: string): boolean {
  const key = model.toLowerCase()
  const bare = key.includes('/') ? key.split('/').slice(-1)[0] : key
  return KNOWN_MODEL_IDS.has(bare)
}

/** Tokens and cost of one model's calls within one run. */
export interface ModelUsageRow {
  model: string
  inputTokens: number
  outputTokens: number
  /** null when any call of this model was unpriced. */
  costUsd: number | null
  unpricedReason: string | null
}

/**
 * Usage of a run that can call more than one model (a Claude call with an
 * OpenAI fallback), kept per model. Write one `llm_cost_usd` row per model:
 * a compound id such as `claude-sonnet-5-5+gpt-5.4-mini` would be a cost
 * bucket of its own and would never match a model filter.
 */
export class UsageByModel {
  private readonly totals = new Map<string, ModelUsageRow>()
  private readonly pending: Promise<void>[] = []

  record(model: string, inputTokens: number, outputTokens: number): void {
    const row = this.totals.get(model) ?? { model, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedReason: null }
    row.inputTokens += inputTokens
    row.outputTokens += outputTokens
    this.totals.set(model, row)
    this.pending.push(
      priceLlmCall({ model, inputTokens, outputTokens }).then((c) => {
        if (c.costUsd === null) {
          row.costUsd = null
          row.unpricedReason ??= c.unpricedReason
        } else if (row.costUsd !== null) {
          row.costUsd += c.costUsd
        }
      }),
    )
  }

  /** One row per model used, in the order each was first used, once every call is priced. */
  async rows(): Promise<ModelUsageRow[]> {
    await Promise.all(this.pending)
    return [...this.totals.values()].map((r) => ({ ...r }))
  }

  /** Sum of the priced models; null when any model was unpriced. */
  async totalCostUsd(): Promise<number | null> {
    let sum = 0
    for (const r of await this.rows()) {
      if (r.costUsd === null) return null
      sum += r.costUsd
    }
    return sum
  }
}
