/**
 * FILE: packages/server/supabase/functions/_shared/price-override.ts
 * PURPOSE: "Add price" on the Costs page: write one kensaurus_price_overrides
 *          row for a model the shared catalog cannot price, through the
 *          kensaurus-wallet-api bridge (the token never leaves the server).
 *
 * Who may: the platform super-admin only. An override is global: it changes
 * the cost every KENSAURUS app records for that model, and the wallet debits
 * of all of them, so a customer's org owner or admin may not write one.
 *
 * The override is append-only on the far side (effective_from = now, no
 * effective_to); a correction is a newer override. Rates arrive here in USD
 * per 1M tokens, as a person reads them off a pricing page, and are stored
 * as integer micro-USD.
 */

export interface PriceOverrideInput {
  provider: string
  model: string
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cachedInputUsdPerMTok?: number | null
  sourceUrl?: string | null
  note?: string | null
}

export type ParsedOverride = { ok: true; value: PriceOverrideInput } | { ok: false; error: string }

const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/
/** Far above any list price; catches a per-token or cents typo. */
const MAX_USD_PER_MTOK = 1_000

function rate(v: unknown, field: string, required: boolean): number | null | string {
  if (v === undefined || v === null || v === '') return required ? `${field} is required` : null
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n) || n < 0) return `${field} must be a number of dollars, 0 or more`
  if (n > MAX_USD_PER_MTOK) return `${field} is over $${MAX_USD_PER_MTOK} per million tokens; enter dollars per 1M tokens`
  return n
}

/** Validate the console's body. Pure. */
export function parsePriceOverride(body: unknown): ParsedOverride {
  const b = (body ?? {}) as Record<string, unknown>
  const provider = typeof b.provider === 'string' ? b.provider.trim().toLowerCase() : ''
  const model = typeof b.model === 'string' ? b.model.trim() : ''
  if (!PROVIDER_RE.test(provider) || provider === 'unknown') return { ok: false, error: 'provider must be a provider id such as anthropic, openai or openrouter' }
  if (!MODEL_RE.test(model)) return { ok: false, error: 'model must be the model id exactly as recorded' }
  const input = rate(b.input_usd_per_mtok, 'input_usd_per_mtok', true)
  if (typeof input === 'string') return { ok: false, error: input }
  const output = rate(b.output_usd_per_mtok, 'output_usd_per_mtok', true)
  if (typeof output === 'string') return { ok: false, error: output }
  const cached = rate(b.cached_input_usd_per_mtok, 'cached_input_usd_per_mtok', false)
  if (typeof cached === 'string') return { ok: false, error: cached }
  const sourceUrl = typeof b.source_url === 'string' && b.source_url.trim() ? b.source_url.trim() : null
  if (sourceUrl && !/^https:\/\/\S{3,300}$/.test(sourceUrl)) return { ok: false, error: 'source_url must be an https link to the price' }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) || null : null
  return {
    ok: true,
    value: { provider, model, inputUsdPerMTok: input!, outputUsdPerMTok: output!, cachedInputUsdPerMTok: cached, sourceUrl, note },
  }
}

const micros = (usd: number): number => Math.round(usd * 1_000_000)

/** The kensaurus_price_overrides row, in the table's own column names. Pure. */
export function overrideRow(v: PriceOverrideInput, createdBy: string, now: Date): Record<string, unknown> {
  return {
    provider: v.provider,
    model_or_unit: v.model,
    unit_kind: 'tokens',
    input_per_mtok_micro: micros(v.inputUsdPerMTok),
    output_per_mtok_micro: micros(v.outputUsdPerMTok),
    cached_input_per_mtok_micro: v.cachedInputUsdPerMTok == null ? null : micros(v.cachedInputUsdPerMTok),
    source: 'manual',
    source_url: v.sourceUrl ?? null,
    note: v.note ?? null,
    effective_from: now.toISOString(),
    created_by: createdBy.slice(0, 120),
  }
}

/** The wallet bridge action that inserts an override row (kensaurus-wallet-api). */
const PRICE_OVERRIDE_ACTION = 'price_override'

export type WriteOverrideResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; status: number; code: 'NOT_CONFIGURED' | 'BRIDGE_UNSUPPORTED' | 'BRIDGE_ERROR'; message: string }

/** POST the row to kensaurus-wallet-api. Never throws. */
export async function writePriceOverride(
  row: Record<string, unknown>,
  deps: { url: string; token: string; fetchImpl?: typeof fetch },
): Promise<WriteOverrideResult> {
  if (!deps.url || !deps.token) {
    return { ok: false, status: 503, code: 'NOT_CONFIGURED', message: 'The price book is not reachable from this install (KENSAURUS_WALLET_URL is not set).' }
  }
  const doFetch = deps.fetchImpl ?? fetch
  try {
    const res = await doFetch(deps.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kensaurus-internal-token': deps.token },
      body: JSON.stringify({
        action: PRICE_OVERRIDE_ACTION,
        external_project: 'mushi',
        external_user_id: 'price-override',
        price_override: row,
      }),
      signal: AbortSignal.timeout(8_000),
    })
    if (res.status === 400) {
      const text = await res.text().catch(() => '')
      // A bridge without the action rejects the enum value as an invalid body.
      return { ok: false, status: 501, code: 'BRIDGE_UNSUPPORTED', message: `The price book bridge refused the override (${text.slice(0, 160) || 'invalid body'}).` }
    }
    if (!res.ok) return { ok: false, status: 502, code: 'BRIDGE_ERROR', message: `The price book bridge answered ${res.status}.` }
    const body = (await res.json().catch(() => ({}))) as { override?: Record<string, unknown> }
    return { ok: true, row: body.override ?? row }
  } catch (err) {
    return { ok: false, status: 502, code: 'BRIDGE_ERROR', message: `The price book bridge did not answer: ${String((err as Error)?.message ?? err).slice(0, 160)}` }
  }
}
