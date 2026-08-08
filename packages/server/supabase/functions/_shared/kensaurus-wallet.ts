/**
 * _shared/kensaurus-wallet.ts — wallet metering for AI edge functions.
 *
 * SYNC: verbatim twin lives at glot.it/supabase/functions/_shared/
 * kensaurus-wallet.ts — edit both or extract a package at the third copy.
 *
 * Flow per AI call:
 *   1. BYOK key present -> skip the wallet entirely (user pays their own
 *      provider bill; ADR kensaurus-identity-and-byok).
 *   2. Preflight kensaurus_wallet_check (fail-closed): any denial throws
 *      WalletDeniedError -> callers return 402 {error:'wallet_insufficient',
 *      reason, balance_micro} so clients can deep-link the credits store.
 *   3. Run the provider call.
 *   4. Compute provider cost from kensaurus_model_prices (in-isolate
 *      cache, 5 min). Unknown model = REFUSE BEFORE the call — nothing
 *      runs unpriced.
 *   5. Debit (50% markup default) with request_id + Langfuse trace_id.
 *      Debit failure after a successful call never fails the user
 *      (logged; the -$2 floor absorbs the drift).
 *
 * Backends:
 *   makeDirectBackend(admin)  — kenji fns call the RPCs directly.
 *   makeRemoteBackend(...)    — non-kenji fns (glot) POST to
 *                               kensaurus-wallet-api with the shared
 *                               internal token.
 * SHADOW MODE (glot founding open-access): pass shadowMode: true — full
 * metering + ledger metadata at markup_bps 0 AND provider_cost 0 debit
 * (records a $0 ledger row so per-user cost analysis runs on Langfuse +
 * metadata while charging nothing).
 */
/**
 * Structural subset of the supabase-js client this module touches. Typing
 * it here rather than taking `any` keeps the file lintable in the repos
 * whose eslint covers supabase/functions, and documents exactly how much
 * of the client a backend implementation has to provide.
 */
export interface WalletDbQuery {
  select(columns: string): WalletDbQuery
  eq(column: string, value: string): WalletDbQuery
  lte(column: string, value: string): WalletDbQuery
  order(column: string, options: { ascending: boolean }): WalletDbQuery
  limit(count: number): WalletDbQuery
  maybeSingle(): Promise<{ data: unknown }>
}

export interface WalletDbClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>
  from(table: string): WalletDbQuery
}

export interface WalletBackend {
  check(
    estimatedMicro: number,
  ): Promise<{ allowed: boolean; reason?: string; balance_micro?: number }>
  getPrice(provider: string, model: string): Promise<PriceRow | null>
  debit(args: {
    app: string
    feature: string
    model: string
    providerCostMicro: number
    requestId: string
    markupBps?: number
    traceId?: string
    metadata?: Record<string, unknown>
  }): Promise<{ balance_micro?: number; debit_micro?: number; duplicate?: boolean }>
}

export class WalletDeniedError extends Error {
  reason: string
  balanceMicro: number | null
  constructor(reason: string, balanceMicro: number | null) {
    super(`wallet denied: ${reason}`)
    this.reason = reason
    this.balanceMicro = balanceMicro
  }
}

/** Direct backend: kenji edge fns with a service-role supabase client. */
export function makeDirectBackend(admin: WalletDbClient, userId: string): WalletBackend {
  return {
    getPrice: (provider, model) => fetchPriceRow(admin, provider, model),
    async check(estimatedMicro) {
      const { data, error } = await admin.rpc('kensaurus_wallet_check', {
        p_user_id: userId,
        p_estimated_micro: estimatedMicro,
      })
      if (error) return { allowed: false, reason: 'check-failed' }
      return data as { allowed: boolean; reason?: string; balance_micro?: number }
    },
    async debit(args) {
      const { data, error } = await admin.rpc('kensaurus_wallet_debit', {
        p_user_id: userId,
        p_app: args.app,
        p_feature: args.feature,
        p_model: args.model,
        p_provider_cost_micro: args.providerCostMicro,
        p_request_id: args.requestId,
        p_markup_bps: args.markupBps ?? 5000,
        p_trace_id: args.traceId ?? null,
        p_metadata: args.metadata ?? {},
      })
      if (error) throw new Error(`debit failed: ${error.message}`)
      return data as { balance_micro?: number; debit_micro?: number; duplicate?: boolean }
    },
  }
}

/** Remote backend: non-kenji projects bridge via kensaurus-wallet-api. */
export function makeRemoteBackend(opts: {
  url: string
  internalToken: string
  externalProject: string
  externalUserId: string
  email?: string
}): WalletBackend {
  const call = async (body: Record<string, unknown>) => {
    const resp = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kensaurus-internal-token': opts.internalToken,
      },
      body: JSON.stringify({
        external_project: opts.externalProject,
        external_user_id: opts.externalUserId,
        email: opts.email,
        ...body,
      }),
    })
    if (!resp.ok) {
      return { _status: resp.status, ...(await resp.json().catch(() => ({}))) }
    }
    return await resp.json()
  }
  return {
    async getPrice(provider, model) {
      const r = await call({ action: 'price', price: { provider, model } })
      if (r._status) return null
      return (r.price as PriceRow | null) ?? null
    },
    async check(estimatedMicro) {
      const r = await call({ action: 'check', estimated_micro: estimatedMicro })
      if (r._status === 404 && r.reason === 'email-required') {
        return { allowed: false, reason: 'registration-required' }
      }
      if (r._status) return { allowed: false, reason: 'bridge-error' }
      return r
    },
    async debit(args) {
      const r = await call({
        action: 'debit',
        debit: {
          app: args.app,
          feature: args.feature,
          model: args.model,
          provider_cost_micro: args.providerCostMicro,
          request_id: args.requestId,
          markup_bps: args.markupBps ?? 5000,
          trace_id: args.traceId,
          metadata: args.metadata,
        },
      })
      if (r._status) throw new Error(`bridge debit failed: ${r._status}`)
      return r
    },
  }
}

