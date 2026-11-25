/**
 * A small price book for tests, in the shape kensaurus-wallet-api returns
 * (`price` action with `book: true`). The rates are the vendors' public list
 * prices (Anthropic pricing page and OpenAI, read 2026-11-25), used here only
 * so the arithmetic has something to check. Production reads the live
 * catalog in kensaurus-shared; nothing in the code path copies these numbers.
 */
import type { PriceBook, PriceBookRow, PriceSource } from '../../../supabase/functions/_shared/kensaurus/price.ts'

const AT = '2026-01-01T00:00:00Z'

const FIXTURE_ROWS: PriceBookRow[] = [
  { provider: 'anthropic', model: 'claude-haiku-4-5', unit_kind: 'tokens', input_per_mtok_micro: 1_000_000, output_per_mtok_micro: 5_000_000, cached_input_per_mtok_micro: 100_000, cache_write_5m_per_mtok_micro: 1_250_000, effective_from: AT, source: 'pricing_page' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', unit_kind: 'tokens', input_per_mtok_micro: 2_000_000, output_per_mtok_micro: 10_000_000, cached_input_per_mtok_micro: 100_000, cache_write_5m_per_mtok_micro: 2_500_000, effective_from: AT, source: 'pricing_page' },
  { provider: 'anthropic', model: 'claude-sonnet-5', unit_kind: 'tokens', input_per_mtok_micro: 2_000_000, output_per_mtok_micro: 10_000_000, cached_input_per_mtok_micro: 200_000, cache_write_5m_per_mtok_micro: 2_500_000, effective_from: AT, source: 'pricing_page' },
  {
    provider: 'anthropic', model: 'claude-haiku-5-5', unit_kind: 'tokens',
    input_per_mtok_micro: 100_000, output_per_mtok_micro: 500_000, cached_input_per_mtok_micro: 10_000, cache_write_5m_per_mtok_micro: 125_000,
    tiers: [{ when: { prompt_tokens_gt: 100_000 }, input_per_mtok_micro: 500_000, output_per_mtok_micro: 2_500_000, cached_input_per_mtok_micro: 50_000, cache_write_5m_per_mtok_micro: 625_000 }],
    effective_from: AT, source: 'pricing_page',
  },
  { provider: 'anthropic', model: 'claude-opus-5-5', unit_kind: 'tokens', input_per_mtok_micro: 4_000_000, output_per_mtok_micro: 20_000_000, cached_input_per_mtok_micro: 200_000, cache_write_5m_per_mtok_micro: 5_000_000, effective_from: AT, source: 'pricing_page' },
  { provider: 'openai', model: 'gpt-4.1', unit_kind: 'tokens', input_per_mtok_micro: 2_000_000, output_per_mtok_micro: 8_000_000, cached_input_per_mtok_micro: 500_000, effective_from: AT, source: 'catalog:openrouter' },
  { provider: 'openai', model: 'text-embedding-3-small', unit_kind: 'tokens', input_per_mtok_micro: 20_000, output_per_mtok_micro: 0, effective_from: AT, source: 'legacy' },
  { provider: 'openai', model: 'gpt-5.4-mini', unit_kind: 'tokens', input_per_mtok_micro: 750_000, output_per_mtok_micro: 4_500_000, cached_input_per_mtok_micro: 75_000, effective_from: AT, source: 'catalog:openrouter' },
  { provider: 'openai', model: 'gpt-transcribe', unit_kind: 'seconds', per_unit_micro: 75, effective_from: AT, source: 'legacy' },
  { provider: 'openrouter', model: 'openai/gpt-5.4', unit_kind: 'tokens', input_per_mtok_micro: 2_500_000, output_per_mtok_micro: 15_000_000, cached_input_per_mtok_micro: 250_000, effective_from: AT, source: 'vendor_api' },
]

/** A PriceSource over FIXTURE_ROWS (plus any overrides), counting lookups. */
export function fixturePriceSource(overrides: PriceBookRow[] = []): PriceSource & { lookups: number } {
  const src = {
    lookups: 0,
    async book(provider: string, model: string): Promise<PriceBook> {
      src.lookups++
      const mine = (r: PriceBookRow) => r.provider === provider && r.model === model
      return { catalog: FIXTURE_ROWS.filter(mine), overrides: overrides.filter(mine) }
    },
  }
  return src
}
