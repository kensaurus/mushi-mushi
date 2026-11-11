/**
 * FILE: apps/admin/src/lib/agentOutOfUsage.ts
 * PURPOSE: Is this fix failure the coding agent's account running out of
 *          credits? Pure (no React), so pdcaAct and fixReportTruth import it.
 *          Mirrors the server's `_shared/agent-out-of-usage.ts`.
 */

/** The failure bucket for a run the agent's account refused (server AGENT_OUT_OF_USAGE_BUCKET). */
export const AGENT_OUT_OF_USAGE_BUCKET = 'agent_out_of_usage'

const OUT_OF_USAGE_RE =
  /\byou(?:'|’)?re out of usage\b|\bout of usage\b|increase limits for faster responses|usage_limit_exceeded|on-demand usage is required|\b(?:hit|reached|exceeded) (?:your|the) (?:usage|plan|monthly)[ -]?limit|\busage limit (?:reached|exceeded)\b|credit balance is too low/i

/** True when a fix attempt's error says the coding agent's account has no credits left. */
export function isAgentOutOfUsageError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.length > 0 && OUT_OF_USAGE_RE.test(error)
}
