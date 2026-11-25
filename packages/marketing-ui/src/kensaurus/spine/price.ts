/**
 * KENSAURUS price book: what one provider call cost, from the shared catalog.
 *
 * SOURCE: kensaurus/yen-yen kensaurus-spine/price.ts. scripts/spine-sync.mjs
 * vendors it byte for byte into both bundles (the app spine and the edge
 * bundle next to wallet.ts), and check-spine.mjs fails CI on an edited copy
 * (ADR 0014). Edit it here and re-sync; never edit a vendored copy.
 * It imports nothing, so Node, Deno, the browser and React Native all run it.
 *
 * The data lives in Supabase project kensaurus-shared (kenji):
 *   kensaurus_model_prices    the catalog: one row per (provider, model,
 *                             effective_from), append-only. Refreshed by the
 *                             daily price-sync function.
 *   kensaurus_price_overrides plan-specific rates (a Firecrawl or ElevenLabs
 *                             plan's price per credit, a negotiated rate).
 *                             An override in force always beats the catalog.
 *   kensaurus_price_at(...)   the same rule in SQL, for SQL readers.
 *
 * The rule, in order:
 *   1. An override for (provider, model) in force at `at`
 *      (effective_from <= at < effective_to), the latest one.
 *   2. Else the catalog row with the latest effective_from <= at.
 *   3. The tier: the row's `tiers` entry with the highest
 *      `when.prompt_tokens_gt` below the request's prompt size, else the base
 *      rates. A tier states its own rates; it never borrows the base ones.
 *   4. Anything missing is `unpriced` with a reason. Never $0, never a
 *      fallback rate: a null rate with tokens of that kind is unpriced.
 *
 * Money is integer micro-USD. Rates are micro-USD per 1M tokens (tokens) or
 * per single unit (chars, seconds, credits, …). Token math is exact BigInt;
 * the total is rounded UP once, like the wallet has always done.
 *
 * API (what the adoption waves call):
 *
 *   const prices = makeDbPriceSource(admin)              // service-role client on kenji
 *   const prices = makeRemotePriceSource({ url, routesToken, externalProject })
 *                                                        // any other project, via kensaurus-wallet-api
 *                                                        // (routesToken read-only, or internalToken)
 *   const r = await priceFor(
 *     { provider: 'anthropic', model: 'claude-haiku-5-5',
 *       usage: { input: 1200, output: 300, cachedRead: 0, cacheWrite5m: 0 } },
 *     prices,
 *   )
 *   if ('unpriced' in r) refuse(r.reason)
 *   else record(r.micros, r.source, r.version, r.tier)
 *
 *   priceFromRows(request, book)   the same, pure, over rows you already hold
 */

export type PriceUnitKind =
  | 'tokens'
  | 'chars'
  | 'seconds'
  | 'credits'
  | 'images'
  | 'requests'
  | 'megapixels'

/** The rate fields a row or a tier can carry, micro-USD per 1M tokens. */
export interface TokenRates {
  input_per_mtok_micro?: number | null
  output_per_mtok_micro?: number | null
  cached_input_per_mtok_micro?: number | null
  cache_write_5m_per_mtok_micro?: number | null
  cache_write_1h_per_mtok_micro?: number | null
}

/** One prompt-size tier, e.g. Haiku 5.5 above 100,000 prompt tokens. */
export interface PriceTier extends TokenRates {
  when: { prompt_tokens_gt: number }
}

/** A catalog or override row, in the shape both tables and the SQL function return. */
export interface PriceBookRow extends TokenRates {
  provider: string
  model: string
  unit_kind: PriceUnitKind | string
  per_unit_micro?: number | null
  tiers?: PriceTier[] | null
  effective_from: string
  /** Overrides only: the rate stops applying here (exclusive). */
  effective_to?: string | null
  /** Where the number came from: vendor_api, pricing_page, catalog:openrouter, manual, … */
  source?: string | null
  /** Set by readers: which table the row came from. */
  origin?: 'override' | 'catalog'
}

