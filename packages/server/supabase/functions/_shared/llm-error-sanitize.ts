/**
 * FILE: packages/server/supabase/functions/_shared/llm-error-sanitize.ts
 * PURPOSE: Strip provider credentials out of an LLM error before it reaches
 *          logs, DB rows, or Sentry.
 *
 * Lives on its own (re-exported from llm-failover.ts) because llm-failover
 * reads Deno.env at module load, and the usage recorder in llm-usage.ts
 * must stay importable from Node-side vitest suites.
 */

const LLM_API_KEY_RX = /\bsk-[A-Za-z0-9_*=-]{8,}/gi;
const BEARER_TOKEN_RX = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const CURSOR_API_KEY_RX = /\bcrsr_[A-Za-z0-9._~+/=-]{8,}/gi;
const FIRECRAWL_API_KEY_RX = /\bfc-[A-Za-z0-9._~+/=-]{8,}/gi;
const BROWSERBASE_API_KEY_RX = /\bbb_[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_ASSIGNMENT_RX =
  /((?:api[_-]?key|x-api-key|authorization)\s*["']?\s*[:=]\s*["']?)(?!\[redacted\])([A-Za-z0-9._~+/=-]{8,})/gi;

/** Remove provider credentials before errors reach logs, DB status, or Sentry. */
export function sanitizeLlmError(value: unknown): string {
  return String(value)
    .replace(LLM_API_KEY_RX, 'sk-[redacted]')
    .replace(BEARER_TOKEN_RX, 'Bearer [redacted]')
    .replace(CURSOR_API_KEY_RX, 'crsr_[redacted]')
    .replace(FIRECRAWL_API_KEY_RX, 'fc-[redacted]')
    .replace(BROWSERBASE_API_KEY_RX, 'bb_[redacted]')
    .replace(SECRET_ASSIGNMENT_RX, '$1[redacted]');
}
