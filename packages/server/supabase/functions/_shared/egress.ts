/**
 * FILE: packages/server/supabase/functions/_shared/egress.ts
 * PURPOSE: The local-only egress guard (Plan 023 Phase 0, ADR 0034).
 *
 * With `MUSHI_LOCAL_ONLY=1`, every `fetch` an edge function makes is checked
 * against an allowlist before a socket opens. A host outside it throws
 * `EgressBlockedError` (code `EGRESS_BLOCKED`) and the denial is counted in
 * `public.egress_denials` (per host, caller and UTC day). Without the flag
 * nothing is wrapped and nothing changes.
 *
 * Allowed:
 *   - the host of SUPABASE_URL (any port): the database, storage, and the
 *     denial recorder itself, so recording can never be blocked;
 *   - loopback: 127.0.0.0/8, ::1, `localhost`, `*.localhost`;
 *   - private networks: 10/8, 172.16/12, 192.168/16 (RFC 1918), 100.64/10
 *     (CGNAT), 169.254/16 and fe80::/10 (link-local), fc00::/7 (unique local);
 *   - names under `.internal`, `.local` and `.lan`;
 *   - `MUSHI_EGRESS_ALLOW`, a comma list of `host`, `*.domain` (subdomains
 *     only), `host:port`, IP literals and CIDRs (`10.1.0.0/16`, `[fd00::]/8`).
 *
 * Compose service names (`ollama`, `kong`) are single-label names a search
 * domain could resolve publicly, so they are not allowed by default: list them
 * in MUSHI_EGRESS_ALLOW.
 *
 * Tricks it defeats: userinfo (`https://localhost@evil.com`; the URL parser
 * gives the real host), trailing dots, uppercase, IPv6 brackets, IPv4-mapped
 * IPv6 (`::ffff:7f00:1` is judged as 127.0.0.1), decimal / hex / octal IPv4
 * (`2130706433`, `0x7f.1`), and redirects: a followed redirect is re-requested
 * by hand (`redirect: 'manual'`) so every hop goes through the same check.
 *
 * Limits: the guard wraps `globalThis.fetch`. Code that opens raw sockets
 * (node:net, Deno.connect, SMTP) must call `assertEgressAllowed` itself, and
 * DNS still resolves names (an allowed name can point anywhere). The compose
 * profile enforces at the network too, which is why both exist.
 *
 * This module must not import logger.ts or sentry.ts: sentry.ts installs the
 * guard, and logger.ts imports sentry.ts.
 */

export const EGRESS_BLOCKED = 'EGRESS_BLOCKED'

/** Redirect hops the wrapper follows by hand before giving up (fetch's own cap is 20). */
export const EGRESS_MAX_REDIRECTS = 10

export class EgressBlockedError extends Error {
  readonly code = EGRESS_BLOCKED
  readonly host: string
  readonly caller: string
  constructor(host: string, caller: string) {
    super(
      `Mushi is in local-only mode (MUSHI_LOCAL_ONLY=1), so the request to ${host} was blocked before it left. ` +
        `Add the host to MUSHI_EGRESS_ALLOW to allow it.`,
    )
    this.name = 'EgressBlockedError'
    this.host = host
    this.caller = caller
  }
}

export function isEgressBlockedError(err: unknown): err is EgressBlockedError {
  return (
    err instanceof EgressBlockedError ||
    (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === EGRESS_BLOCKED)
  )
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Parse an IPv4 literal the way the WHATWG URL parser does: 1–4 parts, each
 * decimal, hex (`0x`) or octal (leading 0); the last part fills the remaining
 * bytes. Returns the 32-bit value, or null when the text is not an IPv4 form.
 */
export function parseIPv4(text: string): number | null {
  const s = text.endsWith('.') ? text.slice(0, -1) : text
  if (!s) return null
  const parts = s.split('.')
  if (parts.length > 4) return null
  const nums: number[] = []
  for (const p of parts) {
    if (!p) return null
    let n: number
    if (/^0x[0-9a-f]*$/i.test(p)) n = p.length === 2 ? 0 : parseInt(p.slice(2), 16)
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p.slice(1), 8)
    else if (/^(0|[1-9][0-9]*)$/.test(p)) n = Number(p)
    else return null
    if (!Number.isFinite(n)) return null
    nums.push(n)
  }
  const last = nums[nums.length - 1]!
  for (let i = 0; i < nums.length - 1; i++) if (nums[i]! > 255) return null
  if (last >= 256 ** (5 - nums.length)) return null
  let value = last
  for (let i = 0; i < nums.length - 1; i++) value += nums[i]! * 256 ** (3 - i)
  return value >>> 0
}

