import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'
import { upsertProjectSdkObservationAsync } from './sdk-observation.ts'
import { mergeLogContext, type LogContext } from './log-context.ts'
import { emitFunnelEvent } from './setup-funnel.ts'
import type { ApiErrorCode } from './error-codes.ts'

export interface ProjectContext {
  projectId: string
  projectName: string
}

/** Canonical auth failure envelope — always includes `ok: false`. */
function authError(
  c: Context,
  code: ApiErrorCode,
  message: string,
  status: 401 | 403 = 401,
): Response {
  const requestId = c.get('requestId') as string | undefined
  return c.json(
    {
      ok: false,
      error: { code, message, ...(requestId ? { requestId } : {}) },
    },
    status,
  )
}

/**
 * Shape of a `project_api_keys` row joined with `projects(name)` (left-join).
 * Declared locally so we don't have to thread the generated Supabase types
 * into every Edge Function just for this one query.
 *
 * project_id is nullable since the mcp_org_scoped_keys migration (20260617200000).
 * Org-scoped keys (is_org_scoped = true) have project_id = NULL and grant access
 * to all projects owned by owner_user_id.
 */
interface ApiKeyRow {
  id?: string
  key_prefix?: string | null
  project_id: string | null
  is_org_scoped?: boolean
  is_active: boolean
  scopes: string[] | null
  owner_user_id: string | null
  projects: { name: string } | null
  last_seen_origin?: string | null
  browser_seen_at?: string | null
}

/**
 * Why an agent-scope (mcp:*) use of this key must be refused, or null.
 *
 * A key that a web page sends is public: anyone can read it from the bundle.
 * The SDK only needs report:write, so an mcp:* scope on such a key lets a
 * stranger list and change the project's reports. Two signals, either enough:
 *   - this request comes from a browser (Origin, Referer or Sec-Fetch-Site —
 *     headers a page cannot strip from a cross-origin request);
 *   - the key has ever been seen from a browser. browser_seen_at is sticky;
 *     last_seen_origin is the older column, which a later origin-less call
 *     overwrites with null, so it only counts while it is still set.
 * Agents (CLI, MCP, hosted MCP, VS Code) call from a server process and send
 * none of these headers.
 */
export function mcpKeyBrowserExposure(
  headers: { origin?: string | null; referer?: string | null; secFetchSite?: string | null },
  key: { last_seen_origin?: string | null; browser_seen_at?: string | null },
): 'browser_request' | 'key_seen_in_browser' | null {
  if (headers.origin || headers.referer || headers.secFetchSite) return 'browser_request'
  if (key.browser_seen_at || key.last_seen_origin) return 'key_seen_in_browser'
  return null
}

const BROWSER_EXPOSURE_MESSAGE: Record<'browser_request' | 'key_seen_in_browser', string> = {
  browser_request:
    'Keys with MCP scopes cannot be used from a web page, because anything a page sends is public. ' +
    'Use this key from the CLI or an MCP client, and give web apps an SDK key (report:write only).',
  key_seen_in_browser:
    'This key has been used from a web page, so treat it as public: its MCP scopes are refused. ' +
    'Mint an agent key with `mushi login` (or in the console) and keep it out of browser bundles.',
}

function refuseBrowserExposedMcpKey(
  c: Context,
  key: { last_seen_origin?: string | null; browser_seen_at?: string | null },
): Response | null {
  const reason = mcpKeyBrowserExposure(
    {
      origin: c.req.header('Origin'),
      referer: c.req.header('Referer'),
      secFetchSite: c.req.header('Sec-Fetch-Site'),
    },
    key,
  )
  if (!reason) return null
  return authError(c, 'KEY_EXPOSED_IN_BROWSER', BROWSER_EXPOSURE_MESSAGE[reason], 403)
}

function applyLogContext(c: Context, patch: LogContext): void {
  const prev = c.get('logContext') as LogContext | undefined
  c.set('logContext', mergeLogContext(prev, patch))
}

