/**
 * FILE: packages/server/supabase/functions/_shared/hosted-llm-order.ts
 * PURPOSE: Which vendor the platform's own keys (Mushi-hosted AI, billed to the
 *          KENSAURUS wallet) try first. Config, not code: the next contingency
 *          is a secret flip, not a deploy.
 *
 *   MUSHI_HOSTED_LLM_ORDER   comma list of openai | openrouter | anthropic.
 *                            Default `openai,openrouter,anthropic` (owner,
 *                            2026-11-21: the Claude credit ran down to $1.30,
 *                            OpenAI held $221). Unknown names are dropped; an
 *                            empty or all-unknown value means the default.
 *                            A vendor left out is never used for hosted calls.
 *   MUSHI_LLM_DRILL          `anthropic_no_credit`: every platform-key Claude
 *                            call fails with Anthropic's real low-credit 400
 *                            before any request is sent, so an operator can
 *                            prove the fallover in production without touching
 *                            a key. Off when unset.
 *
 * Only the platform key (`ResolvedKey.source === 'env'`) follows this order.
 * A customer's own key (BYOK) is their choice and their bill: an app with its
 * own Claude key still runs Claude first, exactly as before.
 *
 * Where it applies (one place each, see the callers):
 *   - byok.ts `envCandidates`: the platform Claude key is handed out only when
 *     Anthropic is first; the platform OpenAI pool is OPENAI_API_KEY then
 *     OPENROUTER_API_KEY, in this order.
 *   - ai-provider.ts `platformAnthropicKey`: same rule for direct readers.
 *   - llm-failover.ts `withAnthropicOrOpenAi`: with no app-owned Claude key,
 *     the OpenAI pool runs first and the platform Claude key comes last.
 *
 * Pure apart from the env read, which is guarded so vitest can import it.
 */

export type HostedLlmVendor = 'openai' | 'openrouter' | 'anthropic'

export const DEFAULT_HOSTED_LLM_ORDER: readonly HostedLlmVendor[] = ['openai', 'openrouter', 'anthropic']

const VENDORS = new Set<HostedLlmVendor>(['openai', 'openrouter', 'anthropic'])

/** Parse a `MUSHI_HOSTED_LLM_ORDER` value. Unknown and repeated names are dropped. */
export function parseHostedLlmOrder(raw: string | null | undefined): HostedLlmVendor[] {
  const out: HostedLlmVendor[] = []
  for (const part of (raw ?? '').split(',')) {
    const name = part.trim().toLowerCase() as HostedLlmVendor
    if (VENDORS.has(name) && !out.includes(name)) out.push(name)
  }
  return out.length > 0 ? out : [...DEFAULT_HOSTED_LLM_ORDER]
}

/** Guarded env read: vitest has no Deno, and a permission-less Deno test throws. */
function readEnv(read: () => string | undefined): string | undefined {
  try {
    return typeof Deno !== 'undefined' ? read() : undefined
  } catch {
    return undefined
  }
}

/** The configured order, read on every call so a secret change applies on the next isolate. */
export function hostedLlmOrder(): HostedLlmVendor[] {
  return parseHostedLlmOrder(readEnv(() => Deno.env.get('MUSHI_HOSTED_LLM_ORDER')))
}

/** True when the platform Claude key may be handed out first (Anthropic heads the order). */
export function hostedClaudeFirst(order: readonly HostedLlmVendor[] = hostedLlmOrder()): boolean {
  return order[0] === 'anthropic'
}

/** True when the platform Claude key is in the order at all (as the last resort, unless first). */
export function hostedClaudeAllowed(order: readonly HostedLlmVendor[] = hostedLlmOrder()): boolean {
  return order.includes('anthropic')
}

/** The OpenAI-compatible platform vendors, in configured order. */
export function hostedOpenAiVendors(order: readonly HostedLlmVendor[] = hostedLlmOrder()): Array<'openai' | 'openrouter'> {
  return order.filter((v): v is 'openai' | 'openrouter' => v !== 'anthropic')
}

/**
 * Anthropic's answer to a spent account, verbatim (HTTP 400, recorded
 * 2026-11-21). The drill throws it; the tests classify it.
 */
export const ANTHROPIC_LOW_CREDIT_BODY =
  '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'

/** The error the Anthropic SDK throws for that body: an `APIError` with status 400. */
export class AnthropicLowCreditDrillError extends Error {
  status = 400
  constructor() {
    super(`400 ${ANTHROPIC_LOW_CREDIT_BODY}`)
    this.name = 'AnthropicLowCreditDrillError'
  }
}

/** True when MUSHI_LLM_DRILL asks platform-key Claude calls to fail as out of credit. */
export function anthropicNoCreditDrill(): boolean {
  return (readEnv(() => Deno.env.get('MUSHI_LLM_DRILL')) ?? '').trim().toLowerCase() === 'anthropic_no_credit'
}
