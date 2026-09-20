// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/hosted-llm-charge.ts
 * PURPOSE: Decide whether one hosted-key provider call can be billed, and for
 *          how much. Deliberately PURE — no Deno globals, no network, no
 *          runtime imports — so the Node/vitest suite can exercise it without
 *          the `Deno is not defined` hazard documented in telemetry.ts.
 *
 * WHY THIS EXISTS (2026-09-20 — Sentry MUSHI-MUSHI-SERVER-1Z)
 *   `chargeHostedLlm` asked one question: "is there a price row?" A hosted
 *   `gpt-transcribe` call had none, so it logged
 *   "No wallet price for hosted model — call not charged" and skipped the
 *   debit. The work ran for free.
 *
 *   The price row was then added to `kensaurus_model_prices`
 *   (provider=openai, unit_kind='seconds', per_unit_micro=75). That silenced
 *   the error WITHOUT closing the leak: `telemetry.ts` only ever built
 *   `usage` out of token counts, never `units`, so for a seconds-priced model
 *   `computeProviderCostMicro` evaluated `Math.ceil(0 * 75)` = 0 and the call
 *   was debited nothing at all. A loud revenue leak became a silent one —
 *   strictly worse, because nothing fires any more.
 *
 * THE INVARIANT THIS ENCODES
 *   A SUCCESSFUL call on a platform-owned key must never produce a provider
 *   cost of zero. Zero does not mean the call was free; it means we failed to
 *   measure it. Every zero is handed to the dead-letter table instead of
 *   being debited, so it stays queryable and replayable.
 *
 *   One rule closes the whole class:
 *     - no price row at all                    (the original bug)
 *     - a seconds/chars row with no `units`    (the silent successor)
 *     - a row whose rate columns are all NULL
 *     - token usage that arrived as 0 / 0
 *
 *   Note this decides on the TRUE computed cost, before shadow mode zeroes
 *   the debit. Shadow mode deliberately debits $0 while still recording the
 *   real cost in metadata, so it must not be mistaken for a measurement
 *   failure — and, being the mode mushi runs in today, it is exactly where
 *   pricing gaps should surface before the flag is turned to `on`.
 */

import type { PriceRow, Usage } from './kensaurus-wallet.ts';

/** Why a call could not be turned into a debit. */
export type UnchargeableReason =
  /** No row in `kensaurus_model_prices` for this provider+model. */
  | 'no-price-row'
  /** A row exists, but the usage we captured prices out at zero. */
  | 'zero-cost';

export type HostedLlmChargeDecision =
  | { kind: 'charge'; providerCostMicro: number }
  | { kind: 'skip'; reason: UnchargeableReason; detail: string };

/** Recomputed locally rather than imported so this module stays import-free. */
function computeCostMicro(price: PriceRow, usage: Usage): number {
  if (price.unit_kind === 'tokens') {
    const inTok = usage.inputTokens ?? 0;
    const outTok = usage.outputTokens ?? 0;
    const cachedTok = usage.cachedInputTokens ?? 0;
    const cost =
      (inTok * (price.input_per_mtok_micro ?? 0)) / 1_000_000 +
      (outTok * (price.output_per_mtok_micro ?? 0)) / 1_000_000 +
      (cachedTok * (price.cached_input_per_mtok_micro ?? price.input_per_mtok_micro ?? 0)) /
        1_000_000;
    return Math.ceil(cost);
  }
  return Math.ceil((usage.units ?? 0) * (price.per_unit_micro ?? 0));
}

function describeUsage(price: PriceRow, usage: Usage): string {
  if (price.unit_kind === 'tokens') {
    return `tokens in=${usage.inputTokens ?? 0} out=${usage.outputTokens ?? 0} cached=${
      usage.cachedInputTokens ?? 0
    } rates in=${price.input_per_mtok_micro ?? 'null'} out=${price.output_per_mtok_micro ?? 'null'}`;
  }
  return `${price.unit_kind} units=${usage.units ?? 'absent'} per_unit_micro=${
    price.per_unit_micro ?? 'null'
  }`;
}

/**
 * Turn a price row + captured usage into a billing decision.
 *
 * `skip` is never "charge nothing and move on" — every caller must persist it
 * as lost revenue. See `chargeHostedLlm`.
 */
export function decideHostedLlmCharge(args: {
  price: PriceRow | null;
  usage: Usage;
  provider: string;
  model: string;
}): HostedLlmChargeDecision {
  const { price, usage, provider, model } = args;

  if (!price) {
    return {
      kind: 'skip',
      reason: 'no-price-row',
      detail: `no kensaurus_model_prices row for ${provider}:${model}`,
    };
  }

  const providerCostMicro = computeCostMicro(price, usage);
  if (providerCostMicro <= 0) {
    return {
      kind: 'skip',
      reason: 'zero-cost',
      detail: `${provider}:${model} priced to 0 micro — ${describeUsage(price, usage)}`,
    };
  }

  return { kind: 'charge', providerCostMicro };
}