/**
 * Constant-time string equality.
 *
 * Classic `a === b` short-circuits on the first mismatched byte and leaks a
 * measurable timing side-channel under load — attackers with a few thousand
 * requests can infer correct-prefix-length. Deno ships a Web Crypto runtime
 * but no built-in `timingSafeEqual`, so we use a simple XOR-reduce over
 * same-length byte arrays. Lengths are always compared via the same shape.
 *
 * Exported so other Edge Functions (webhook HMAC verifiers, API key
 * comparisons) can share a single hardened primitive.
 */
export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  // Always walk a fixed-length buffer so attackers can't use length-mismatch
  // early returns as a timing channel. We XOR a sentinel diff on length drift.
  const len = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) {
    const ai = aBytes[i] ?? 0
    const bi = bBytes[i] ?? 0
    diff |= ai ^ bi
  }
  return diff === 0
}

/**
 * Gate an Edge Function handler to trusted internal callers.
 *
 * Why this exists: Supabase Edge Functions with `verify_jwt = false` are
 * publicly reachable by default. Functions like `fast-filter`,
 * `classify-report`, and `fix-worker` are meant for *internal* server-to-server
 * calls (from the `api` function and cron jobs) but used to have no auth
 * check of their own — making it trivial to burn LLM budget or trigger
 * fix-worker PR creation from outside.
 *
 * Accepted credentials (either one is sufficient):
 *   1. `MUSHI_INTERNAL_CALLER_SECRET` — a non-reserved shared secret we
 *      control, used by Postgres cron jobs (pg_net) that can't read the
 *      runtime-injected `SUPABASE_SERVICE_ROLE_KEY`. The Supabase CLI
 *      refuses to set secrets whose name starts with `SUPABASE_`, so
 *      cron can never know the exact value of the auto-injected key.
 *      A dedicated shared secret sidesteps that constraint entirely.
 *   2. `SUPABASE_SERVICE_ROLE_KEY` — still accepted for callers that run
 *      *inside* the edge runtime (e.g. `api` calling `fix-worker`), where
 *      the env var is auto-injected and guaranteed to match.
 *
 * The check uses constant-time string equality on stable header values and
 * returns a generic 401 so scanners can't distinguish "env missing" from
 * "token mismatched".
 *
 * @returns null when authorized; Response (401) when not — caller returns it.
 */
export function requireServiceRoleAuth(req: Request): Response | null {
  const internalSecret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!internalSecret && !serviceRoleKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'SERVER_MISCONFIGURED', message: 'No internal auth configured' },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!token) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Requires valid internal caller token' },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const matches =
    (internalSecret !== undefined && timingSafeEqual(token, internalSecret)) ||
    (serviceRoleKey !== undefined && timingSafeEqual(token, serviceRoleKey))

  if (!matches) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Requires valid internal caller token' },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return null
}

/**
 * Every Mushi-issued API key is minted as `mushi_<hex>` (see
 * `api/routes/project-keys.ts` and `mcp-admin.ts`). A Supabase user JWT is a
 * base64url `eyJ…` string and never carries this prefix, so the prefix is a
 * safe, allocation-free discriminator for "is this bearer token an API key?".
 */
const MUSHI_API_KEY_PREFIX = 'mushi_'

/**
 * SHA-256 of a raw API key, lowercase hex — matches how keys are persisted
 * in `project_api_keys.key_hash`. Extracted so `apiKeyAuth` and
 * `adminOrApiKey` stay byte-compatible with the hash at rest.
 */
async function hashApiKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * SDK heartbeat: how recent must `last_seen_at` be for a key before we skip
 * a redundant heartbeat write. 30s gives operators near-real-time feedback
 * on the dashboard ("we just saw your SDK") without making every
 * report-batch submission contend on the same row.
 */
const SDK_HEARTBEAT_THROTTLE_MS = 30_000

/**
 * Truncate User-Agent values before they hit the DB. Some SDKs append
 * verbose plugin lists; cap at a sensible width to keep rows small.
 */
const MAX_HEARTBEAT_UA_LEN = 512