// ---- model pricing ---------------------------------------------------------

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  units?: number // chars or seconds for non-token models
}

export interface PriceRow {
  provider: string
  model: string
  unit_kind: 'tokens' | 'chars' | 'seconds'
  input_per_mtok_micro: number | null
  output_per_mtok_micro: number | null
  cached_input_per_mtok_micro: number | null
  per_unit_micro: number | null
}

const priceCache = new Map<string, { row: PriceRow | null; at: number }>()
const PRICE_TTL_MS = 5 * 60 * 1000

/** DB price lookup (kenji-local). Remote backends use the bridge instead. */
export async function fetchPriceRow(
  admin: WalletDbClient,
  provider: string,
  model: string,
): Promise<PriceRow | null> {
  const { data } = await admin
    .from('kensaurus_model_prices')
    .select(
      'provider, model, unit_kind, input_per_mtok_micro, output_per_mtok_micro, cached_input_per_mtok_micro, per_unit_micro',
    )
    .eq('provider', provider)
    .eq('model', model)
    .lte('effective_from', new Date().toISOString())
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as PriceRow) ?? null
}

/** Cached price via the backend (direct DB on kenji, bridge on glot). */
export async function getModelPrice(
  backend: WalletBackend,
  provider: string,
  model: string,
): Promise<PriceRow | null> {
  const key = `${provider}:${model}`
  const hit = priceCache.get(key)
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.row
  const row = await backend.getPrice(provider, model)
  priceCache.set(key, { row, at: Date.now() })
  return row
}

export function computeProviderCostMicro(price: PriceRow, usage: Usage): number {
  if (price.unit_kind === 'tokens') {
    const inTok = usage.inputTokens ?? 0
    const outTok = usage.outputTokens ?? 0
    const cachedTok = usage.cachedInputTokens ?? 0
    const cost =
      (inTok * (price.input_per_mtok_micro ?? 0)) / 1_000_000 +
      (outTok * (price.output_per_mtok_micro ?? 0)) / 1_000_000 +
      (cachedTok * (price.cached_input_per_mtok_micro ?? price.input_per_mtok_micro ?? 0)) /
        1_000_000
    return Math.ceil(cost)
  }
  return Math.ceil((usage.units ?? 0) * (price.per_unit_micro ?? 0))
}

// ---- metered call ----------------------------------------------------------

export interface MeterOptions {
  backend: WalletBackend
  app: string
  feature: string
  provider: string
  model: string
  estimateMicro?: number // preflight estimate; default 10,000 (1 credit)
  traceId?: string
  byokActive?: boolean
  shadowMode?: boolean
  metadata?: Record<string, unknown>
}

/**
 * Wrap a provider call with wallet preflight + debit.
 * `run` must return the provider result plus usage numbers.
 */
export async function meteredCall<T>(
  opts: MeterOptions,
  run: () => Promise<{ result: T; usage: Usage }>,
): Promise<{ result: T; debitMicro: number; balanceMicro: number | null }> {
  if (opts.byokActive) {
    const { result } = await run()
    return { result, debitMicro: 0, balanceMicro: null }
  }

  // Refuse unpriced models BEFORE spending provider money.
  const price = await getModelPrice(opts.backend, opts.provider, opts.model)
  if (!price) {
    throw new Error(`no price configured for ${opts.provider}:${opts.model} — refusing`)
  }

  if (!opts.shadowMode) {
    const check = await opts.backend.check(opts.estimateMicro ?? 10_000)
    if (!check.allowed) {
      throw new WalletDeniedError(check.reason ?? 'insufficient', check.balance_micro ?? null)
    }
  }

  const { result, usage } = await run()

  const providerCostMicro = computeProviderCostMicro(price, usage)
  const requestId = crypto.randomUUID()
  let debitMicro = 0
  let balanceMicro: number | null = null
  try {
    const debit = await opts.backend.debit({
      app: opts.app,
      feature: opts.feature,
      model: opts.model,
      providerCostMicro: opts.shadowMode ? 0 : providerCostMicro,
      requestId,
      markupBps: opts.shadowMode ? 0 : undefined,
      traceId: opts.traceId,
      metadata: {
        ...(opts.metadata ?? {}),
        usage,
        ...(opts.shadowMode ? { shadow: true, shadow_provider_cost_micro: providerCostMicro } : {}),
      },
    })
    debitMicro = debit.debit_micro ?? 0
    balanceMicro = debit.balance_micro ?? null
  } catch (err) {
    // Never fail the user after a successful provider call; one retry then log.
    try {
      await opts.backend.debit({
        app: opts.app,
        feature: opts.feature,
        model: opts.model,
        providerCostMicro: opts.shadowMode ? 0 : providerCostMicro,
        requestId,
        traceId: opts.traceId,
        metadata: { ...(opts.metadata ?? {}), usage, retry: true },
      })
    } catch {
      console.error('[kensaurus-wallet] debit lost after retry:', (err as Error).message, {
        app: opts.app,
        feature: opts.feature,
        requestId,
        providerCostMicro,
      })
    }
  }

  return { result, debitMicro, balanceMicro }
}

/** Standard 402 payload for WalletDeniedError. */
export function walletDeniedResponse(err: WalletDeniedError): Response {
  return new Response(
    JSON.stringify({
      error: 'wallet_insufficient',
      reason: err.reason,
      balance_micro: err.balanceMicro,
    }),
    { status: 402, headers: { 'Content-Type': 'application/json' } },
  )
}
