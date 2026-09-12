/**
 * FILE: packages/server/supabase/functions/_shared/mcp-protocol.ts
 * PURPOSE: Pure (no Deno globals, no DB) protocol-ladder rules for the hosted
 *          MCP endpoint (`mcp/index.ts`). The hosted handler is hand-rolled
 *          JSON-RPC by design (no SDK in the edge bundle), so the version
 *          negotiation, header validation and result envelopes that the
 *          2026-07-28 revision made mandatory live here where they can be
 *          unit-tested without spinning up the function.
 *
 * Two eras share one endpoint:
 *
 *   LEGACY  2024-11-05 · 2025-03-26 · 2025-06-18 · 2025-11-25
 *     - `initialize` handshake negotiates the version.
 *     - `MCP-Protocol-Version` header is read on every later POST; a missing
 *       header is treated as 2025-03-26 (spec default), an unknown value is a
 *       400 with `-32022` and the supported list in `error.data`.
 *     - JSON-RPC batch arrays are only legal for 2024-11-05 / 2025-03-26;
 *       batching was removed in 2025-06-18.
 *     - No `Mcp-Session-Id` is ever issued (stateless server).
 *
 *   MODERN  2026-07-28 (current)
 *     - No `initialize`; version, client capabilities and client info travel
 *       in `params._meta["io.modelcontextprotocol/*"]` on every request and
 *       the version MUST equal the header (else `-32020` HeaderMismatch).
 *     - `Mcp-Method` header on every POST; `Mcp-Name` on tools/call,
 *       resources/read, prompts/get (SEP-2243). Non-printable names use the
 *       `=?base64?…?=` sentinel.
 *     - `server/discover` works with no prior state.
 *     - Every result carries `resultType`; list results carry `ttlMs` and
 *       `cacheScope` (SEP-2549); server identity rides in result `_meta`.
 *     - `ping`, `logging/setLevel`, `notifications/roots/list_changed`,
 *       `notifications/elicitation/complete` are gone (`-32601`).
 *     - GET / DELETE answer 405.
 *
 * Verified against modelcontextprotocol.io on 2026-09-12.
 */

// ── Version ladder ───────────────────────────────────────────────────────────

export const MODERN_PROTOCOL_VERSION = '2026-07-28' as const

/** Newest first — the order we prefer when a client's request is unknown. */
export const LEGACY_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const

export const SUPPORTED_PROTOCOL_VERSIONS = [
  MODERN_PROTOCOL_VERSION,
  ...LEGACY_PROTOCOL_VERSIONS,
] as const

export type LegacyProtocolVersion = (typeof LEGACY_PROTOCOL_VERSIONS)[number]
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number]

/**
 * 2025-06-18 transports spec: "If the server does not receive an
 * MCP-Protocol-Version header … the server SHOULD assume protocol version
 * 2025-03-26."
 */
export const LEGACY_DEFAULT_PROTOCOL_VERSION: LegacyProtocolVersion = '2025-03-26'

/** JSON-RPC batching existed only in these two revisions (removed 2025-06-18). */
export const BATCH_CAPABLE_VERSIONS: readonly LegacyProtocolVersion[] = ['2025-03-26', '2024-11-05']

// ── Error codes (2026-07-28 core) ────────────────────────────────────────────

export const ERR_HEADER_MISMATCH = -32020
export const ERR_MISSING_CLIENT_CAPABILITY = -32021
export const ERR_UNSUPPORTED_PROTOCOL_VERSION = -32022
const ERR_INVALID_REQUEST = -32600

// ── `_meta` keys (SEP-2575 / SEP-2663 / SEP-414) ─────────────────────────────

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo'
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'
export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks'

// ── Era resolution ───────────────────────────────────────────────────────────

export type ProtocolEra =
  | { era: 'modern'; version: typeof MODERN_PROTOCOL_VERSION }
  | { era: 'legacy'; version: LegacyProtocolVersion; headerPresent: boolean }

export interface McpProtocolError {
  code: number
  message: string
  data?: unknown
  /** HTTP status the transport should answer with (400 for header faults). */
  httpStatus: number
}

export type ProtocolEraResult =
  | { ok: true; era: ProtocolEra }
  | { ok: false; error: McpProtocolError }

