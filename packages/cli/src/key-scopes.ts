/**
 * FILE: packages/cli/src/key-scopes.ts
 * PURPOSE: Which scopes a CLI-minted key carries for each destination, and a
 *          probe that tells an ingest-only key apart from one that can read.
 *
 * Two destinations, two keys:
 *   - SDK env vars (.env.local → VITE_ / NEXT_PUBLIC_ / EXPO_PUBLIC_ / …) are
 *     compiled into the app the end user downloads, so that key is public.
 *     It gets report:write and nothing else.
 *   - The CLI config (0600, see config.ts) and the MCP wiring stay on the
 *     developer's machine. That key adds mcp:read; mcp:write stays behind
 *     `mushi login --upgrade-scope`.
 *
 * The server accepts any non-empty subset of report:write / mcp:read /
 * mcp:write on the device-auth mint routes, so these arrays are the whole
 * policy — keep every mint call pointed at one of them.
 */

/** Public SDK key: bundled into the host app. Ingest only. */
export const SDK_KEY_SCOPES = ['report:write'] as const

/** Private CLI + MCP key: saved to the CLI config, never to app env. */
export const CLI_KEY_SCOPES = ['report:write', 'mcp:read'] as const

/** `mushi login --upgrade-scope`: adds the admin writes (billing cap, fix merge…). */
export const FULL_CLI_KEY_SCOPES = ['report:write', 'mcp:read', 'mcp:write'] as const

/** Console-visible labels (server rule: 1-40 chars, lowercase alphanumerics and hyphens). */
export const SDK_KEY_LABEL = 'sdk-ingest'
export const CLI_KEY_LABEL = 'cli-login'

/**
 * Outcome of {@link probeKeyScope}:
 *   - `ingest-only` — the key authenticates but has no MCP scope (safe to ship)
 *   - `mcp`         — the key can call the read APIs (must stay private)
 *   - `invalid`     — the backend rejected the key outright
 *   - `unreachable` — the request never got an answer
 *   - `unknown`     — an answer that proves neither (5xx, an unexpected 403…)
  * @internal Exported for tests only.
  */
export type KeyScopeProbeResult = 'ingest-only' | 'mcp' | 'invalid' | 'unreachable' | 'unknown'

export interface KeyScopeProbe {
  result: KeyScopeProbeResult
  /** HTTP status when the backend answered. */
  status?: number
  /** Network error message when it did not. */
  message?: string
}

export type ProbeKeyScope = (
  endpoint: string,
  apiKey: string,
  projectId: string,
) => Promise<KeyScopeProbe>

/**
 * Ask the backend whether `apiKey` can read. GET /v1/admin/mcp/account-overview
 * is the lightest mcp:read route: 200 means the key carries an MCP scope,
 * 403 INSUFFICIENT_SCOPE means it authenticated but is ingest-only. Nothing is
 * written server-side. Never throws.
 */
export async function probeKeyScope(
  endpoint: string,
  apiKey: string,
  projectId: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<KeyScopeProbe> {
  let base = endpoint
  while (base.endsWith('/')) base = base.slice(0, -1)
  let res: Response
  try {
    res = await doFetch(`${base}/v1/admin/mcp/account-overview`, {
      headers: { 'X-Mushi-Api-Key': apiKey, 'X-Mushi-Project': projectId },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    return { result: 'unreachable', message: err instanceof Error ? err.message : String(err) }
  }
  if (res.ok) return { result: 'mcp', status: res.status }
  if (res.status === 401) return { result: 'invalid', status: res.status }
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string }
      code?: string
    } | null
    const code = body?.error?.code ?? body?.code
    if (code === 'INSUFFICIENT_SCOPE') return { result: 'ingest-only', status: res.status }
  }
  return { result: 'unknown', status: res.status }
}

/** One-line reason a probed key cannot go into public SDK env vars. */
export function describeUnsafeSdkKey(probe: KeyScopeProbe, endpoint: string): string {
  switch (probe.result) {
    case 'mcp':
      return 'this key can read your bug reports (mcp scope), and SDK env vars ship inside the app bundle'
    case 'invalid':
      return 'the backend rejected this key'
    case 'unreachable':
      return `could not reach ${endpoint} to confirm the key is ingest-only (${probe.message ?? 'network error'})`
    case 'unknown':
      return `could not confirm the key is ingest-only (HTTP ${probe.status ?? '?'})`
    case 'ingest-only':
      return 'the key is ingest-only'
  }
}
