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

/**
 * Preflight cache lifetime for the public SDK / reporter surfaces. The SDK's
 * custom headers (X-Mushi-Api-Key, X-Reporter-*) force a preflight on every
 * call; without this every 60 s badge poll was an OPTIONS plus a GET
 * (300–900 ms each from Japan). Browsers cap it lower (Chrome: 2 h,
 * Firefox: 24 h), and the cache is keyed per URL, so a poll URL should stay
 * stable (Plan 018 §4.4).
 */
export const PUBLIC_CORS_MAX_AGE_SECONDS = 86_400
