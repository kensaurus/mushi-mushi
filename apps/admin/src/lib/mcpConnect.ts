/**
 * FILE: apps/admin/src/lib/mcpConnect.ts
 * PURPOSE: The key and package pin behind every "Add to <client>" / "Show
 *          command" button (ClientConnectButton).
 *
 * REGRESSION (2026-10-04, REPORT A7):
 *   - Every click minted a brand-new API key. glot.it collected 13 keys, 3
 *     never used. The server stores only a hash, so an existing key can never
 *     be shown again or reused: the fix is to mint at most once per
 *     (project, client, scopes) for this page session and hand the same key
 *     back to every later click and every button on the page. Concurrent
 *     clicks share the in-flight promise. The key lives in memory only (never
 *     storage) and is dropped on sign-out or account change.
 *   - Keys were minted with `mcp:read` only, yet the fix prompt ends with
 *     `submit_fix_result`, which needs `mcp:write`. The default is now read +
 *     write (the whole fix loop needs it); read-only is an explicit choice.
 *   - Keys were labelled "mcp-readonly". They are now "MCP · Cursor ·
 *     2026-10-04 · read+write" so the key list says what each one is.
 *   - The Cursor deeplink pinned the @mushi-mushi/mcp version the console was
 *     BUILT with (0.24.1) while npm had 0.24.2: the console only redeploys on
 *     apps/admin changes, so a release never refreshed the pin. The pin now
 *     follows the `sdk_versions` catalog (GET /v1/sdk/latest-version, kept
 *     fresh by sdk-versions-cron and release.yml), falling back to the build
 *     pin. The catalog wins over the build pin even when older: the build pin
 *     can run ahead of npm between the version PR and the publish, and an
 *     unpublished version is an `npx` 404, worse than a patch behind.
 */

import { MCP_PIN_SPEC } from '@mushi-mushi/mcp/clients'
import { apiFetch, supabase } from './supabase'
import { subscribeAuthBroadcast } from './authBroadcast'
import { describeActionError } from './actionError'

export type McpAccess = 'read_write' | 'read_only'

export function scopesForAccess(access: McpAccess): string[] {
  return access === 'read_only' ? ['mcp:read'] : ['mcp:read', 'mcp:write']
}

/**
 * "MCP · Cursor · 2026-10-04 · read+write" — fits the route's 64-char cap.
 * @internal Exported for unit tests only.
 */
export function mcpKeyLabel(clientLabel: string, scopes: readonly string[], now: Date = new Date()): string {
  const access = scopes.includes('mcp:write') ? 'read+write' : 'read-only'
  return `MCP · ${clientLabel} · ${now.toISOString().slice(0, 10)} · ${access}`.slice(0, 64)
}

/**
 * Resolves to the new key, or rejects with an Error whose message is the
 * plain-English reason. Callers used to get null for every failure and showed
 * "check your plan limits" even when the real reason was a member's missing
 * owner/admin role (QA bug 125).
 */
type Mint = (projectId: string, scopes: string[], label: string) => Promise<string>

const defaultMint: Mint = async (projectId, scopes, label) => {
  const res = await apiFetch<{ key: string; prefix: string }>(`/v1/admin/projects/${projectId}/keys`, {
    method: 'POST',
    body: JSON.stringify({ scopes, label }),
    idempotencyKey: crypto.randomUUID(),
  })
  if (res.ok && res.data?.key) return res.data.key
  throw new Error(describeActionError(res.error, 'Could not create an MCP key. Try again in a moment.'))
}

const minted = new Map<string, Promise<string>>()
let authWatchInstalled = false

function installAuthWatch(): void {
  if (authWatchInstalled || typeof window === 'undefined') return
  authWatchInstalled = true
  let userId: string | null | undefined
  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user?.id ?? null
    if (event === 'SIGNED_OUT' || (userId !== undefined && next !== userId)) minted.clear()
    userId = next
  })
  subscribeAuthBroadcast(() => minted.clear())
}

/**
 * The page-session MCP key for this project, client and scope set: minted on
 * the first call, reused after. A failed mint is forgotten so the next click
 * retries, and rejects with the plain-English reason.
 */
export function getOrMintMcpKey(
  opts: { projectId: string; clientId: string; clientLabel: string; scopes: readonly string[] },
  mint: Mint = defaultMint,
): Promise<string> {
  installAuthWatch()
  const scopes = [...new Set(opts.scopes)].sort()
  const cacheKey = `${opts.projectId}|${opts.clientId}|${scopes.join(',')}`
  const existing = minted.get(cacheKey)
  if (existing) return existing
  const pending = mint(opts.projectId, scopes, mcpKeyLabel(opts.clientLabel, scopes)).catch((err: unknown) => {
    minted.delete(cacheKey)
    throw err instanceof Error ? err : new Error('Could not create an MCP key. Try again in a moment.')
  })
  minted.set(cacheKey, pending)
  return pending
}

/** @internal Exported for unit tests only. */
export function resetMcpConnectCacheForTests(): void {
  minted.clear()
  publishedPin = null
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/

/**
 * The npm spec to write into an MCP config: the catalog's published version
 * when it is a plain semver, else the version this console was built with.
 * @internal Exported for unit tests only.
 */
export function mcpPinSpecFrom(catalogVersion: unknown, buildPin: string = MCP_PIN_SPEC): string {
  if (typeof catalogVersion === 'string' && SEMVER_RE.test(catalogVersion.trim())) {
    return `@mushi-mushi/mcp@${catalogVersion.trim()}`
  }
  return buildPin
}

const PIN_TIMEOUT_MS = 2_500
let publishedPin: Promise<string> | null = null

/** The published @mushi-mushi/mcp pin, fetched once per page session. Never rejects. */
export function getPublishedMcpPinSpec(): Promise<string> {
  if (publishedPin) return publishedPin
  publishedPin = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PIN_TIMEOUT_MS)
    try {
      const res = await apiFetch<{ latest: string | null }>(
        `/v1/sdk/latest-version?package=${encodeURIComponent('@mushi-mushi/mcp')}`,
        { scope: 'none', signal: controller.signal },
      )
      if (!res.ok) publishedPin = null // retry on the next click
      return mcpPinSpecFrom(res.ok ? res.data?.latest : null)
    } catch {
      publishedPin = null
      return MCP_PIN_SPEC
    } finally {
      clearTimeout(timer)
    }
  })()
  return publishedPin
}