/**
 * Record an SDK heartbeat on `project_api_keys` after a successful API-key
 * auth. The heartbeat is the canonical "is the SDK reaching this backend"
 * signal that drives the `sdk_installed` step in /v1/admin/setup. It
 * replaces the old "wait for a non-admin report" heuristic which falsely
 * flagged correctly-installed SDKs as missing whenever (a) no real bug had
 * been triggered yet or (b) the SDK was talking to a different backend
 * than the admin (cross-env mismatches like local vs cloud Supabase).
 *
 * Three guarantees:
 *   1. Fire-and-forget. Auth has already succeeded; any heartbeat write
 *      failure is swallowed so the SDK request still completes.
 *   2. Throttled. We only update when `last_seen_at` is null or older
 *      than the throttle window. The conditional WHERE clause runs
 *      server-side so even concurrent SDK calls converge cheaply.
 *   3. Bounded payload. UA is truncated; origin/host come straight from
 *      headers we already trust. None of these fields contain user data.
 */
export const MUSHI_SDK_PACKAGE_HEADER = 'X-Mushi-SDK-Package'
export const MUSHI_SDK_VERSION_HEADER = 'X-Mushi-SDK-Version'

function recordSdkHeartbeat(opts: {
  db: ReturnType<typeof getServiceClient>
  keyHash: string
  projectId: string | null
  origin: string | null
  userAgent: string | null
  endpointHost: string | null
  sdkPackage?: string | null
  sdkVersion?: string | null
}): void {
  const { db, keyHash, projectId, origin, userAgent, endpointHost, sdkPackage, sdkVersion } = opts
  const cutoffIso = new Date(Date.now() - SDK_HEARTBEAT_THROTTLE_MS).toISOString()
  const truncatedUa =
    userAgent && userAgent.length > MAX_HEARTBEAT_UA_LEN
      ? userAgent.slice(0, MAX_HEARTBEAT_UA_LEN)
      : userAgent

  // Two-layer race guard: the .or() filter lets concurrent first-time
  // requests both update (no row gets stuck), and the throttle filter
  // collapses subsequent in-window writes into the first one.
  void db
    .from('project_api_keys')
    .update({
      last_seen_at: new Date().toISOString(),
      last_seen_origin: origin,
      last_seen_user_agent: truncatedUa,
      last_seen_endpoint_host: endpointHost,
    })
    .eq('key_hash', keyHash)
    .or(`last_seen_at.is.null,last_seen_at.lt.${cutoffIso}`)
    .select('id, owner_user_id, last_seen_at')
    .then((result) => {
      if (projectId && sdkPackage && sdkVersion) {
        upsertProjectSdkObservationAsync(db, {
          projectId,
          sdkPackage,
          sdkVersion,
          source: 'heartbeat',
        })
      }
      // Emit sdk_first_heartbeat once per project — the UNIQUE constraint in
      // setup_funnel_events absorbs any concurrent or duplicate emits.
      const row = result.data?.[0]
      if (projectId && row) {
        void emitFunnelEvent(db, {
          userId: row.owner_user_id ?? null,
          projectId,
          eventName: 'sdk_first_heartbeat',
          dedupKey: projectId, // once per project, not per key
          source: 'api',
          metadata: { key_id: row.id, origin, sdk_package: sdkPackage, sdk_version: sdkVersion },
        })
      }
    }, () => {
      // Swallow — never fail the auth path on a heartbeat write.
    })

  // Sticky: once a page has sent this key it is public, and a later
  // origin-less call must not clear that (last_seen_origin above would).
  // Read by mcpKeyBrowserExposure.
  if (origin) {
    void db
      .from('project_api_keys')
      .update({ browser_seen_at: new Date().toISOString() })
      .eq('key_hash', keyHash)
      .is('browser_seen_at', null)
      .then(() => {}, () => {})
  }
}

/**
 * Best-effort host extraction from a request URL. Hono guarantees
 * `c.req.url` is well-formed, but Edge Functions can be invoked with a
 * malformed URL during local dev, so we fail closed to null.
 */