/** Every row for one (provider, model), from both tables. Order does not matter. */
export interface PriceBook {
  overrides: PriceBookRow[]
  catalog: PriceBookRow[]
}

/**
 * Token and unit counts for one call. Token kinds are ADDITIVE: `input` is the
 * uncached input only (OpenAI's input_tokens includes cached tokens, so
 * subtract them first), `cachedRead` the cache hits, `cacheWrite5m` /
 * `cacheWrite1h` the tokens written to the prompt cache with that TTL.
 */
export interface PriceUsage {
  input?: number
  output?: number
  cachedRead?: number
  cacheWrite5m?: number
  cacheWrite1h?: number
  /**
   * The prompt size that picks the tier. Default: input + cachedRead +
   * cacheWrite5m + cacheWrite1h, which is how Anthropic counts it ("a
   * request's prompt length counts all of its input tokens, including cache
   * reads and cache writes", pricing page, read 2026-11-25).
   */
  promptTokens?: number
  /** Chars, seconds, credits, images, … for a per-unit row. */
  units?: number
}

export interface PriceRequest {
  provider: string
  model: string
  usage: PriceUsage
  /** When the call happened. Default: now. */
  at?: Date | string
}

export interface Priced {
  /** Provider cost, integer micro-USD, rounded up. */
  micros: number
  /** The row's source (vendor_api, pricing_page, …), or 'legacy' for a hand-entered row. */
  source: string
  /** The row's effective_from: store it with the cost to say which price was used. */
  version: string
  /** 'base', or the tier that applied, e.g. 'prompt_tokens_gt:100000'. */
  tier: string
  origin: 'override' | 'catalog'
}

export interface Unpriced {
  unpriced: true
  reason: string
}

export type PriceResult = Priced | Unpriced

export function isUnpriced(r: PriceResult): r is Unpriced {
  return (r as Unpriced).unpriced === true
}

function unpriced(reason: string): Unpriced {
  return { unpriced: true, reason }
}

function atMs(at: Date | string | undefined): number {
  if (at === undefined) return Date.now()
  return typeof at === 'string' ? Date.parse(at) : at.getTime()
}

function inForce(row: PriceBookRow, at: number): boolean {
  const from = Date.parse(row.effective_from)
  if (!Number.isFinite(from) || from > at) return false
  if (row.effective_to) {
    const to = Date.parse(row.effective_to)
    if (Number.isFinite(to) && to <= at) return false
  }
  return true
}

function latest(rows: PriceBookRow[], at: number): PriceBookRow | null {
  let best: PriceBookRow | null = null
  for (const r of rows) {
    if (!inForce(r, at)) continue
    if (!best || Date.parse(r.effective_from) > Date.parse(best.effective_from)) best = r
  }
  return best
}

/** The row in force at `at`: the latest override in force, else the latest catalog row. */
export function selectPriceRow(
  book: PriceBook,
  provider: string,
  model: string,
  at?: Date | string,
): PriceBookRow | null {
  const t = atMs(at)
  if (!Number.isFinite(t)) return null
  const mine = (r: PriceBookRow) => r.provider === provider && r.model === model
  const override = latest(book.overrides.filter(mine), t)
  if (override) return { ...override, origin: 'override' }
  const row = latest(book.catalog.filter(mine), t)
  return row ? { ...row, origin: 'catalog' } : null
}

function promptSize(usage: PriceUsage): number {
  if (usage.promptTokens !== undefined) return usage.promptTokens
  return (
    (usage.input ?? 0) +
    (usage.cachedRead ?? 0) +
    (usage.cacheWrite5m ?? 0) +
    (usage.cacheWrite1h ?? 0)
  )
}

