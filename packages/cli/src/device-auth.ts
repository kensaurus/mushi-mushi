/**
 * FILE: packages/cli/src/device-auth.ts
 * PURPOSE: Reusable RFC 8628 (OAuth 2.0 Device Authorization Grant) client for
 *          zero-copy-paste browser sign-in. Shared by `mushi login`,
 *          `mushi init` / `npx mushi-mushi`, and `mushi project create` so the
 *          "sign in with your browser" path is implemented exactly once.
 *
 * OVERVIEW:
 * - `startDeviceAuth()`   — POST /v1/cli/auth/device/start → device + user codes.
 * - `pollDeviceToken()`   — single poll; returns a discriminated outcome.
 * - `waitForCliToken()`   — poll loop that resolves the one-time CLI token.
 * - `listProjects()`      — GET  /v1/cli/projects (CLI-token auth).
 * - `createProject()`     — POST /v1/cli/projects (auto-mints a report:write key).
 * - `mintProjectKey()`    — POST /v1/cli/projects/:id/keys for an existing project.
 *
 * DEPENDENCIES:
 * - The Mushi backend `cli-auth.ts` routes (already deployed to Mushi Cloud).
 *
 * USAGE:
 * - Each command keeps its own terminal UI (clack for the wizard, readline for
 *   `mushi login`) and calls these typed primitives for the network layer.
 *
 * TECHNICAL DETAILS:
 * - The device_code is the secret the CLI polls with; the user_code is the
 *   short code shown in both the terminal and the browser approval page.
 * - The token endpoint returns the raw CLI token exactly once (RFC 8628 §3.5);
 *   callers must persist anything derived from it immediately.
 *
 * NOTES:
 * - Every request carries a 15 s timeout so a hung network never wedges setup.
 * - `waitForCliToken` accepts injectable `sleep`/`now` for deterministic tests.
 */

const DEVICE_FETCH_TIMEOUT_MS = 15_000

/** RFC 8628 device-authorization session returned by /device/start. */
export interface DeviceAuthSession {
  /** Secret code the CLI polls with — never shown to the user. */
  device_code: string
  /** Short XXXX-XXXX code shown in the terminal and the browser approval page. */
  user_code: string
  /** Browser URL (pre-fills the user_code) the CLI opens for approval. */
  verification_uri: string
  /** Seconds until the request expires (default 600). */
  expires_in: number
  /** Recommended seconds between polls (default 5). */
  interval: number
}

/** A project the signed-in user can write to. */
export interface DeviceProject {
  id: string
  name: string
  slug: string
}

/** Result of a single poll of the token endpoint. */
export type PollOutcome =
  | { status: 'approved'; cliToken: string; userId?: string }
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | {
      status: 'error'
      message: string
      /**
       * Whether retrying could plausibly succeed. `true` for network failures and
       * 5xx (the request may go through on a later poll); `false` for terminal 4xx
       * such as an already-claimed token or `invalid_grant`, where polling again
       * just wastes the user's time.
       */
      retryable: boolean
    }

function trimTrailingSlash(endpoint: string): string {
  let end = endpoint.length
  while (end > 0 && endpoint.charCodeAt(end - 1) === 47 /* '/' */) end--
  return endpoint.slice(0, end)
}

/** fetch with a hard timeout so a hung backend never wedges the wizard. */
async function deviceFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEVICE_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start a device-auth session. Throws a descriptive Error on any failure so
 * callers can fall back to the manual paste path.
 */
export async function startDeviceAuth(endpoint: string): Promise<DeviceAuthSession> {
  const base = trimTrailingSlash(endpoint)
  const res = await deviceFetch(`${base}/v1/cli/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean
    data?: DeviceAuthSession
    error?: { message?: string }
  } | null

  if (!res.ok || !json?.ok || !json.data) {
    throw new Error(json?.error?.message ?? `Could not start browser sign-in (HTTP ${res.status}).`)
  }
  return json.data
}

/**
 * Poll once for the CLI token. Maps the RFC 8628 token-endpoint responses to a
 * discriminated outcome so callers never have to parse error strings.
 * Network failures are surfaced as `{ status: 'error' }` (never thrown) so the
 * caller's poll loop can decide whether to keep waiting or bail.
 */
export async function pollDeviceToken(endpoint: string, deviceCode: string): Promise<PollOutcome> {
  const base = trimTrailingSlash(endpoint)
  try {
    const res = await deviceFetch(`${base}/v1/cli/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      data?: { cli_token?: string; user_id?: string }
      error?: string
      error_description?: string
    }

    if (res.ok && json.ok && json.data?.cli_token) {
      return { status: 'approved', cliToken: json.data.cli_token, userId: json.data.user_id }
    }
    switch (json.error) {
      case 'authorization_pending':
        return { status: 'pending' }
      case 'access_denied':
        return { status: 'denied' }
      case 'expired_token':
        return { status: 'expired' }
      default:
        return {
          status: 'error',
          message: json.error_description ?? json.error ?? `HTTP ${res.status}`,
          // 5xx is a server hiccup the next poll may clear; a 4xx is a definitive
          // rejection (already claimed / invalid_grant) that won't fix itself.
          retryable: res.status >= 500,
        }
    }
  } catch (err) {
    // Network failure / timeout — never reached the server, so a retry can work.
    return { status: 'error', message: err instanceof Error ? err.message : String(err), retryable: true }
  }
}