function extractEndpointHost(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/**
 * RFC 4122 UUID format check — used to reject obviously bogus
 * `X-Mushi-Org-Id` values *before* we hand them to Postgres. Without
 * this guard a bad header turns into a `22P02 invalid input syntax for
 * type uuid` error in pg, which (a) wastes a round-trip and (b)
 * pollutes error telemetry with noise that's clearly client-side.
 *
 * Loose hex-quad pattern; we don't validate version/variant bits because
 * the database CHECK constraints already do.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Fire-and-forget activity heartbeat for `(org_id, user_id)` pairs.
 *
 * Why this exists: every annual seat audit and every "who's actually
 * using their paid seat" question needs to walk back from the API's
 * authenticated request stream to a per-member timestamp. Without it,
 * admins guessing at activity from `created_at` end up paying for
 * dormant seats and underestimating power users — both of which
 * surface as bad calls in support tickets.
 *
 * Three properties this implementation guarantees:
 *
 *   1. Coalesced. The actual UPDATE only fires when the row is stale
 *      by ≥ 5 minutes (enforced inside `private.touch_org_member_activity`).
 *      A user firing 100 requests in an hour generates ~12 row writes,
 *      not 100 — so MVCC bloat, replication lag, and the
 *      `(organization_id, last_active_at DESC)` index stay bounded
 *      regardless of org size or chattiness.
 *
 *   2. Fire-and-forget. The heartbeat runs after auth has already
 *      succeeded; any failure (DB unavailable, RPC missing, network
 *      blip) is swallowed so the user's request still completes.
 *      The cost of a missed heartbeat is "the next request reconciles
 *      it" — never a user-visible failure.
 *
 *   3. Validated. The org-id header is shape-checked before reaching
 *      Postgres so bad clients can't generate noisy 22P02 errors that
 *      drown signal in error telemetry.
 *
 * Called from {@link jwtAuth} once per authenticated admin request,
 * which already has both `userId` (from the JWT) and `X-Mushi-Org-Id`
 * (set by the admin SPA's `apiFetch` for every org-scoped call).
 */
function recordOrgMemberActivity(opts: {
  db: ReturnType<typeof getServiceClient>
  orgId: string
  userId: string
}): void {
  const { db, orgId, userId } = opts
  if (!UUID_RE.test(orgId) || !UUID_RE.test(userId)) return

  void db
    .rpc('touch_org_member_activity', { p_org_id: orgId, p_user_id: userId }, { count: 'exact' })
    .then(() => {
      // Coalesced UPDATE — no return value needed.
    }, () => {
      // Best-effort: never fail an authenticated request because a
      // metadata heartbeat couldn't write. Sentry already breadcrumbs
      // the underlying RPC failure separately.
    })
}

async function lookupActiveApiKey(apiKey: string): Promise<ApiKeyRow | null> {
  const db = getServiceClient()
  const keyHash = await hashApiKey(apiKey)
  // Use a left-join (`projects(name)` not `projects!inner(name)`) so org-scoped
  // keys (project_id = NULL) are not excluded by the inner-join filter.
  const { data, error } = await db
    .from('project_api_keys')
    .select(
      'id, key_prefix, project_id, is_org_scoped, is_active, scopes, owner_user_id, last_seen_origin, browser_seen_at, projects(name)',
    )
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()
  if (error || !data) return null
  return data as unknown as ApiKeyRow
}

const isAgentScope = (scope: McpScope): boolean => scope === 'mcp:read' || scope === 'mcp:write'

/** True iff the key's scopes satisfy ANY of the accepted scopes (mcp:write implies mcp:read). */
function keyGrantsAnyScope(scopes: string[], accepted: readonly McpScope[]): boolean {
  return accepted.some((s) => scopes.includes(s) || (s === 'mcp:read' && scopes.includes('mcp:write')))
}

async function authenticateApiKey(
  c: Context,
  apiKey: string,
  requiredScope: McpScope | readonly McpScope[],
): Promise<Response | null> {
  const keyRow = await lookupActiveApiKey(apiKey)
  if (!keyRow) {
    return authError(c, 'INVALID_API_KEY', 'Invalid or revoked API key')
  }

  const accepted: readonly McpScope[] = Array.isArray(requiredScope) ? requiredScope : [requiredScope as McpScope]
  const scopes = keyRow.scopes ?? []
  if (!keyGrantsAnyScope(scopes, accepted)) {
    const wanted = accepted.length === 1 ? `"${accepted[0]}"` : `one of ${accepted.map((s) => `"${s}"`).join(', ')}`
    return authError(
      c,
      'INSUFFICIENT_SCOPE',
      `API key is missing required scope ${wanted}. Mint a new key with the correct scope or upgrade this one in the admin console.`,
      403,
    )
  }

  if (accepted.some(isAgentScope)) {
    const exposed = refuseBrowserExposedMcpKey(c, keyRow)
    if (exposed) return exposed
  }

  const ownerId = keyRow.owner_user_id
  if (!ownerId) {
    return authError(
      c,
      'KEY_NOT_MIGRATED',
      'API key is missing owner metadata. Rotate the key to regenerate it.',
    )
  }

  const isOrgScoped = keyRow.is_org_scoped ?? false

  c.set('userId', ownerId)
  // For org-scoped keys project_id is null; routes that need a specific project
  // should read X-Mushi-Project-Id header and verify ownership via enumerateAccessibleProjectIds.
  c.set('projectId', keyRow.project_id ?? null)
  c.set('projectName', keyRow.projects?.name ?? (isOrgScoped ? 'Account' : 'Unknown'))
  c.set('apiKeyScopes', scopes)
  c.set('authMethod', 'apiKey')
  c.set('isOrgScopedKey', isOrgScoped)
  if (keyRow.id) c.set('apiKeyId', keyRow.id)
  if (keyRow.key_prefix) c.set('apiKeyPrefix', keyRow.key_prefix)
  applyLogContext(c, {
    authMethod: 'apiKey',
    projectId: keyRow.project_id ?? undefined,
    userId: ownerId,
    apiKeyId: keyRow.id,
    apiKeyPrefix: keyRow.key_prefix ?? undefined,
  })
  return null
}

/**
 * Middleware: validate API key from X-Mushi-Api-Key header.
 * Sets projectId and projectName on the Hono context. Records an SDK
 * heartbeat on the matched key (see {@link recordSdkHeartbeat}).
 *
 * Used for SDK ingestion paths (report submission, notifications). Callers
 * that need admin semantics should use {@link adminOrApiKey} instead — it
 * accepts either an API key OR a user JWT and enforces scope.
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = c.req.header('X-Mushi-Api-Key')

  if (!apiKey) {
    return authError(c, 'MISSING_API_KEY', 'X-Mushi-Api-Key header required')
  }

  const db = getServiceClient()
  const keyHash = await hashApiKey(apiKey)

  const { data, error } = await db
    .from('project_api_keys')
    .select('id, key_prefix, project_id, is_org_scoped, is_active, scopes, last_seen_origin, browser_seen_at, projects(name)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  const keyRow = data as Pick<
    ApiKeyRow,
    | 'id'
    | 'key_prefix'
    | 'project_id'
    | 'is_org_scoped'
    | 'is_active'
    | 'scopes'
    | 'projects'
    | 'last_seen_origin'
    | 'browser_seen_at'
  > | null
  if (error || !keyRow) {
    return authError(c, 'INVALID_API_KEY', 'Invalid or revoked API key')
  }

  // Org-scoped keys are for MCP/admin use only; they cannot ingest SDK events
  // without an explicit project scope. This keeps the SDK ingest path predictable.
  if (keyRow.is_org_scoped) {
    return authError(
      c,
      'ORG_KEY_NOT_ALLOWED',
      'Org-scoped keys cannot be used for SDK ingest. Use a project-scoped key.',
      403,
    )
  }

  // Skip the heartbeat stamp for the ingest-setup diagnostic route: its
  // pollers (`mushi connect --wait`, `mushi doctor --ingest`, MCP
  // diagnose_setup mode=ingest) authenticate with the same SDK key but are NOT the
  // SDK — stamping last_seen_at here would make the route's own
  // "SDK heartbeat" step self-satisfy from the second poll onward.
  if (!c.req.path.endsWith('/ingest-setup')) {
    const sdkPackage = c.req.header(MUSHI_SDK_PACKAGE_HEADER) ?? null
    const sdkVersion = c.req.header(MUSHI_SDK_VERSION_HEADER) ?? null
    recordSdkHeartbeat({
      db,
      keyHash,
      projectId: keyRow.project_id,
      origin: c.req.header('Origin') ?? c.req.header('Referer') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      endpointHost: extractEndpointHost(c.req.url),
      sdkPackage,
      sdkVersion,
    })
  }

  c.set('projectId', keyRow.project_id ?? undefined)
  c.set('projectName', keyRow.projects?.name ?? 'Unknown')
  c.set('apiKeyScopes', keyRow.scopes ?? [])
  // Read by requireApiKeyScope for agent scopes (see mcpKeyBrowserExposure).
  c.set('apiKeyBrowserSignals', {
    last_seen_origin: keyRow.last_seen_origin ?? null,
    browser_seen_at: keyRow.browser_seen_at ?? null,
  })
  if (keyRow.id) c.set('apiKeyId', keyRow.id)
  if (keyRow.key_prefix) c.set('apiKeyPrefix', keyRow.key_prefix)
  applyLogContext(c, {
    authMethod: 'apiKey',
    projectId: keyRow.project_id ?? undefined,
    apiKeyId: keyRow.id,
    apiKeyPrefix: keyRow.key_prefix ?? undefined,
  })
  await next()
}

/**
 * Middleware factory: after {@link apiKeyAuth}, require the key to carry a
 * scope. apiKeyAuth itself accepts ANY active project key, because the public
 * SDK key (report:write only, shipped in every customer's browser bundle) must
 * reach the ingest routes. Routes that read or change a project's reports on
 * the owner's behalf — the CLI/MCP `/v1/sync/*` family — must also sit behind
 * this, or any key lifted from a public bundle can list every report, change
 * statuses and reply to end users as the team (live until 2026-09-21).
 *
 * `mcp:write` implies `mcp:read`, as everywhere else.
 */
export function requireApiKeyScope(scope: McpScope) {
  return async (c: Context, next: Next) => {
    const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? []
    if (!keyGrantsAnyScope(scopes, [scope])) {
      return authError(
        c,
        'INSUFFICIENT_SCOPE',
        `API key is missing required scope "${scope}". Public SDK keys (report:write) cannot use this route; ` +
          'use a key minted for the CLI or MCP, or upgrade this one with `mushi login --upgrade-scope`.',
        403,
      )
    }
    if (isAgentScope(scope)) {
      const signals = (c.get('apiKeyBrowserSignals') as
        | { last_seen_origin: string | null; browser_seen_at: string | null }
        | undefined) ?? { last_seen_origin: null, browser_seen_at: null }
      const exposed = refuseBrowserExposedMcpKey(c, signals)
      if (exposed) return exposed
    }
    await next()
  }
}

/**
 * Middleware: validate Supabase JWT for admin endpoints.
 * Requires authenticated user.
 */
export async function jwtAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return authError(c, 'MISSING_AUTH', 'Authorization Bearer token required')
  }

  const db = getServiceClient()
  const token = authHeader.replace('Bearer ', '')

  // Wave T audit (2026-04-23): `db.auth.getUser(token)` throws — not just
  // returns an error — on malformed JWTs, anon-role tokens with no sub
  // claim, and GoTrue timeouts. Pre-fix, every scanner probe and expired
  // admin session turned into a 500 `{"error":"internal"}` via
  // `sentryHonoErrorHandler`, masking real failures and wasting auth
  // bandwidth. Wrap so unauthenticated / malformed callers get a clean
  // 401 and the sentry handler only fires for genuine server bugs.
  let user: Awaited<ReturnType<typeof db.auth.getUser>>['data']['user'] | null = null
  try {
    const { data, error } = await db.auth.getUser(token)
    if (error || !data?.user) {
      return authError(c, 'INVALID_TOKEN', 'Invalid or expired auth token')
    }
    user = data.user
  } catch {
    return authError(c, 'INVALID_TOKEN', 'Invalid or expired auth token')
  }

  c.set('userId', user.id)
  c.set('userEmail', user.email)
  c.set('authMethod', 'jwt')
  applyLogContext(c, { authMethod: 'jwt', userId: user.id })

  // Membership activity heartbeat. The admin SPA stamps every API call
  // with `X-Mushi-Org-Id` for the active workspace; pairing that with
  // the just-verified user gives us a coalesced touch on the right
  // organization_members row. Anonymous routes, project-scoped SDK
  // routes, and management-API calls all skip this naturally because
  // they don't run through jwtAuth.
  const activeOrgId = c.req.header('x-mushi-org-id') ?? c.req.header('X-Mushi-Org-Id') ?? null
  if (activeOrgId) {
    recordOrgMemberActivity({ db, orgId: activeOrgId, userId: user.id })
  }

  await next()
}

