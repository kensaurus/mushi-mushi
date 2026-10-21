/**
 * FILE: packages/server/supabase/functions/_shared/edge-proxy.ts
 * PURPOSE: Forward a request to another edge function of this project.
 *
 *          Supabase refuses a function whose source is over its deployment
 *          size limit (HTTP 413 "Function source code exceeds the maximum
 *          deployment size (5 MB)"). `api` crossed it on 2026-10-21 when the
 *          CI runner routes landed, so self-contained route groups now live in
 *          `api-ext` and `api` forwards their paths there. Public URLs, CORS
 *          and the console's API base stay the same; `api-ext` runs the routes'
 *          own auth on the forwarded headers.
 *
 * Pure apart from fetch: no Deno globals, so vitest imports it directly.
 */

/** Headers a hop must not forward (RFC 9110 §7.6.1), plus ones fetch sets itself. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

export interface ProxyOptions {
  /** This project's Supabase URL (SUPABASE_URL). */
  supabaseUrl: string
  fetchImpl?: typeof fetch
}

/**
 * The URL in `fn` for a request `api` received. `apiPath` is the path after
 * the function's `/api` base (for example `/v1/admin/ci/overview`).
 */
export function proxyTargetUrl(supabaseUrl: string, fn: string, apiPath: string, search: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(fn)) throw new Error(`bad function name: ${fn}`)
  if (!apiPath.startsWith('/v1/')) throw new Error(`only /v1/ paths are forwarded: ${apiPath}`)
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${fn}${apiPath}${search}`
}

/** Forward `req` to function `fn`, streaming the body both ways. */
export async function proxyToFunction(req: Request, fn: string, apiPath: string, opts: ProxyOptions): Promise<Response> {
  const url = new URL(req.url)
  const target = proxyTargetUrl(opts.supabaseUrl, fn, apiPath, url.search)
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value)
  })
  headers.set('x-mushi-forwarded-by', 'api')
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const upstream = await (opts.fetchImpl ?? fetch)(target, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: 'manual',
    // Required by fetch for a streamed request body.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)
  // A fetched Response has immutable headers; `api`'s CORS middleware sets
  // headers on the response it returns, so hand it a mutable copy.
  const out = new Headers()
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value)
  })
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
}