/** Parse an IPv6 literal (no brackets, optional zone and embedded IPv4) into 8 hextets. */
export function parseIPv6(text: string): number[] | null {
  let s = text.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (!s.includes(':')) return null
  let tail: number[] = []
  const lastColon = s.lastIndexOf(':')
  const maybeV4 = s.slice(lastColon + 1)
  if (maybeV4.includes('.')) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(maybeV4)) return null
    const v4 = maybeV4.split('.').map(Number)
    if (v4.some((n) => n > 255)) return null
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!]
    s = s.slice(0, lastColon + 1) + '0:0'
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const read = (part: string): number[] | null => {
    if (!part) return []
    const out: number[] = []
    for (const h of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null
      out.push(parseInt(h, 16))
    }
    return out
  }
  const head = read(halves[0]!)
  const rest = halves.length === 2 ? read(halves[1]!) : []
  if (!head || !rest) return null
  let words: number[]
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length
    if (fill < 1) return null
    words = [...head, ...new Array(fill).fill(0), ...rest]
  } else {
    words = head
  }
  if (words.length !== 8) return null
  if (tail.length) words.splice(6, 2, ...tail)
  return words
}

export type ParsedHost =
  | { kind: 'ipv4'; value: number; text: string }
  | { kind: 'ipv6'; words: number[]; text: string }
  | { kind: 'name'; text: string }

/**
 * Canonical form of a URL hostname: lowercase, no brackets, no trailing dot,
 * IPv4 forms resolved, IPv4-mapped / IPv4-compatible IPv6 turned into IPv4.
 */
export function parseHost(hostname: string): ParsedHost {
  let h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  while (h.endsWith('.')) h = h.slice(0, -1)
  if (h.includes(':')) {
    const words = parseIPv6(h)
    if (words) {
      // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible) reach an IPv4 host.
      const mapped = words.slice(0, 5).every((w) => w === 0) && (words[5] === 0xffff || (words[5] === 0 && (words[6] !== 0 || words[7]! > 1)))
      if (mapped) {
        const value = ((words[6]! << 16) | words[7]!) >>> 0
        return { kind: 'ipv4', value, text: ipv4Text(value) }
      }
      return { kind: 'ipv6', words, text: words.map((w) => w.toString(16)).join(':') }
    }
    return { kind: 'name', text: h }
  }
  const v4 = parseIPv4(h)
  if (v4 !== null) return { kind: 'ipv4', value: v4, text: ipv4Text(v4) }
  return { kind: 'name', text: h }
}

function ipv4Text(v: number): string {
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.')
}

function inV4(value: number, base: number, bits: number): boolean {
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0
  return ((value & mask) >>> 0) === ((base & mask) >>> 0)
}

function inV6(words: number[], base: number[], bits: number): boolean {
  let left = bits
  for (let i = 0; i < 8 && left > 0; i++) {
    const take = Math.min(16, left)
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff
    if ((words[i]! & mask) !== (base[i]! & mask)) return false
    left -= take
  }
  return true
}

const V4_LOCAL: ReadonlyArray<[number, number, string]> = [
  [parseIPv4('127.0.0.0')!, 8, 'loopback'],
  [parseIPv4('10.0.0.0')!, 8, 'private network'],
  [parseIPv4('172.16.0.0')!, 12, 'private network'],
  [parseIPv4('192.168.0.0')!, 16, 'private network'],
  [parseIPv4('100.64.0.0')!, 10, 'carrier-grade NAT'],
  [parseIPv4('169.254.0.0')!, 16, 'link-local'],
]