/** The rates that apply to this prompt size: the highest tier it passes, else the base row. */
export function selectTier(
  row: PriceBookRow,
  promptTokens: number,
): { rates: TokenRates; tier: string } {
  let best: PriceTier | null = null
  for (const t of row.tiers ?? []) {
    const gt = t?.when?.prompt_tokens_gt
    if (typeof gt !== 'number' || !Number.isFinite(gt)) continue
    if (promptTokens > gt && (!best || gt > best.when.prompt_tokens_gt)) best = t
  }
  return best
    ? { rates: best, tier: `prompt_tokens_gt:${best.when.prompt_tokens_gt}` }
    : { rates: row, tier: 'base' }
}

const TOKEN_KINDS: Array<[keyof PriceUsage, keyof TokenRates, string]> = [
  ['input', 'input_per_mtok_micro', 'input'],
  ['output', 'output_per_mtok_micro', 'output'],
  ['cachedRead', 'cached_input_per_mtok_micro', 'cache read'],
  ['cacheWrite5m', 'cache_write_5m_per_mtok_micro', '5m cache write'],
  ['cacheWrite1h', 'cache_write_1h_per_mtok_micro', '1h cache write'],
]

function validCount(n: number | undefined): boolean {
  return n === undefined || (Number.isFinite(n) && n >= 0)
}

/** Cost of `usage` at this row's rates. The row is already the one in force. */
export function costFromRow(row: PriceBookRow, usage: PriceUsage): PriceResult {
  const label = `${row.provider}:${row.model}`
  const meta = {
    source: row.source ?? 'legacy',
    version: row.effective_from,
    origin: row.origin ?? 'catalog',
  } as const

  if (row.unit_kind !== 'tokens') {
    const units = usage.units ?? 0
    if (!validCount(units)) return unpriced(`${label}: invalid unit count`)
    if (units === 0) return { micros: 0, tier: 'base', ...meta }
    const rate = row.per_unit_micro
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate < 0) {
      return unpriced(`${label}: no per-unit rate`)
    }
    const micros = Math.ceil(units * rate)
    if (!Number.isSafeInteger(micros)) return unpriced(`${label}: cost out of range`)
    return { micros, tier: 'base', ...meta }
  }

  const prompt = promptSize(usage)
  if (!Number.isFinite(prompt) || prompt < 0) return unpriced(`${label}: invalid prompt size`)
  const { rates, tier } = selectTier(row, prompt)

  let scaled = 0n
  for (const [usageKey, rateKey, name] of TOKEN_KINDS) {
    const count = usage[usageKey]
    if (!validCount(count)) return unpriced(`${label}: invalid ${name} token count`)
    if (!count) continue
    if (!Number.isInteger(count)) return unpriced(`${label}: ${name} token count is not whole`)
    const rate = rates[rateKey]
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate < 0) {
      return unpriced(`${label}: no ${name} rate${tier === 'base' ? '' : ` in tier ${tier}`}`)
    }
    if (!Number.isInteger(rate)) return unpriced(`${label}: ${name} rate is not whole micros`)
    scaled += BigInt(count) * BigInt(rate)
  }
  // ceil(scaled / 1e6): rates are per 1M tokens.
  const micros = Number((scaled + 999_999n) / 1_000_000n)
  if (!Number.isSafeInteger(micros)) return unpriced(`${label}: cost out of range`)
  return { micros, tier, ...meta }
}

/** priceFor over rows the caller already holds (tests, SQL exports, batch re-costing). */
export function priceFromRows(req: PriceRequest, book: PriceBook): PriceResult {
  const row = selectPriceRow(book, req.provider, req.model, req.at)
  if (!row) return unpriced(`${req.provider}:${req.model}: no price in force`)
  return costFromRow(row, req.usage)
}

/** Where priceFor reads rows from. */
export interface PriceSource {
  book(provider: string, model: string): Promise<PriceBook>
}

