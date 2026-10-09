/**
 * FILE: apps/admin/src/lib/actionError.ts
 * PURPOSE: One plain-English sentence for a failed button, save or mint on
 *          the projects / connect / MCP / onboarding surfaces (console
 *          group E). humanizeApiError is the page-load counterpart.
 *
 *   - Codes with a known meaning (session, network, plan, server fault) get
 *     humanizeApiError's title and hint.
 *   - Otherwise the server's own message, when it is a sentence written for
 *     people ("Only project owners and admins can …"), is shown as is. A
 *     blanket "check your plan limits" used to replace it (QA bugs 125, 126).
 *   - Bare codes, JSON and SQL text never reach the user; the fallback does.
 */
import { humanizeApiError } from './humanizeApiError'

const HUMANIZED_CODES = new Set([
  'NETWORK_ERROR',
  'MISSING_AUTH',
  'INVALID_TOKEN',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'FEATURE_NOT_IN_PLAN',
  'PLAN_UPGRADE_REQUIRED',
  'DB_ERROR',
  'RPC_ERROR',
  'INTERNAL',
  'INTERNAL_ERROR',
  'INVALID_RESPONSE',
])

function isReadable(message: string, code: string): boolean {
  const m = message.trim()
  if (!m || m.toUpperCase() === code) return false
  if (/^[A-Z][A-Z0-9_]{1,64}$/.test(m)) return false
  if (/^[[{]/.test(m)) return false
  if (/duplicate key|violates|constraint|relation "|column "|syntax error|PGRST\d|SQLSTATE|^\d{3}:/i.test(m)) return false
  return true
}

export function describeActionError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  fallback: string,
): string {
  const code = (error?.code ?? '').toUpperCase()
  const message = error?.message ?? ''
  if (code && HUMANIZED_CODES.has(code)) {
    const h = humanizeApiError(message || code, code)
    if (h) return `${h.title} ${h.hint}`
  }
  return isReadable(message, code) ? message.trim() : fallback
}
