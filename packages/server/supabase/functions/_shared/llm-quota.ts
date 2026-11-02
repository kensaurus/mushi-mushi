/**
 * FILE: packages/server/supabase/functions/_shared/llm-quota.ts
 * PURPOSE: Tell a spent or rate-limited LLM key from any other error, by its
 *          message. Pure (no Deno or env reads at load), so the review job and
 *          tests can use it without llm-failover's module-level settings.
 *
 * Anthropic answers a spent key with a 400 invalid_request_error, not a 429:
 * "You have reached your specified API usage limits. You will regain access
 * on …" or "Your credit balance is too low to access the Anthropic API"
 * (MUSHI-MUSHI-SERVER-3C/3D, 2026-10-28).
 */

export function isQuotaMessage(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('api usage limits') ||
    msg.includes('usage limit') ||
    msg.includes('credit balance is too low') ||
    msg.includes('insufficient_quota') ||
    msg.includes('billing_hard_limit')
  )
}
