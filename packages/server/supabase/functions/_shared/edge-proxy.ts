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
  /**
   * Secret that signs the caller's IP for the next function (the service
   * role key). The hop is a new request through Supabase's edge, so the
   * next function's own `cf-connecting-ip` may be `api`'s address, not the
   * visitor's; per-IP limits there read the signed header instead.
   */
  clientIpSecret?: string
}

/** The caller's IP and its HMAC, set by `api` on a forward (see verifiedClientIp). */
export const CLIENT_IP_HEADER = 'x-mushi-client-ip'
export const CLIENT_IP_SIG_HEADER = 'x-mushi-client-ip-sig'

/**
 * The caller's IP as this function sees it: Cloudflare's header, else the
 * rightmost X-Forwarded-For hop (the one a client cannot write); null if none.
 */
export function clientIpOf(header: (name: string) => string | null | undefined): string | null {
  const cf = header('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean)
  return xff?.length ? xff[xff.length - 1] : null
}

async function signClientIp(secret: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`client-ip:${ip}`))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The IP `api` signed on the forward, or null when the header is missing or
 * its signature does not match (a caller hitting this function directly, or
 * forging the header, gets null and the caller falls back to clientIpOf).
 */
export async function verifiedClientIp(header: (name: string) => string | null | undefined, secret: string | undefined): Promise<string | null> {
  const ip = header(CLIENT_IP_HEADER)?.trim()
  const sig = header(CLIENT_IP_SIG_HEADER)?.trim()
  if (!ip || !sig || !secret || ip.length > 64) return null
  const want = await signClientIp(secret, ip)
  if (want.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0 ? ip : null
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
  // Never pass on a client-supplied IP header; sign the real one instead.
  headers.delete(CLIENT_IP_HEADER)
  headers.delete(CLIENT_IP_SIG_HEADER)
  const ip = clientIpOf((n) => req.headers.get(n))
  if (ip && opts.clientIpSecret) {
    headers.set(CLIENT_IP_HEADER, ip)
    headers.set(CLIENT_IP_SIG_HEADER, await signClientIp(opts.clientIpSecret, ip))
  }
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
