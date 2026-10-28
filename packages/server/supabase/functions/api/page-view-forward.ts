/**
 * FILE: packages/server/supabase/functions/api/page-view-forward.ts
 * PURPOSE: `api`'s half of POST /v1/public/page-view (the cookieless landing
 *          page-view count, api/routes/landing-visits.ts in `api-ext`).
 *
 * The route runs in `api-ext` (deploy size limit, _shared/edge-proxy.ts), but
 * only `api` sees the visitor's IP: `api-ext` receives the request from
 * `api`, so its cf-connecting-ip is `api`'s own. So `api` hashes the IP into
 * the rate-limit bucket (sha-256 of scope, UTC day, secret and IP, folded into
 * a uuid like the public auth endpoints' actor id) and forwards only that hash, never
 * the IP itself, with the internal caller secret so a direct call to
 * `api-ext` cannot pick its own bucket.
 */

import type { Context } from 'npm:hono@4'
import { proxyToFunction } from '../_shared/edge-proxy.ts'
import { MAX_BEACON_BODY, PAGE_VIEW_SCOPE, VISITOR_BUCKET_HEADER } from '../_shared/landing-visits.ts'
import { extractClientIp, ipRateLimitActorId } from './routes/cli-auth.ts'

export async function forwardPageView(c: Context): Promise<Response> {
  const secret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) return new Response(null, { status: 204 })
  const body = await c.req.text()
  // A beacon is a few dozen bytes; refuse anything larger before forwarding.
  if (body.length > MAX_BEACON_BODY) return new Response(null, { status: 413 })

  const headers = new Headers(c.req.raw.headers)
  // The IP picks the bucket here and goes no further (cf-connecting-ip is the
  // one extractClientIp trusts; x-forwarded-for and x-real-ip carry it too).
  // The hash is salted with the secret and the UTC day: an unsalted SHA-256
  // of an IPv4 address can be reversed by trying them all, and a daily salt
  // keeps one visitor's buckets from linking across days.
  const day = new Date().toISOString().slice(0, 10)
  const bucket = await ipRateLimitActorId(extractClientIp(c), `${PAGE_VIEW_SCOPE}:${day}:${secret}`)
  headers.delete('cf-connecting-ip')
  headers.delete('x-forwarded-for')
  headers.delete('x-real-ip')
  headers.delete('cookie')
  headers.set('authorization', `Bearer ${secret}`)
  headers.set(VISITOR_BUCKET_HEADER, bucket)
  headers.set('content-type', 'text/plain')

  const forwarded = new Request(c.req.raw.url, { method: 'POST', headers, body })
  const res = await proxyToFunction(forwarded, 'api-ext', '/v1/public/page-view', {
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  })
  // The beacon never reads the answer; keep the status, drop the body.
  return new Response(null, { status: res.ok ? 204 : res.status })
}