function isLegacyVersion(v: string): v is LegacyProtocolVersion {
  return (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(v)
}

export function unsupportedVersionError(received: string | null): McpProtocolError {
  return {
    code: ERR_UNSUPPORTED_PROTOCOL_VERSION,
    message: `Unsupported MCP protocol version${received ? `: ${received}` : ''}`,
    data: { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS], received },
    httpStatus: 400,
  }
}

/**
 * Classify a request by its `MCP-Protocol-Version` header. Missing header
 * ⇒ legacy 2025-03-26 (spec default, and what every pre-2025-06-18 client
 * sends). Unknown value ⇒ 400 / -32022.
 */
export function resolveProtocolEra(headerValue: string | null | undefined): ProtocolEraResult {
  const raw = typeof headerValue === 'string' ? headerValue.trim() : ''
  if (!raw) {
    return { ok: true, era: { era: 'legacy', version: LEGACY_DEFAULT_PROTOCOL_VERSION, headerPresent: false } }
  }
  if (raw === MODERN_PROTOCOL_VERSION) {
    return { ok: true, era: { era: 'modern', version: MODERN_PROTOCOL_VERSION } }
  }
  if (isLegacyVersion(raw)) {
    return { ok: true, era: { era: 'legacy', version: raw, headerPresent: true } }
  }
  return { ok: false, error: unsupportedVersionError(raw) }
}

/**
 * Legacy `initialize` negotiation. If we support what the client asked for
 * we MUST answer with the same version; otherwise we answer with the newest
 * legacy version we support. A missing `protocolVersion` keeps the historic
 * 2025-03-26 default so old clients see no change.
 */
export function negotiateLegacyVersion(clientWanted: unknown): LegacyProtocolVersion {
  if (typeof clientWanted !== 'string' || clientWanted.trim() === '') {
    return LEGACY_DEFAULT_PROTOCOL_VERSION
  }
  const wanted = clientWanted.trim()
  return isLegacyVersion(wanted) ? wanted : LEGACY_PROTOCOL_VERSIONS[0]
}

/** JSON-RPC batch arrays are accepted only for the two batch-capable revisions. */
export function batchAllowed(era: ProtocolEra): boolean {
  return era.era === 'legacy' && BATCH_CAPABLE_VERSIONS.includes(era.version)
}

export function batchRejectedError(era: ProtocolEra): McpProtocolError {
  return {
    code: ERR_INVALID_REQUEST,
    message:
      `JSON-RPC batch arrays are not supported for protocol version ${era.version} ` +
      '(batching was removed in 2025-06-18). Send one request per POST.',
    httpStatus: 400,
  }
}

// ── Mcp-Name encoding (SEP-2243) ─────────────────────────────────────────────

const MCP_NAME_B64_PREFIX = '=?base64?'
const MCP_NAME_B64_SUFFIX = '?='
// Printable ASCII is 0x20..0x7E. Anything else must be encoded.
const ASCII_PRINTABLE_RE = /^[\x20-\x7e]*$/

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Header-safe encoding of a tool / prompt name or resource URI. */
export function encodeMcpName(value: string): string {
  if (ASCII_PRINTABLE_RE.test(value)) return value
  return `${MCP_NAME_B64_PREFIX}${bytesToBase64(new TextEncoder().encode(value))}${MCP_NAME_B64_SUFFIX}`
}

/** Inverse of {@link encodeMcpName}. Returns `null` when the sentinel is malformed. */
export function decodeMcpName(header: string): string | null {
  const v = header.trim()
  if (v.startsWith(MCP_NAME_B64_PREFIX) && v.endsWith(MCP_NAME_B64_SUFFIX)) {
    const inner = v.slice(MCP_NAME_B64_PREFIX.length, v.length - MCP_NAME_B64_SUFFIX.length)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(inner))
    } catch {
      return null
    }
  }
  return v
}

// ── Modern request metadata ──────────────────────────────────────────────────

