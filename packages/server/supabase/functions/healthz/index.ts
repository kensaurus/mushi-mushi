/**
 * FILE: packages/server/supabase/functions/healthz/index.ts
 * PURPOSE: Lightweight health-check endpoint. Returns HTTP 200 with a JSON
 *          body confirming the edge runtime is up and that the database is
 *          reachable. Unauthenticated — safe to call from monitoring tools,
 *          load balancers, and synthetic monitors.
 *
 * Response body:
 *   { "status": "ok", "db": "ok", "version": "<git-sha or 'unknown'>" }
 *
 *   On DB failure:
 *   { "status": "degraded", "db": "error", "version": "..." }  (HTTP 200)
 *
 *   On unhandled error:
 *   { "status": "error", "db": "unknown" }                     (HTTP 503)
 *
 * Config: verify_jwt = false (must NOT require a Supabase JWT — this endpoint
 * exists precisely so external monitors can reach it without credentials).
 *
 * Security: No user data is exposed. Version is a build-time public value.
 */

import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'

const ALLOWED_ORIGINS = ['*'] // health endpoint is public; no CORS restriction needed

const VERSION: string =
  (typeof Deno !== 'undefined' ? Deno.env.get('MUSHI_VERSION') : undefined) ?? 'unknown'

const log = rootLog.child('healthz')

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  }

  try {
    // Cheap DB probe — a single round-trip with no table access
    let dbStatus: 'ok' | 'error' = 'ok'
    try {
      const db = getServiceClient()
      const { error } = await db.rpc('get_db_epoch_ms').single()
      if (error) {
        log.warn('healthz DB probe failed', { err: error.message })
        dbStatus = 'error'
      }
    } catch (dbErr) {
      log.warn('healthz DB probe threw', { err: String(dbErr) })
      dbStatus = 'error'
    }

    const body = JSON.stringify({
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      db: dbStatus,
      version: VERSION,
    })

    return new Response(body, { status: 200, headers })
  } catch (err) {
    log.error('healthz unhandled error', { err: String(err) })
    return new Response(
      JSON.stringify({ status: 'error', db: 'unknown', version: VERSION }),
      { status: 503, headers },
    )
  }
})