/** Price one call: override, catalog row in force at `at`, tier, else unpriced. */
export async function priceFor(req: PriceRequest, source: PriceSource): Promise<PriceResult> {
  let book: PriceBook
  try {
    book = await source.book(req.provider, req.model)
  } catch (err) {
    return unpriced(`price lookup failed: ${(err as Error)?.message ?? String(err)}`)
  }
  return priceFromRows(req, book)
}

// ---- sources ---------------------------------------------------------------

/** Columns both readers select (the override table names its key model_or_unit). */
export const PRICE_RATE_COLUMNS =
  'unit_kind, input_per_mtok_micro, output_per_mtok_micro, cached_input_per_mtok_micro, cache_write_5m_per_mtok_micro, cache_write_1h_per_mtok_micro, per_unit_micro, tiers, effective_from, source'

/** The slice of a supabase-js client a DB source needs. Results are thenables. */
export interface PriceDbQuery extends PromiseLike<{
  data: unknown
  error: { message: string } | null
}> {
  select(columns: string): PriceDbQuery
  eq(column: string, value: string): PriceDbQuery
}
export interface PriceDbClient {
  from(table: string): PriceDbQuery
}

interface Cached {
  book: PriceBook
  at: number
}

/** A 5-minute in-isolate cache in front of any loader. */
function cachedSource(load: (provider: string, model: string) => Promise<PriceBook>): PriceSource {
  const cache = new Map<string, Cached>()
  const ttl = 5 * 60 * 1000
  return {
    async book(provider, model) {
      const key = `${provider}\u0000${model}`
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < ttl) return hit.book
      const book = await load(provider, model)
      cache.set(key, { book, at: Date.now() })
      return book
    },
  }
}

/** Reads both tables with a service-role client on kensaurus-shared. */
export function makeDbPriceSource(db: PriceDbClient): PriceSource {
  return cachedSource(async (provider, model) => {
    const [catalog, overrides] = await Promise.all([
      db
        .from('kensaurus_model_prices')
        .select(`provider, model, ${PRICE_RATE_COLUMNS}`)
        .eq('provider', provider)
        .eq('model', model),
      db
        .from('kensaurus_price_overrides')
        .select(`provider, model:model_or_unit, ${PRICE_RATE_COLUMNS}, effective_to`)
        .eq('provider', provider)
        .eq('model_or_unit', model),
    ])
    if (catalog.error) throw new Error(`catalog: ${catalog.error.message}`)
    if (overrides.error) throw new Error(`overrides: ${overrides.error.message}`)
    return {
      catalog: (catalog.data ?? []) as PriceBookRow[],
      overrides: (overrides.data ?? []) as PriceBookRow[],
    }
  })
}

/**
 * Reads through kensaurus-wallet-api (`price` action with `book: true`). Pass
 * the wallet `internalToken`, or the read-only `routesToken`
 * (KENSAURUS_ROUTES_TOKEN): `price` accepts either, and the routes token can
 * do nothing else.
 */
export function makeRemotePriceSource(
  opts: {
    url: string
    externalProject: string
    fetchImpl?: typeof fetch
  } & (
    | { internalToken: string; routesToken?: never }
    | { routesToken: string; internalToken?: never }
  ),
): PriceSource {
  const doFetch = opts.fetchImpl ?? fetch
  const auth: Record<string, string> = opts.routesToken
    ? { 'x-kensaurus-routes-token': opts.routesToken }
    : { 'x-kensaurus-internal-token': opts.internalToken ?? '' }
  return cachedSource(async (provider, model) => {
    const resp = await doFetch(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        action: 'price',
        external_project: opts.externalProject,
        external_user_id: 'price-lookup',
        price: { provider, model, book: true },
      }),
    })
    if (!resp.ok) throw new Error(`price bridge ${resp.status}`)
    const body = (await resp.json()) as { book?: PriceBook }
    if (!body.book) throw new Error('price bridge returned no book')
    return { catalog: body.book.catalog ?? [], overrides: body.book.overrides ?? [] }
  })
}