const LOCAL_SUFFIXES = ['.internal', '.local', '.lan', '.localhost']

/** Why a host counts as local, or null when it does not. */
export function localHostReason(host: ParsedHost): string | null {
  if (host.kind === 'ipv4') {
    for (const [base, bits, why] of V4_LOCAL) if (inV4(host.value, base, bits)) return why
    return null
  }
  if (host.kind === 'ipv6') {
    const w = host.words
    if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return 'loopback'
    if ((w[0]! & 0xfe00) === 0xfc00) return 'private network'
    if ((w[0]! & 0xffc0) === 0xfe80) return 'link-local'
    return null
  }
  if (host.text === 'localhost') return 'loopback'
  for (const suffix of LOCAL_SUFFIXES) {
    if (host.text.endsWith(suffix) && host.text.length > suffix.length) return `${suffix} name`
  }
  return null
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export type AllowEntry =
  | { kind: 'name'; name: string; port: number | null; raw: string }
  | { kind: 'suffix'; suffix: string; port: number | null; raw: string }
  | { kind: 'cidr4'; base: number; bits: number; port: number | null; raw: string }
  | { kind: 'cidr6'; base: number[]; bits: number; port: number | null; raw: string }

function splitPort(entry: string): { host: string; port: number | null } | null {
  if (entry.startsWith('[')) {
    const close = entry.indexOf(']')
    if (close < 0) return null
    const host = entry.slice(1, close)
    const after = entry.slice(close + 1)
    // `[fd00::]/8` keeps its prefix length on the host part.
    if (after.startsWith('/')) return { host: host + after, port: null }
    if (!after) return { host, port: null }
    if (!/^:\d{1,5}$/.test(after)) return null
    return { host, port: Number(after.slice(1)) }
  }
  // A bare IPv6 literal or CIDR has several colons and no port.
  if ((entry.match(/:/g) ?? []).length > 1) return { host: entry, port: null }
  const m = /^(.*):(\d{1,5})$/.exec(entry)
  if (m) return { host: m[1]!, port: Number(m[2]) }
  return { host: entry, port: null }
}

/** Parse one MUSHI_EGRESS_ALLOW entry; null when it cannot be understood (it is then ignored). */
export function parseAllowEntry(rawEntry: string): AllowEntry | null {
  const raw = rawEntry.trim()
  if (!raw) return null
  const split = splitPort(raw.toLowerCase())
  if (!split) return null
  const { port } = split
  if (port !== null && (port < 1 || port > 65535)) return null
  let host = split.host
  while (host.endsWith('.')) host = host.slice(0, -1)
  if (!host) return null
  const slash = host.indexOf('/')
  if (slash >= 0) {
    const bits = Number(host.slice(slash + 1))
    const addr = parseHost(host.slice(0, slash))
    if (!Number.isInteger(bits)) return null
    if (addr.kind === 'ipv4' && bits >= 0 && bits <= 32) return { kind: 'cidr4', base: addr.value, bits, port, raw }
    if (addr.kind === 'ipv6' && bits >= 0 && bits <= 128) return { kind: 'cidr6', base: addr.words, bits, port, raw }
    return null
  }
  if (host.startsWith('*.')) {
    const suffix = host.slice(1)
    if (suffix.length < 2 || suffix.includes('*')) return null
    return { kind: 'suffix', suffix, port, raw }
  }
  if (host.includes('*')) return null
  const addr = parseHost(host)
  if (addr.kind === 'ipv4') return { kind: 'cidr4', base: addr.value, bits: 32, port, raw }
  if (addr.kind === 'ipv6') return { kind: 'cidr6', base: addr.words, bits: 128, port, raw }
  return { kind: 'name', name: addr.text, port, raw }
}

export function parseEgressAllow(raw: string | null | undefined): AllowEntry[] {
  return (raw ?? '')
    .split(',')
    .map(parseAllowEntry)
    .filter((e): e is AllowEntry => e !== null)
}

function entryMatches(entry: AllowEntry, host: ParsedHost, port: number): boolean {
  if (entry.port !== null && entry.port !== port) return false
  switch (entry.kind) {
    case 'name':
      return host.kind === 'name' && host.text === entry.name
    case 'suffix':
      return host.kind === 'name' && host.text.endsWith(entry.suffix) && host.text.length > entry.suffix.length
    case 'cidr4':
      return host.kind === 'ipv4' && inV4(host.value, entry.base, entry.bits)
    case 'cidr6':
      return host.kind === 'ipv6' && inV6(host.words, entry.base, entry.bits)
  }
}

export interface EgressPolicy {
  localOnly: boolean
  /** Canonical host of SUPABASE_URL, when set. */
  supabaseHost: string | null
  allow: AllowEntry[]
}

export interface EgressEnv {
  MUSHI_LOCAL_ONLY?: string
  MUSHI_EGRESS_ALLOW?: string
  SUPABASE_URL?: string
}

function truthy(v: string | undefined | null): boolean {
  return /^(1|true|yes|on)$/i.test((v ?? '').trim())
}

export function policyFromEnv(env: EgressEnv): EgressPolicy {
  let supabaseHost: string | null = null
  if (env.SUPABASE_URL) {
    try {
      supabaseHost = parseHost(new URL(env.SUPABASE_URL).hostname).text
    } catch {
      supabaseHost = null
    }
  }
  return { localOnly: truthy(env.MUSHI_LOCAL_ONLY), supabaseHost, allow: parseEgressAllow(env.MUSHI_EGRESS_ALLOW) }
}

/** Read the guard's env from Deno; empty outside Deno or without env permission (tests). */
export function readEgressEnv(): EgressEnv {
  const deno = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno
  const get = (name: string): string | undefined => {
    try {
      return deno?.env?.get(name)
    } catch {
      return undefined
    }
  }
  return {
    MUSHI_LOCAL_ONLY: get('MUSHI_LOCAL_ONLY'),
    MUSHI_EGRESS_ALLOW: get('MUSHI_EGRESS_ALLOW'),
    SUPABASE_URL: get('SUPABASE_URL'),
  }
}

/** True when MUSHI_LOCAL_ONLY is on in this runtime's env. */
export function isLocalOnly(env: EgressEnv = readEgressEnv()): boolean {
  return truthy(env.MUSHI_LOCAL_ONLY)
}

export interface EgressDecision {
  allowed: boolean
  /** Canonical host (IPv6 without brackets), or the scheme for a non-network URL. */
  host: string
  port: number | null
  reason: string
}

const NON_NETWORK_SCHEMES = new Set(['data:', 'blob:', 'file:'])

function defaultPort(protocol: string): number {
  if (protocol === 'https:' || protocol === 'wss:') return 443
  if (protocol === 'http:' || protocol === 'ws:') return 80
  return 0
}

/** Decide whether a URL may be fetched under the policy. Pure. */
export function checkEgress(rawUrl: string | URL, policy: EgressPolicy): EgressDecision {
  let url: URL
  try {
    url = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl
  } catch {
    return { allowed: false, host: String(rawUrl).slice(0, 200), port: null, reason: 'not a valid URL' }
  }
  if (NON_NETWORK_SCHEMES.has(url.protocol)) {
    return { allowed: true, host: url.protocol, port: null, reason: 'does not use the network' }
  }
  const host = parseHost(url.hostname)
  const port = url.port ? Number(url.port) : defaultPort(url.protocol)
  if (!policy.localOnly) return { allowed: true, host: host.text, port, reason: 'local-only mode is off' }
  if (!host.text) return { allowed: false, host: '', port, reason: 'no host' }
  if (policy.supabaseHost && host.text === policy.supabaseHost) {
    return { allowed: true, host: host.text, port, reason: 'the Supabase host' }
  }
  const local = localHostReason(host)
  if (local) return { allowed: true, host: host.text, port, reason: local }
  for (const entry of policy.allow) {
    if (entryMatches(entry, host, port)) return { allowed: true, host: host.text, port, reason: `MUSHI_EGRESS_ALLOW ${entry.raw}` }
  }
  return { allowed: false, host: host.text, port, reason: 'not on the egress allowlist' }
}

/** The allowlist as people read it: built-in rules first, then the env entries. */
export function describeAllowlist(policy: EgressPolicy): string[] {
  const out: string[] = []
  if (policy.supabaseHost) out.push(policy.supabaseHost)
  out.push(
    'localhost',
    '127.0.0.0/8',
    '::1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '100.64.0.0/10',
    '169.254.0.0/16',
    'fc00::/7',
    'fe80::/10',
    '*.internal',
    '*.local',
    '*.lan',
    '*.localhost',
  )
  for (const e of policy.allow) out.push(e.raw)
  return out
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

type FetchFn = typeof fetch

export interface DenialRecorder {
  (host: string, caller: string): void | Promise<void>
}

interface GuardState {
  original: FetchFn
  policy: EgressPolicy
  record: DenialRecorder
}

const GUARD_KEY = Symbol.for('mushi.egressGuard')
let caller = 'unknown'

/** Name the function that is running, for the denial log (withSentry sets it). */
export function setEgressCaller(name: string | null | undefined): void {
  if (name && name !== 'unknown') caller = name.slice(0, 100)
}

export function egressCaller(): string {
  return caller
}

function guardState(): GuardState | undefined {
  return (globalThis as Record<symbol, GuardState | undefined>)[GUARD_KEY]
}

/** The policy the installed guard enforces, or the env's policy when none is installed. */
export function activeEgressPolicy(): EgressPolicy {
  return guardState()?.policy ?? policyFromEnv(readEgressEnv())
}

/** The fetch the guard wrapped (for the recorder and tests); the global fetch when none is installed. */
export function unguardedFetch(): FetchFn {
  return guardState()?.original ?? globalThis.fetch
}

/**
 * Record a denial in `public.egress_denials` through the service-role RPC.
 * Uses the unwrapped fetch: the Supabase host is allowed anyway, and this
 * keeps a recorder failure from looping back into the guard. Never throws.
 */
export function supabaseDenialRecorder(
  env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string },
  fetchImpl: () => FetchFn = unguardedFetch,
): DenialRecorder {
  return async (host, who) => {
    const base = env.SUPABASE_URL?.replace(/\/+$/, '')
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!base || !key) return
    try {
      const res = await fetchImpl()(`${base}/rest/v1/rpc/record_egress_denial`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_host: host.slice(0, 255), p_caller: who.slice(0, 100) }),
        signal: AbortSignal.timeout(3_000),
      })
      await res.body?.cancel().catch(() => {})
    } catch {
      // The denial already threw for the caller; losing one count is acceptable.
    }
  }
}

