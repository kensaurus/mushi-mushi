/**
 * FILE: packages/server/supabase/functions/_shared/cors.ts
 * PURPOSE: Single source of truth for the PUBLIC (non-credentialed) CORS
 *          origin policy. Admin/console surfaces use the env-driven
 *          allowlist + credentials in api/index.ts — never this. These
 *          constants exist for anonymous, API-key- or HMAC-authenticated
 *          surfaces (agent cards, OpenAPI spec, public JSON Schemas, MCP)
 *          that previously hand-rolled `Access-Control-Allow-Origin: '*'`
 *          per handler; changing the public policy now happens here once.
 *          (Backend architecture audit 2026-07-24, finding 5.)
 */

/** Origin value for deliberately-public, non-credentialed endpoints. */
export const PUBLIC_CORS_ORIGIN = '*'

/** Spreadable header fragment for public Response header maps. */
export const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin': PUBLIC_CORS_ORIGIN,
} as const
