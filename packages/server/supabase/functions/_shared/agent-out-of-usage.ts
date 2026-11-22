/**
 * FILE: packages/server/supabase/functions/_shared/agent-out-of-usage.ts
 * PURPOSE: Tell a fix that stopped because the coding agent's account ran out
 *          of credits from any other failure (console audit 2026-11-11,
 *          blockers 1–3).
 *
 *          From 2026-11-07, 274 local `mushi work` runs failed with
 *          "Local agent finished without a change: ActionRequiredError:
 *          Increase limits for faster responses You're out of usage." They
 *          were stored with no failure_category, so /fixes said "Unrecognised
 *          error" and offered "Retry 53", which would run 53 more times into
 *          the same empty account. Cursor Cloud's own refusal
 *          ("usage_limit_exceeded: On-demand usage is required") was stored as
 *          `cursor_api_error`, which reads as retryable too.
 *
 *          fix_attempts.failure_category has a CHECK constraint, so this is
 *          read from the error text where the rows are read
 *          (fix-report-truth.ts, the console's fixReportTruth.ts), never
 *          written as a new category. That also covers the rows already
 *          stored.
 *
 *          Rate limits (429, "try again in a minute") are not out of usage:
 *          they clear on their own, and a retry is right.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

/** The bucket a failure gets in counts and "Common causes" when the agent's account is out of credits. */
export const AGENT_OUT_OF_USAGE_BUCKET = 'agent_out_of_usage'

// The local Cursor CLI ("You're out of usage", "Increase limits for faster
// responses"), Cursor Cloud's create call (`usage_limit_exceeded`, "On-demand
// usage is required"), a run that hits the plan limit later ("You've hit your
// usage limit"), and Claude's "credit balance is too low".
const OUT_OF_USAGE_RE =
  /\byou(?:'|’)?re out of usage\b|\bout of usage\b|increase limits for faster responses|usage_limit_exceeded|on-demand usage is required|\b(?:hit|reached|exceeded) (?:your|the) (?:usage|plan|monthly)[ -]?limit|\busage limit (?:reached|exceeded)\b|credit balance is too low/i

/** True when a fix attempt's error says the agent's account has no credits left. */
export function isAgentOutOfUsageError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.length > 0 && OUT_OF_USAGE_RE.test(error)
}