function logOnce(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', scope: 'mushi:egress', event, ...fields }))
}

function deny(state: GuardState, decision: EgressDecision): never {
  const who = caller
  logOnce('egress_blocked', { host: decision.host, port: decision.port, caller: who })
  try {
    const pending = state.record(decision.host, who)
    if (pending && typeof (pending as Promise<void>).catch === 'function') (pending as Promise<void>).catch(() => {})
  } catch {
    // Recording is best effort.
  }
  throw new EgressBlockedError(decision.host, who)
}

/** Throw EgressBlockedError when the URL may not be reached. For raw-socket paths (SMTP) and gating. */
export function assertEgressAllowed(rawUrl: string | URL, policy: EgressPolicy = activeEgressPolicy()): void {
  const decision = checkEgress(rawUrl, policy)
  if (decision.allowed) return
  const state = guardState()
  if (state) deny(state, decision)
  throw new EgressBlockedError(decision.host, caller)
}

/** Boolean form for code that skips work instead of failing (crons, probes). */
export function egressAllowed(rawUrl: string | URL, policy: EgressPolicy = activeEgressPolicy()): boolean {
  return checkEgress(rawUrl, policy).allowed
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return (input as Request).url
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization']

function makeGuardedFetch(state: GuardState): FetchFn {
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const first = checkEgress(requestUrl(input), state.policy)
    if (!first.allowed) deny(state, first)

    const isRequest = typeof input !== 'string' && !(input instanceof URL)
    const mode = init?.redirect ?? (isRequest ? (input as Request).redirect : 'follow')
    // 'manual' and 'error' never follow on their own, and a caller that follows
    // by hand calls fetch again for each hop, which this wrapper checks.
    if (mode !== 'follow') return state.original(input, init)

    let res = await state.original(input, { ...init, redirect: 'manual' })
    let currentUrl = new URL(requestUrl(input))
    let method = (init?.method ?? (isRequest ? (input as Request).method : 'GET')).toUpperCase()
    let body = init?.body
    const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined))
    for (let hop = 0; ; hop++) {
      const location = res.headers.get('location')
      if (!REDIRECT_STATUSES.has(res.status) || !location) return res
      if (hop >= EGRESS_MAX_REDIRECTS) {
        await res.body?.cancel().catch(() => {})
        throw new TypeError(`fetch failed: more than ${EGRESS_MAX_REDIRECTS} redirects`)
      }
      const next = new URL(location, currentUrl)
      const decision = checkEgress(next, state.policy)
      if (!decision.allowed) {
        await res.body?.cancel().catch(() => {})
        deny(state, decision)
      }
      // Fetch's own rules: 303 (and 301/302 after a POST) become a GET without a body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        if (method !== 'HEAD') method = 'GET'
        body = undefined
        headers.delete('content-type')
        headers.delete('content-length')
      } else if (isRequest && (input as Request).body && init?.body === undefined) {
        // A Request's body stream was used by the first hop and cannot be sent again.
        return res
      }
      if (next.origin !== currentUrl.origin) for (const h of CREDENTIAL_HEADERS) headers.delete(h)
      await res.body?.cancel().catch(() => {})
      currentUrl = next
      res = await state.original(next.href, { ...init, method, headers, body, redirect: 'manual' })
    }
  }
  return guarded as FetchFn
}

