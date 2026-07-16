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

/** Generic, non-leaking message for 5xx / DB failures shown to clients. */
export const SAFE_INTERNAL_MESSAGE =
  'Something went wrong on our side. The failure was logged — retry in a moment, or report this with the error code.'

/** Safe client message for DB/RPC failures (detail stays in Sentry). */
export const SAFE_DB_MESSAGE =
  'We could not load this data right now. Retry in a moment; if it keeps failing, quote the error code in a bug report.'
