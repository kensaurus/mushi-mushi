/**
 * FILE: packages/server/supabase/functions/_shared/llm-quota.ts
 * PURPOSE: Tell a spent or rate-limited LLM key from any other error.
 *          Pure (no Deno or env reads at load), so the review job and tests
 *          can use it without llm-failover's module-level settings.
 *
 * Anthropic answers a spent key with a 400 invalid_request_error, not a 429.
 * The AI SDK often leaves that sentence on `responseBody` while `message` is
 * only "Bad Request" (MUSHI-MUSHI-SERVER-3C/3D, report d6183705).
 *
 * A spend cap cools the key for one hour (`QUOTA_KEY_COOLDOWN_MS`). The date
 * in the provider's message is shown to the operator; it is not the cooldown.
 * Raising the limit on the provider side takes effect on the next attempt
 * after the hour, without re-saving the key.
 */

/** How long a spend-capped or rate-limited key stays out of rotation. */
export const QUOTA_KEY_COOLDOWN_MS = 60 * 60 * 1000

const RESET_AT = /regain access on ([0-9]{4}-[0-9]{2}-[0-9]{2}(?: at [0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?(?: UTC)?)/i

const TEXT_KEYS = ['message', 'responseBody', 'type'] as const

/**
 * Message plus the fields the AI SDK and the Anthropic SDK hang the provider
 * sentence on (`responseBody`, nested `error.message`, `cause`). Bounded so a
 * cyclic cause cannot loop.
 */
export function llmErrorText(err: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  const push = (value: unknown): void => {
    if (typeof value !== 'string' || !value) return
    parts.push(value.length > 4000 ? value.slice(0, 4000) : value)
  }
  const walk = (value: unknown, depth: number): void => {
    if (value == null || depth > 4 || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (value instanceof Error) push(value.message)
    const rec = value as Record<string, unknown>
    for (const key of TEXT_KEYS) {
      if (key === 'message' && value instanceof Error) continue
      push(rec[key])
    }
    if ('error' in rec) walk(rec.error, depth + 1)
    if ('data' in rec) walk(rec.data, depth + 1)
    if ('cause' in rec) walk(rec.cause, depth + 1)
  }
  walk(err, 0)
  if (parts.length === 0) push(String(err))
  return parts.join('\n')
}

/** Monthly or plan spend cap. A short 429 is a rate limit, not this. */
export function isSpendCapMessage(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    msg.includes('api usage limits') ||
    msg.includes('usage limit') ||
    msg.includes('credit balance is too low') ||
    msg.includes('insufficient_quota') ||
    msg.includes('billing_hard_limit') ||
    msg.includes('exceeded your current quota')
  )
}

export function isQuotaMessage(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    isSpendCapMessage(msg) ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('quota')
  )
}

/** One hour from `nowMs`. Ignores any reset date written in the provider error. */
export function quotaCooldownUntil(nowMs: number): string {
  return new Date(nowMs + QUOTA_KEY_COOLDOWN_MS).toISOString()
}

/** What to show a person. The reset date is quoted when the provider sent one. */
export function quotaUserMessage(text: string): string {
  const when = text.match(RESET_AT)?.[1]?.replace(/\s+/g, ' ').trim()
  if (when) return `Provider quota exhausted until ${when}. Update your key in Settings.`
  return 'Provider quota exhausted. Update your key in Settings.'
}