/**
 * Scope required for a route. mcp:write implies mcp:read. `voice:write` is
 * the narrow scope for the phone-resident key behind POST /v1/intake/voice —
 * it grants nothing else, and no other scope implies it.
 */
export type McpScope = 'mcp:read' | 'mcp:write' | 'voice:write'

interface AdminOrApiKeyOptions {
  /**
   * Scope the API-key caller must hold. JWT callers bypass this check (they
   * are the project owner — scopes only matter for delegated, rotatable
   * credentials). Defaults to 'mcp:read' — read-only admin endpoints.
   */
  scope?: McpScope | readonly McpScope[]
}

/**
 * Middleware: accept either a Supabase user JWT OR a project API key with
 * the required MCP scope. Sets the Hono `userId` context slot either way,
 * so existing admin handlers (which query `projects.owner_id = userId`)
 * work unchanged.
 *
 * Decision rationale:
 *   - API-key auth takes precedence when `X-Mushi-Api-Key` is present so
 *     MCP clients don't have to omit their always-set `Authorization` header.
 *   - For API-key auth we set `userId` to the key's project owner; for JWT
 *     auth it's the authenticated user. Either resolves to the same
 *     `owner_id` projection in admin queries.
 *   - We set `authMethod` so audit logs can distinguish a human console
 *     click from an MCP-issued action.
 *   - Scope implication (`mcp:write` grants `mcp:read`) is handled in SQL
 *     (`api_key_has_scope`) and mirrored here for fast-path checks.
 */
