/**
 * FILE: packages/server/supabase/functions/_shared/public-url-guard.ts
 * PURPOSE: Only public web addresses for the free Production Check.
 *
 *          A stranger pastes a URL and Mushi's servers fetch it, so every
 *          address (the one pasted, every redirect hop, every link and script
 *          checked) passes `checkPublicUrl` and, where DNS is available,
 *          `resolvesPublic` before a request leaves:
 *            - http or https only, no user:password, no port but the default;
 *            - no localhost, single-label names or private suffixes
 *              (.local, .internal, .localhost, .lan, .home.arpa, ...);
 *            - no IP literal in a private, loopback, link-local, shared,
 *              documentation, multicast or reserved range (IPv4 and IPv6,
 *              IPv4-mapped IPv6 included). WHATWG URL parsing already turns
 *              `2130706433` and `0x7f.1` into `127.0.0.1`, so those forms are
 *              caught as the dotted address.
 *            - a hostname whose A/AAAA records include such an address is
 *              refused too (DNS answers can point anywhere).
 *          `guardedFetch` follows redirects by hand (redirect: 'manual') and
 *          re-checks each hop, at most 5.
 *
 * No Deno globals at module scope; DNS and fetch are injectable for tests.
 */

export type UrlCheck =
  | { ok: true; url: URL; origin: string }
  | { ok: false; code: 'INVALID_URL' | 'NOT_PUBLIC'; message: string }

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.private',
  '.home.arpa',
  '.in-addr.arpa',
  '.ip6.arpa',
  '.test',
  '.invalid',
  '.example',
]

const NOT_PUBLIC = 'Enter the address of a public website. Local, private and internal addresses are not checked.'

/** Parse a pasted address (scheme optional) and refuse anything non-public. */
export function checkPublicUrl(raw: unknown): UrlCheck {
  if (typeof raw !== 'string') return { ok: false, code: 'INVALID_URL', message: 'Enter your site\'s address, like https://example.com.' }
  const text = raw.trim()
  if (!text || text.length > 2048) return { ok: false, code: 'INVALID_URL', message: 'Enter your site\'s address, like https://example.com.' }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'That does not look like a web address.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, code: 'INVALID_URL', message: 'Only http and https addresses can be checked.' }
  }
  if (url.username || url.password) return { ok: false, code: 'NOT_PUBLIC', message: NOT_PUBLIC }
  // URL drops the port when it is the scheme's default, so any port left is not.
  if (url.port !== '') return { ok: false, code: 'NOT_PUBLIC', message: NOT_PUBLIC }
  if (!isPublicHostname(url.hostname)) return { ok: false, code: 'NOT_PUBLIC', message: NOT_PUBLIC }
  url.hash = ''
  return { ok: true, url, origin: url.origin }
}

/** Hostname rules, without DNS. `hostname` is as URL gives it (IPv6 in brackets). */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '')
  if (!host) return false
  if (host.startsWith('[')) {
    const groups = parseIpv6(host.slice(1, -1))
    return groups !== null && isPublicIpv6(groups)
  }
  const v4 = parseIpv4(host)
  if (v4) return isPublicIpv4(v4)
  if (host === 'localhost' || !host.includes('.')) return false
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false
  return /^[a-z0-9.-]+$/.test(host) && !host.split('.').some((label) => label === '' || label.length > 63)
}

/** A literal IP address (as DNS returns it) is public. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4) return isPublicIpv4(v4)
  const v6 = parseIpv6(address)
  return v6 !== null && isPublicIpv6(v6)
}

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false // shared address space (CGNAT)
  if (a === 169 && b === 254) return false // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

/** Eight 16-bit groups, or null. Accepts `::` compression and a dotted IPv4 tail. */
function parseIpv6(text: string): number[] | null {
  let s = text.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (!/^[0-9a-f:.]+$/.test(s)) return null
  let tail: number[] = []
  const lastColon = s.lastIndexOf(':')
  if (s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(s.slice(lastColon + 1))
    if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    // Drop ":a.b.c.d", keeping a "::" that ran right up to it.
    const before = s.slice(0, lastColon)
    s = before.endsWith(':') ? `${before}:` : before
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part ? part.split(':') : []).map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  const head = parse(halves[0])
  const rest = halves.length === 2 ? parse(halves[1]) : []
  if ([...head, ...rest].some(Number.isNaN)) return null
  const needed = 8 - tail.length
  if (halves.length === 2) {
    const fill = needed - head.length - rest.length
    if (fill < 1) return null
    return [...head, ...new Array(fill).fill(0), ...rest, ...tail]
  }
  return head.length === needed ? [...head, ...tail] : null
}

function isPublicIpv6(g: number[]): boolean {
  if (g.every((x) => x === 0)) return false // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff])
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return false // NAT64 can reach internal IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return false // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return false // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return false // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false // documentation
  if (g[0] === 0x2002) return false // 6to4 wraps any IPv4
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false // discard
  return true
}

/** Resolves a hostname's addresses of one record type; throws when there are none. */
export type DnsResolver = (hostname: string, type: 'A' | 'AAAA') => Promise<string[]>

/** Deno.resolveDns when the runtime has it, else null (no DNS check possible). */
export function runtimeResolver(): DnsResolver | null {
  const deno = (globalThis as { Deno?: { resolveDns?: (h: string, t: 'A' | 'AAAA') => Promise<string[]> } }).Deno
  return typeof deno?.resolveDns === 'function' ? (h, t) => deno.resolveDns!(h, t) : null
}

/**
 * Whether every address the hostname resolves to is public. A name with no
 * A or AAAA record at all is refused (the site cannot be reached). Without a
 * resolver the hostname rules alone decide.
 */
export async function resolvesPublic(hostname: string, resolver: DnsResolver | null): Promise<boolean> {
  if (!isPublicHostname(hostname)) return false
  const host = hostname.replace(/\.+$/, '')
  if (!resolver || host.startsWith('[') || parseIpv4(host)) return true
  const answers = await Promise.allSettled([resolver(host, 'A'), resolver(host, 'AAAA')])
  const addresses = answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : []))
  if (addresses.length === 0) return false
  return addresses.every(isPublicAddress)
}

export interface GuardedFetchOptions {
  method?: 'GET' | 'HEAD'
  headers?: Record<string, string>
  signal?: AbortSignal
  maxRedirects?: number
  fetchImpl?: typeof fetch
  resolver?: DnsResolver | null
}

export interface GuardedResponse {
  response: Response
  /** The address that answered (after redirects). */
  finalUrl: string
  /** Every address requested, first to last. */
  hops: string[]
}

export class BlockedUrlError extends Error {
  constructor(readonly url: string) {
    super('Refused a non-public address.')
  }
}

/** fetch() that re-checks every redirect hop against the public-URL rules. */
export async function guardedFetch(start: string, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  const doFetch = opts.fetchImpl ?? fetch
  const maxRedirects = opts.maxRedirects ?? 5
  const hops: string[] = []
  let current = start
  for (let i = 0; i <= maxRedirects; i++) {
    const checked = checkPublicUrl(current)
    if (!checked.ok || !(await resolvesPublic(checked.url.hostname, opts.resolver ?? null))) {
      throw new BlockedUrlError(current)
    }
    hops.push(checked.url.href)
    const response = await doFetch(checked.url.href, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      redirect: 'manual',
      signal: opts.signal,
    })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {})
      current = new URL(location, checked.url).href
      continue
    }
    return { response, finalUrl: checked.url.href, hops }
  }
  throw new Error('Too many redirects.')
}