export interface WaitForTokenOptions {
  /** Invoked on every `pending` poll (e.g. to print a progress dot). */
  onPending?: () => void
  /**
   * Invoked when a transient poll error is tolerated (network blip / 5xx).
   * `attempt` is the current consecutive-error count.
   */
  onTransientError?: (message: string, attempt: number) => void
  /** Test seam — defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Test seam — defaults to Date.now. */
  now?: () => number
  /**
   * How many *consecutive* transient errors to tolerate before giving up.
   * Resets to 0 on any successful poll (pending or approved). Defaults to 5.
   */
  maxConsecutiveErrors?: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Poll the token endpoint until approval, then resolve the one-time CLI token.
 *
 * Denial, expiry, and terminal (4xx) errors throw immediately — the user acted,
 * the code is dead, or the server gave a definitive rejection that polling can't
 * fix. Only a *retryable* poll error — a network blip or a 5xx — is tolerated: a
 * single dropped request must not abort a sign-in the user is about to approve.
 * We tolerate up to `maxConsecutiveErrors` (default 5) retryable errors in a row,
 * resetting the counter whenever a poll succeeds, and only then surface the last
 * error so the caller can fall back to manual entry.
 */
export async function waitForCliToken(
  endpoint: string,
  session: Pick<DeviceAuthSession, 'device_code' | 'interval' | 'expires_in'>,
  opts: WaitForTokenOptions = {},
): Promise<string> {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const intervalMs = (session.interval || 5) * 1000
  const deadline = now() + (session.expires_in || 600) * 1000
  const maxConsecutiveErrors = opts.maxConsecutiveErrors ?? 5
  let consecutiveErrors = 0

  while (now() < deadline) {
    await sleep(intervalMs)
    const outcome = await pollDeviceToken(endpoint, session.device_code)
    switch (outcome.status) {
      case 'approved':
        return outcome.cliToken
      case 'pending':
        consecutiveErrors = 0
        opts.onPending?.()
        continue
      case 'denied':
        throw new Error('Login was denied in the browser.')
      case 'expired':
        throw new Error('The login code expired. Run sign-in again.')
      case 'error':
        // A terminal error (4xx) won't recover by polling again — surface it now
        // instead of burning the whole retry budget on a foregone conclusion.
        if (!outcome.retryable) {
          throw new Error(outcome.message)
        }
        consecutiveErrors += 1
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(outcome.message)
        }
        opts.onTransientError?.(outcome.message, consecutiveErrors)
        continue
    }
  }
  throw new Error('Login timed out before approval. Run sign-in again.')
}

function cliAuthHeaders(cliToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cliToken}`,
  }
}

/** List the signed-in user's writable projects. Returns [] on any failure. */
export async function listProjects(endpoint: string, cliToken: string): Promise<DeviceProject[]> {
  const base = trimTrailingSlash(endpoint)
  try {
    const res = await deviceFetch(`${base}/v1/cli/projects`, { headers: cliAuthHeaders(cliToken) })
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      data?: { projects?: DeviceProject[] }
    } | null
    if (res.ok && json?.ok) return json.data?.projects ?? []
  } catch {
    // non-fatal — caller can still create a new project
  }
  return []
}

export interface CreatedProject {
  id: string
  name: string
  slug: string
  /** report:write SDK ingest key, minted server-side. Null if mint failed. */
  apiKey: string | null
}

/** Create a project (server auto-mints a report:write key). Throws on failure. */
export async function createProject(
  endpoint: string,
  cliToken: string,
  name: string,
): Promise<CreatedProject> {
  const base = trimTrailingSlash(endpoint)
  const res = await deviceFetch(`${base}/v1/cli/projects`, {
    method: 'POST',
    headers: cliAuthHeaders(cliToken),
    body: JSON.stringify({ name }),
  })
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean
    data?: { id: string; name: string; slug: string; apiKey: string | null }
    error?: { message?: string }
  } | null
  if (!res.ok || !json?.ok || !json.data) {
    throw new Error(json?.error?.message ?? `Could not create project (HTTP ${res.status}).`)
  }
  const { id, name: created, slug, apiKey } = json.data
  return { id, name: created, slug, apiKey: apiKey ?? null }
}

/**
 * Mint a fresh report:write key for an existing project (raw keys can't be
 * recovered, so selecting a project always mints a new one). Returns null on
 * any failure so the caller can fall back to a console-copy hint.
 */
export async function mintProjectKey(
  endpoint: string,
  cliToken: string,
  projectId: string,
): Promise<string | null> {
  const base = trimTrailingSlash(endpoint)
  try {
    const res = await deviceFetch(`${base}/v1/cli/projects/${projectId}/keys`, {
      method: 'POST',
      headers: cliAuthHeaders(cliToken),
      body: JSON.stringify({}),
    })
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      data?: { key?: string }
    } | null
    if (res.ok && json?.ok) return json.data?.key ?? null
  } catch {
    // non-fatal
  }
  return null
}