export function adminOrApiKey(options: AdminOrApiKeyOptions = {}) {
  const requiredScope: McpScope | readonly McpScope[] = options.scope ?? 'mcp:read'

  return async function middleware(c: Context, next: Next) {
    const explicitKey = c.req.header('X-Mushi-Api-Key')
    const bearer = c.req.header('Authorization')?.startsWith('Bearer ')
      ? c.req.header('Authorization')!.slice(7)
      : null

    if (explicitKey) {
      const authErr = await authenticateApiKey(c, explicitKey, requiredScope)
      if (authErr) return authErr
      await next()
      return
    }

    if (bearer && bearer.startsWith(MUSHI_API_KEY_PREFIX)) {
      // Only Mushi-issued keys carry the `mushi_` prefix; a Supabase user JWT
      // never does. Gating on the prefix avoids the wasted `lookupActiveApiKey`
      // DB round-trip on every JWT-authenticated console request and removes
      // the prior double lookup (here + a second one inside authenticateApiKey).
      // An invalid/revoked `mushi_` key now fails closed as 401 INVALID_API_KEY
      // rather than being silently retried as a JWT.
      const authErr = await authenticateApiKey(c, bearer, requiredScope)
      if (authErr) return authErr
      await next()
      return
    }

    // Fall through to JWT — keeps existing console flows unchanged.
    return await jwtAuth(c, next)
  }
}

/**
 * Extract the active org ID from the request context.
 * The admin SPA stamps every request with the `X-Mushi-Org-Id` header.
 * Returns null when the header is absent (public / SDK routes).
 */
export function getOrgIdFromContext(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-mushi-org-id') ?? c.req.header('X-Mushi-Org-Id') ?? null
}
