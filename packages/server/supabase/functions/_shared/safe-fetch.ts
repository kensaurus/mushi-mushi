/**
 * FILE: packages/server/supabase/functions/_shared/safe-fetch.ts
 * PURPOSE: `publicFetch` — the one way the radar (Plan 020 §4) and the recipe
 *          probes (Plan 019 §6) read a user-supplied URL: version probes,
 *          store listings, RDAP, certificate logs, privacy pages.
 *
 * Rules (Plan 019 §6, "SSRF through user-supplied URLs"):
 *   - https only; embedded credentials, blocked ports and private / loopback /
 *     link-local / metadata hosts refused (`assertSafeOutboundUrl`);
 *   - redirects followed by hand (`redirect: 'manual'`), every hop re-checked,
 *     at most 3;
 *   - a 10 s deadline per hop;
 *   - the body read through a stream reader and cut at 1 MB (`truncated`);
 *   - never any credentials: the only headers are a fixed User-Agent and an
 *     optional Accept.
 *
 * DNS: each hop's hostname is resolved first (A + AAAA) and refused when any
 * answer is a private, loopback, link-local or metadata address. fetch() then
 * resolves the name again on its own and cannot be pinned to the address we
 * checked, so a rebinding DNS server can still answer differently the second
 * time. This check is defence in depth, not a guarantee. When the runtime has
 * no resolver (or it reports NotSupported) the hostname check above still
 * applies and the fetch proceeds.
 *
 * No module-level Deno.env reads: Deno tests run with no permission flags.
 */

import { assertSafeOutboundUrl, isPrivateOrSpecialHost } from './inventory-guards.ts'

export const PUBLIC_FETCH_USER_AGENT = 'MushiRadar/1 (+https://kensaur.us/mushi-mushi)'
export const PUBLIC_FETCH_MAX_BYTES = 1024 * 1024
export const PUBLIC_FETCH_TIMEOUT_MS = 10_000
export const PUBLIC_FETCH_MAX_REDIRECTS = 3

export interface PublicFetchOptions {
  /** Sent as `Accept`; nothing else is ever sent. */
  accept?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Resolve a hostname to its addresses. Defaults to Deno.resolveDns when present. */
  resolve?: (host: string) => Promise<string[]>
  /** For tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /**
   * The generic HTTP connector only: a JSON POST body and its
   * `X-Mushi-Signature: t=…,v1=…` HMAC (plugin-sdk format). The signature
   * proves the request came from Mushi; it is not a reusable credential.
   * Redirects are refused for a signed POST.
   */
  signedPost?: { body: string; signature: string }
}

export interface PublicFetchResult {
  status: number
  headers: Headers
  /** The URL that answered, after redirects. */
  finalUrl: string
  text: string
  /** True when the body was cut at `maxBytes`. */
  truncated: boolean
}

type DenoDns = { resolveDns?: (host: string, type: 'A' | 'AAAA') => Promise<string[]> }

/** Deno.resolveDns when the runtime has it, else null (Node / vitest, some edge runtimes). */
function defaultResolver(): ((host: string) => Promise<string[]>) | null {
  const deno = (globalThis as { Deno?: DenoDns }).Deno
  if (!deno || typeof deno.resolveDns !== 'function') return null
  const resolveDns = deno.resolveDns.bind(deno)
  return async (host: string) => {
    const out: string[] = []
    for (const type of ['A', 'AAAA'] as const) {
      try {
        out.push(...(await resolveDns(host, type)))
      } catch {
        // No record of this type (or the lookup is not supported) — try the other.
      }
    }
    return out
  }
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')
}

async function assertResolvesPublic(host: string, resolve: ((host: string) => Promise<string[]>) | null): Promise<void> {
  if (!resolve || isIpLiteral(host)) return
  let addrs: string[]
  try {
    addrs = await resolve(host)
  } catch (err) {
    // A resolver that cannot run here is not a refusal: the hostname check
    // already passed. See the file header.
    const name = (err as Error)?.name ?? ''
    if (name === 'NotSupported' || /not supported/i.test((err as Error)?.message ?? '')) return
    throw new Error(`outbound-blocked: DNS_FAILED ${host}`)
  }
  if (addrs.some((a) => isPrivateOrSpecialHost(a))) {
    throw new Error(`outbound-blocked: PRIVATE_HOST ${host}`)
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size))
      size = maxBytes
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    size += value.byteLength
  }
  const all = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.byteLength
  }
  return { text: new TextDecoder().decode(all), truncated }
}

/**
 * Fetch a public https URL safely. Throws `Error('outbound-blocked: …')` when
 * a hop is refused, and the fetch's own error on a network failure or timeout.
 */
export async function publicFetch(rawUrl: string, opts: PublicFetchOptions = {}): Promise<PublicFetchResult> {
  const timeoutMs = opts.timeoutMs ?? PUBLIC_FETCH_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? PUBLIC_FETCH_MAX_BYTES
  const maxRedirects = opts.maxRedirects ?? PUBLIC_FETCH_MAX_REDIRECTS
  const fetchImpl = opts.fetchImpl ?? fetch
  const resolve = opts.resolve ?? defaultResolver()
  const headers: Record<string, string> = { 'User-Agent': PUBLIC_FETCH_USER_AGENT }
  if (opts.accept) headers.Accept = opts.accept
  if (opts.signedPost) {
    headers['Content-Type'] = 'application/json'
    headers['X-Mushi-Signature'] = opts.signedPost.signature
  }

  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = assertSafeOutboundUrl(current)
    if (!check.ok) throw new Error(`outbound-blocked: ${check.reason}`)
    await assertResolvesPublic(check.url.hostname, resolve)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await fetchImpl(check.url.toString(), {
        method: opts.signedPost ? 'POST' : 'GET',
        ...(opts.signedPost ? { body: opts.signedPost.body } : {}),
        headers,
        redirect: 'manual',
        credentials: 'omit',
        signal: ac.signal,
      })
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {})
        if (hop >= maxRedirects) throw new Error('outbound-blocked: TOO_MANY_REDIRECTS')
        if (opts.signedPost) throw new Error('outbound-blocked: REDIRECT_ON_SIGNED_POST')
        current = new URL(location, check.url).toString()
        continue
      }
      const body = await readCapped(res, maxBytes)
      return { status: res.status, headers: res.headers, finalUrl: check.url.toString(), text: body.text, truncated: body.truncated }
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('outbound-blocked: TOO_MANY_REDIRECTS')
}