export interface ModernClientCapabilities {
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

export interface ModernRequestMeta {
  protocolVersion: string | null
  clientCapabilities: ModernClientCapabilities
  clientInfo: { name?: string; version?: string } | null
  /** True when the client declared `io.modelcontextprotocol/tasks`. */
  declaresTasks: boolean
  traceparent: string | null
  tracestate: string | null
  baggage: string | null
}

function metaOf(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const m = params?._meta
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {}
}

const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i

export function readModernMeta(params: Record<string, unknown> | undefined): ModernRequestMeta {
  const meta = metaOf(params)
  const pv = meta[META_PROTOCOL_VERSION]
  const capsRaw = meta[META_CLIENT_CAPABILITIES]
  const caps: ModernClientCapabilities =
    capsRaw && typeof capsRaw === 'object' && !Array.isArray(capsRaw)
      ? (capsRaw as ModernClientCapabilities)
      : {}
  const ext = caps.extensions
  const declaresTasks =
    !!ext && typeof ext === 'object' && !Array.isArray(ext) && TASKS_EXTENSION_ID in (ext as Record<string, unknown>)
  const infoRaw = meta[META_CLIENT_INFO]
  const clientInfo =
    infoRaw && typeof infoRaw === 'object' && !Array.isArray(infoRaw)
      ? (infoRaw as { name?: string; version?: string })
      : null
  const tp = typeof meta.traceparent === 'string' && TRACEPARENT_RE.test(meta.traceparent.trim())
    ? meta.traceparent.trim()
    : null
  return {
    protocolVersion: typeof pv === 'string' ? pv : null,
    clientCapabilities: caps,
    clientInfo,
    declaresTasks,
    traceparent: tp,
    tracestate: typeof meta.tracestate === 'string' ? meta.tracestate : null,
    baggage: typeof meta.baggage === 'string' ? meta.baggage : null,
  }
}

/** Trace context of a request regardless of era (SEP-414 `_meta` keys). */
export function readTraceMeta(params: Record<string, unknown> | undefined): {
  traceparent: string | null
  tracestate: string | null
  baggage: string | null
} {
  const m = readModernMeta(params)
  return { traceparent: m.traceparent, tracestate: m.tracestate, baggage: m.baggage }
}

/** W3C traceparent → Sentry `sentry-trace` header (`traceId-spanId-sampled`). */
export function sentryTraceFromTraceparent(traceparent: string): string | null {
  const m = TRACEPARENT_RE.exec(traceparent.trim())
  if (!m) return null
  const parts = traceparent.trim().split('-')
  const sampled = parseInt(parts[3], 16) & 0x01 ? '1' : '0'
  return `${parts[1].toLowerCase()}-${parts[2].toLowerCase()}-${sampled}`
}

// ── Modern header validation (SEP-2243 + SEP-2575) ───────────────────────────

/** Methods whose `Mcp-Name` header must carry `params.name` / `params.uri`. */
export const MODERN_NAMED_METHODS: Readonly<Record<string, 'name' | 'uri'>> = {
  'tools/call': 'name',
  'resources/read': 'uri',
  'prompts/get': 'name',
}

/** Requests that 2026-07-28 removed from the core protocol (answer -32601). */
export const MODERN_REMOVED_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'notifications/initialized',
  'initialized',
  'ping',
  'logging/setLevel',
  'notifications/roots/list_changed',
  'notifications/elicitation/complete',
  'resources/subscribe',
  'resources/unsubscribe',
])

export interface HeaderBag {
  get(name: string): string | null
}

function mismatch(message: string, data?: unknown): McpProtocolError {
  return { code: ERR_HEADER_MISMATCH, message, data, httpStatus: 400 }
}

/**
 * Validate a single modern-era JSON-RPC message against its HTTP headers.
 * Returns `null` when the request is well-formed, else the 400 to send.
 */