export interface InstallOptions {
  env?: EgressEnv & { SUPABASE_SERVICE_ROLE_KEY?: string }
  /** Replaces the Supabase recorder (tests). */
  record?: DenialRecorder
}

/**
 * Wrap globalThis.fetch when local-only mode is on. Idempotent: a second call
 * keeps the first wrapper (and its original fetch). Returns true when the
 * guard is installed after the call.
 */
export function installEgressGuard(opts: InstallOptions = {}): boolean {
  if (guardState()) return true
  const env = opts.env ?? { ...readEgressEnv(), SUPABASE_SERVICE_ROLE_KEY: readServiceRoleKey() }
  const policy = policyFromEnv(env)
  if (!policy.localOnly) return false
  const original = globalThis.fetch.bind(globalThis) as FetchFn
  const state: GuardState = { original, policy, record: opts.record ?? supabaseDenialRecorder(env, () => original) }
  ;(globalThis as Record<symbol, GuardState | undefined>)[GUARD_KEY] = state
  globalThis.fetch = makeGuardedFetch(state)
  return true
}

/** Tests only: put the original fetch back. */
export function uninstallEgressGuard(): void {
  const state = guardState()
  if (!state) return
  globalThis.fetch = state.original
  delete (globalThis as Record<symbol, GuardState | undefined>)[GUARD_KEY]
}

function readServiceRoleKey(): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno
  try {
    return deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY')
  } catch {
    return undefined
  }
}

/** Log a skipped outbound job once per isolate, with the reason (Phase 4 gates). */
const skippedOnce = new Set<string>()
export function logEgressSkip(what: string, host: string): void {
  const key = `${what}:${host}`
  if (skippedOnce.has(key)) return
  skippedOnce.add(key)
  logOnce('egress_skipped', { what, host, reason: 'local-only mode is on and the host is not on the egress allowlist' })
}

/**
 * Phase 4 gate for jobs that only exist to reach the internet (npm registry,
 * radar probes, store connectors, web push, Stripe). True when the job may
 * run; false (logged once) when local-only mode blocks its host.
 */
export function outboundJobAllowed(what: string, url: string): boolean {
  const policy = activeEgressPolicy()
  const decision = checkEgress(url, policy)
  if (decision.allowed) return true
  logEgressSkip(what, decision.host)
  return false
}
