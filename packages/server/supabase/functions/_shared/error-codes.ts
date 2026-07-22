/**
 * FILE: packages/server/supabase/functions/_shared/error-codes.ts
 * PURPOSE: Single source of truth for API error codes returned in the
 *          canonical `{ ok: false, error: { code, message } }` envelope.
 *
 * Inspired by packages/cli/src/errors.ts (CliErrorCode). Adding a new code
 * is a deliberate act — prefer reusing an existing code. Keep this list in
 * sync with apps/docs (error catalog) and the OpenAPI Error.code enum via
 * scripts/check-error-codes.mjs.
 *
 * Client-safe rule: codes are stable and machine-readable; never embed
 * Postgres / stack / secret detail in `message`. Use reportError / Sentry
 * for the full diagnostic.
 */

/** Closed set of well-known API error codes. */
export const API_ERROR_CODES = [
  // Auth / identity
  'MISSING_AUTH',
  'INVALID_TOKEN',
  'MISSING_API_KEY',
  'INVALID_API_KEY',
  'INSUFFICIENT_SCOPE',
  'KEY_NOT_MIGRATED',
  'ORG_KEY_NOT_ALLOWED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'SERVER_MISCONFIGURED',

  // Tenant / scope
  'NO_ORG',
  'ORG_REQUIRED',
  'NO_ORGANIZATION',
  'NO_PROJECT',
  'PROJECT_NOT_FOUND',
  'PROJECT_NO_ORG',
  'INVALID_PROJECT_ID',
  'INVALID_ORGANIZATION_ID',

  // Validation / request shape
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'BAD_BODY',
  'BAD_JSON',
  'INVALID_JSON',
  'INVALID_BODY',
  'INVALID_PAYLOAD',
  'INVALID_INPUT',
  'INVALID_SIGNATURE',
  'MISSING_BODY',
  'MISSING_SIGNATURE',
  'NO_SECRET',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE',
  'RATE_LIMITED',
  'EXPIRED',

  // Persistence
  'DB_ERROR',
  'RPC_ERROR',
  'INSERT_FAILED',
  'UPDATE_FAILED',
  'DELETE_FAILED',

  // Upstream / integrations
  'NETWORK_ERROR',
  'TIMEOUT',
  'UPSTREAM_ERROR',
  'GITHUB_ERROR',
  'GH_SECRETS_FORBIDDEN',
  'GH_NOT_CONNECTED',
  'LLM_ERROR',
  'LLM_UNAVAILABLE',
  'ALL_KEYS_EXHAUSTED',
  'SECRET_DETECTED',

  // Entitlement
  'FEATURE_NOT_IN_PLAN',
  'PLAN_UPGRADE_REQUIRED',
  'QUOTA_EXCEEDED',

  // Transport / platform
  'CLIENT_CLOSED_REQUEST',
  'INTERNAL',
  'INTERNAL_ERROR',
  'HTTP_ERROR',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

const CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES)

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return CODE_SET.has(value)
}

/**
 * Classify a Supabase/Postgres error as a transient infrastructure failure
 * (pooler reset, Cloudflare 522 origin timeout) versus a genuine
 * application-level DB error.
 *
 * Transient failures MUST NOT be reported to Sentry as exceptions — they
 * are external infra noise that self-resolves and would regress repeatedly
 * (the same pattern fixed in sentryHonoErrorHandler for client-abort errors).
 * Log them to Supabase Logs instead so they remain queryable without polluting
 * the error budget.
 *
 * SAFETY: the overriding requirement is to NEVER silence a real bug. The gate is
 * therefore biased toward reporting — a genuine coded SQLSTATE is never routed to
 * logs by message matching, and the message patterns are anchored to specific
 * pooler/Cloudflare signatures rather than broad tokens (a bare "522" or
 * "connection refused" would false-match IDs, values, or persistent misconfig).
 *
 * Classification order:
 *   1. Valid SQLSTATE present → transient ONLY for the connection_exception
 *      family (class 08) and 57P03 cannot_connect_now. Every other coded error
 *      (42703 undefined_column, P0001 raise_exception, 53300 too_many_connections,
 *      57014 statement_timeout, XX000, …) is a REAL error and always reported.
 *   2. No SQLSTATE (socket-level failures carry none) → match specific transient
 *      transport signatures only.
 *
 * Pattern sources:
 *   - "delayed connect error: 111" / "upstream connect error" — Supabase pooler
 *     cold-start or transient reset (Supabase Discussions #26769).
 *   - Cloudflare "Error code 522" origin-timeout page (HTML body leaks into
 *     PostgREST error.message).
 */
export function isTransientDbConnectionError(
  err:
    | { message?: string; code?: string | null; details?: string | null }
    | null
    | undefined,
): boolean {
  if (!err) return false
  const msg = (err.message ?? '').toLowerCase()
  const rawCode = (err.code ?? '').trim()

  // A Postgres/PostgREST SQLSTATE is exactly 5 alphanumeric chars (2-char class +
  // 3-char subclass), e.g. 42703, P0001, 22P02, 08006, XX000 — NOT necessarily
  // 5 digits. If a valid SQLSTATE is present, trust it over the message.
  const sqlstate = /^[0-9A-Za-z]{5}$/.test(rawCode) ? rawCode.toUpperCase() : null
  if (sqlstate) {
    // Class 08 = connection_exception (connection_failure 08006,
    // sqlclient_unable_to_establish_sqlconnection 08001, etc.); 57P03 =
    // cannot_connect_now (server starting up). These are genuinely transient.
    if (sqlstate.startsWith('08') || sqlstate === '57P03') return true
    // Any OTHER coded error is a real DB/app error — never silence it, regardless
    // of what the message text happens to contain.
    return false
  }

  // No SQLSTATE — socket / gateway-level failures. Match NARROW, specific
  // signatures only (each denotes a reset/disconnect/origin-timeout, not a
  // persistent misconfiguration or an incidental substring).
  return (
    msg.includes('upstream connect error') ||
    msg.includes('delayed connect error') ||
    msg.includes('remote connection failure') ||
    msg.includes('transport failure reason') ||
    msg.includes('econnreset') ||
    msg.includes('connection reset by peer') ||
    msg.includes('socket hang up') ||
    msg.includes('server closed the connection unexpectedly') ||
    // Cloudflare 522 origin-timeout page — anchored to the Cloudflare markers,
    // not a bare "522" (which would match arbitrary numeric substrings).
    msg.includes('error code 522') ||
    msg.includes('522: connection timed out')
  )
}

/** Generic, non-leaking message for 5xx / DB failures shown to clients. */
export const SAFE_INTERNAL_MESSAGE =
  'Something went wrong on our side. The failure was logged — retry in a moment, or report this with the error code.'

/** Safe client message for DB/RPC failures (detail stays in Sentry). */
export const SAFE_DB_MESSAGE =
  'We could not load this data right now. Retry in a moment; if it keeps failing, quote the error code in a bug report.'