export function validateModernRequest(
  headers: HeaderBag,
  rpc: { method: string; params?: Record<string, unknown> },
  headerVersion: string,
): McpProtocolError | null {
  const meta = readModernMeta(rpc.params)
  if (meta.protocolVersion === null) {
    return mismatch(
      `Missing params._meta["${META_PROTOCOL_VERSION}"]; 2026-07-28 clients send it on every request`,
      { header: headerVersion, meta: null },
    )
  }
  if (meta.protocolVersion !== headerVersion) {
    return mismatch(
      `MCP-Protocol-Version header (${headerVersion}) does not match params._meta["${META_PROTOCOL_VERSION}"] (${meta.protocolVersion})`,
      { header: headerVersion, meta: meta.protocolVersion },
    )
  }
  const mcpMethod = headers.get('Mcp-Method')
  if (mcpMethod === null || mcpMethod.trim() === '') {
    return mismatch('Missing Mcp-Method header (required on every 2026-07-28 POST)', {
      header: null,
      body: rpc.method,
    })
  }
  if (mcpMethod.trim() !== rpc.method) {
    return mismatch(`Mcp-Method header (${mcpMethod.trim()}) does not match JSON-RPC method (${rpc.method})`, {
      header: mcpMethod.trim(),
      body: rpc.method,
    })
  }
  const nameField = MODERN_NAMED_METHODS[rpc.method]
  if (nameField) {
    const bodyValue = rpc.params?.[nameField]
    const headerRaw = headers.get('Mcp-Name')
    if (headerRaw === null || headerRaw.trim() === '') {
      return mismatch(`Missing Mcp-Name header (required for ${rpc.method})`, {
        header: null,
        body: typeof bodyValue === 'string' ? bodyValue : null,
      })
    }
    const decoded = decodeMcpName(headerRaw)
    if (decoded === null || typeof bodyValue !== 'string' || decoded !== bodyValue) {
      return mismatch(`Mcp-Name header does not match params.${nameField}`, {
        header: headerRaw.trim(),
        body: typeof bodyValue === 'string' ? bodyValue : null,
      })
    }
  }
  return null
}

// ── Result envelopes ─────────────────────────────────────────────────────────

export type CacheScope = 'public' | 'private'

/** Static per-feature-group catalogs: safe to cache for an hour. */
export const TOOL_LIST_TTL_MS = 3_600_000
/** `resources/read` returns live project data: short, per-caller cache. */
export const RESOURCE_READ_TTL_MS = 30_000

export interface CacheableResult {
  ttlMs: number
  cacheScope: CacheScope
}

export function cacheable<T extends Record<string, unknown>>(
  result: T,
  ttlMs: number,
  cacheScope: CacheScope,
): T & CacheableResult {
  return { ...result, ttlMs, cacheScope }
}

export type ResultType = 'complete' | 'input_required' | 'task'

export interface ServerDiscoverResult extends Record<string, unknown> {
  resultType: 'complete'
  supportedVersions: ProtocolVersion[]
  capabilities: {
    tools: Record<string, unknown>
    resources: Record<string, unknown>
    prompts: Record<string, unknown>
    extensions: Record<string, Record<string, unknown>>
  }
  instructions?: string
  ttlMs: number
  cacheScope: CacheScope
  _meta: { [META_SERVER_INFO]: { name: string; version: string; title?: string } }
}

export function buildServerDiscoverResult(opts: {
  serverInfo: { name: string; version: string; title?: string }
  instructions?: string
  ttlMs?: number
}): ServerDiscoverResult {
  const { name, version, title } = opts.serverInfo
  return {
    resultType: 'complete',
    supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      extensions: { [TASKS_EXTENSION_ID]: {} },
    },
    ...(opts.instructions ? { instructions: opts.instructions } : {}),
    ttlMs: opts.ttlMs ?? TOOL_LIST_TTL_MS,
    cacheScope: 'public',
    _meta: { [META_SERVER_INFO]: { name, version, ...(title ? { title } : {}) } },
  }
}

/**
 * Stamp `resultType` (default "complete") and the server identity onto a
 * modern-era result. Results that already declare a `resultType`
 * (`input_required`, `task`) keep it.
 */
export function withModernResultEnvelope(
  result: unknown,
  serverInfo: { name: string; version: string; title?: string },
): Record<string, unknown> {
  const base: Record<string, unknown> =
    result && typeof result === 'object' && !Array.isArray(result) ? { ...(result as Record<string, unknown>) } : { value: result }
  if (typeof base.resultType !== 'string') base.resultType = 'complete'
  const existingMeta =
    base._meta && typeof base._meta === 'object' && !Array.isArray(base._meta)
      ? (base._meta as Record<string, unknown>)
      : {}
  base._meta = {
    ...existingMeta,
    [META_SERVER_INFO]: {
      name: serverInfo.name,
      version: serverInfo.version,
      ...(serverInfo.title ? { title: serverInfo.title } : {}),
    },
  }
  return base
}

/** Sort tools by name so `tools/list` is deterministic across isolates. */
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
