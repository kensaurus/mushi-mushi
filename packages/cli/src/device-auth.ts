/**
 * FILE: packages/cli/src/device-auth.ts
 * PURPOSE: RFC 8628 device-auth client for zero-copy-paste browser sign-in and project/key minting.
 */

const DEVICE_FETCH_TIMEOUT_MS = 15_000;

/** RFC 8628 device-authorization session returned by /device/start. */
export interface DeviceAuthSession {
  /** Secret code the CLI polls with — never shown to the user. */
  device_code: string;
  /** Short XXXX-XXXX code shown in the terminal and the browser approval page. */
  user_code: string;
  /** Browser URL (pre-fills the user_code) the CLI opens for approval. */
  verification_uri: string;
  /** Seconds until the request expires (default 600). */
  expires_in: number;
  /** Recommended seconds between polls (default 5). */
  interval: number;
}

/** A project the signed-in user can write to. */
export interface DeviceProject {
  id: string;
  name: string;
  slug: string;
}

/** Result of a single poll of the token endpoint. */
export type PollOutcome =
  | { status: 'approved'; cliToken: string; userId?: string }
  | { status: 'pending' }
  | {
      /**
       * RFC 8628 §3.5: the server is explicitly telling a well-behaved client to
       * back off (we're polling faster than its rate limit allows). This is a
       * courtesy signal, not a fault — it must not spend the same error budget
       * as a flaky network or an upstream 5xx.
       */
      status: 'slow_down';
      /** Milliseconds to wait, from the `Retry-After` header (falls back to a fixed bump if absent/unparseable). */
      retryAfterMs: number;
    }
  | { status: 'denied' }
  | { status: 'expired' }
  | {
      status: 'error';
      message: string;
      /**
       * Whether retrying could plausibly succeed. `true` for network failures and
       * 5xx (the request may go through on a later poll); `false` for terminal 4xx
       * such as an already-claimed token or `invalid_grant`, where polling again
       * just wastes the user's time.
       */
      retryable: boolean;
    };

/** Fallback backoff bump when a `slow_down` response omits (or sends a garbage) `Retry-After`. */
const DEFAULT_SLOW_DOWN_MS = 5_000;

function trimTrailingSlash(endpoint: string): string {
  let end = endpoint.length;
  while (end > 0 && endpoint.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return endpoint.slice(0, end);
}

/** fetch with a hard timeout so a hung backend never wedges the wizard. */
async function deviceFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEVICE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start a device-auth session. Throws a descriptive Error on any failure so
 * callers can fall back to the manual paste path.
 *
 * `clientId` (optional, persisted per-machine) lets the server supersede this
 * machine's earlier pending requests, so an approval tab left over from a
 * Ctrl+C'd run can no longer be approved while this run polls a new code.
 */
export async function startDeviceAuth(
  endpoint: string,
  clientId?: string,
): Promise<DeviceAuthSession> {
  const base = trimTrailingSlash(endpoint);
  const res = await deviceFetch(`${base}/v1/cli/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clientId ? { client_id: clientId } : {}),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: DeviceAuthSession;
    error?: { message?: string };
  } | null;

  if (!res.ok || !json?.ok || !json.data) {
    throw new Error(
      json?.error?.message ?? `Could not start browser sign-in (HTTP ${res.status}).`,
    );
  }
  return json.data;
}

/**
 * Poll once for the CLI token. Maps the RFC 8628 token-endpoint responses to a
 * discriminated outcome so callers never have to parse error strings.
 * Network failures are surfaced as `{ status: 'error' }` (never thrown) so the
 * caller's poll loop can decide whether to keep waiting or bail.
 */
export async function pollDeviceToken(endpoint: string, deviceCode: string): Promise<PollOutcome> {
  const base = trimTrailingSlash(endpoint);
  try {
    const res = await deviceFetch(`${base}/v1/cli/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: { cli_token?: string; user_id?: string };
      error?: string;
      error_description?: string;
    };

    if (res.ok && json.ok && json.data?.cli_token) {
      return { status: 'approved', cliToken: json.data.cli_token, userId: json.data.user_id };
    }
    switch (json.error) {
      case 'authorization_pending':
        return { status: 'pending' };
      case 'slow_down': {
        const retryAfterHeader = res.headers?.get?.('Retry-After');
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const retryAfterMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : DEFAULT_SLOW_DOWN_MS;
        return { status: 'slow_down', retryAfterMs };
      }
      case 'access_denied':
        return { status: 'denied' };
      case 'expired_token':
        return { status: 'expired' };
      default:
        return {
          status: 'error',
          message: json.error_description ?? json.error ?? `HTTP ${res.status}`,
          // 5xx is a server hiccup the next poll may clear; 408 (gateway
          // timeout) is equally transient. Any other 4xx is a definitive
          // rejection (already claimed / invalid_grant) that won't fix
          // itself. (429/slow_down is handled above as its own outcome.)
          retryable: res.status >= 500 || res.status === 408,
        };
    }
  } catch (err) {
    // Network failure / timeout — never reached the server, so a retry can work.
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}

export interface WaitForTokenOptions {
  /** Invoked on every `pending` poll (e.g. to print a progress dot). */
  onPending?: () => void;
  /**
   * Invoked when the server sends `slow_down` (RFC 8628 §3.5). `retryAfterMs`
   * is how long the loop will wait before the next poll.
   */
  onSlowDown?: (retryAfterMs: number) => void;
  /**
   * Invoked when a transient poll error is tolerated (network blip / 5xx).
   * `attempt` is the current consecutive-error count.
   */
  onTransientError?: (message: string, attempt: number) => void;
  /** Test seam — defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam — defaults to Date.now. */
  now?: () => number;
  /**
   * How many *consecutive* transient errors to tolerate before giving up.
   * Resets to 0 on any successful poll (pending or approved). Defaults to 5.
   */
  maxConsecutiveErrors?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Backoff before a transient device-auth retry. Set to 0 in unit tests. */
let deviceAuthRetryDelayMs = 1_000;

export function setDeviceAuthRetryDelayMs(ms: number): void {
  deviceAuthRetryDelayMs = ms;
}

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
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  // Bumped (never lowered) if the server sends `slow_down` — a well-behaved
  // client should settle into whatever cadence the server asks for, not just
  // wait out a single Retry-After and immediately resume the original pace.
  let intervalMs = (session.interval || 5) * 1000;
  const deadline = now() + (session.expires_in || 600) * 1000;
  const maxConsecutiveErrors = opts.maxConsecutiveErrors ?? 5;
  let consecutiveErrors = 0;

  // Poll immediately on the first iteration — a user who approves right away
  // shouldn't have to wait a full 5-second interval before the wizard resumes.
  let firstPoll = true;
  while (now() < deadline) {
    if (!firstPoll) {
      await sleep(intervalMs);
    }
    firstPoll = false;
    const outcome = await pollDeviceToken(endpoint, session.device_code);
    switch (outcome.status) {
      case 'approved':
        return outcome.cliToken;
      case 'pending':
        consecutiveErrors = 0;
        opts.onPending?.();
        continue;
      case 'slow_down':
        // A courtesy rate-limit signal, not a fault — never counts against
        // the transient-error budget. Settle the poll cadence (permanently,
        // for the rest of this session) at whatever the server just asked
        // for, so the very next sleep already honors this Retry-After.
        consecutiveErrors = 0;
        intervalMs = Math.max(intervalMs, outcome.retryAfterMs);
        opts.onSlowDown?.(outcome.retryAfterMs);
        continue;
      case 'denied':
        throw new Error('Login was denied in the browser.');
      case 'expired':
        throw new Error('The login code expired. Run sign-in again.');
      case 'error':
        // A terminal error (4xx) won't recover by polling again — surface it now
        // instead of burning the whole retry budget on a foregone conclusion.
        if (!outcome.retryable) {
          throw new Error(outcome.message);
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(outcome.message);
        }
        opts.onTransientError?.(outcome.message, consecutiveErrors);
        continue;
    }
  }
  throw new Error('Login timed out before approval. Run sign-in again.');
}

function cliAuthHeaders(cliToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cliToken}`,
  };
}

/**
 * A post-approval device-auth API call failed. Carries the HTTP status and
 * which step died so the wizard can print an actionable diagnostic instead of
 * silently falling back to manual entry — the old `[]`/`null` swallowing was
 * indistinguishable from "you have no projects" and produced the reported
 * "browser says connected but the terminal returned to the prompts".
 */
export class DeviceAuthRequestError extends Error {
  readonly step: 'list_projects' | 'mint_key';
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(step: DeviceAuthRequestError['step'], message: string, status?: number) {
    super(message);
    this.name = 'DeviceAuthRequestError';
    this.step = step;
    this.status = status;
    this.retryable = status === undefined || status >= 500 || status === 408;
  }
}

/**
 * Run a device-auth request with a single retry when the failure is
 * transient (network blip / 5xx). One retry, not a loop: the user is sitting
 * at an interactive prompt and a dead backend should surface fast.
 */
async function withOneRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof DeviceAuthRequestError && err.retryable) {
      if (deviceAuthRetryDelayMs > 0) {
        await defaultSleep(deviceAuthRetryDelayMs);
      }
      return run();
    }
    throw err;
  }
}

/**
 * List the signed-in user's writable projects. Throws DeviceAuthRequestError
 * on failure (after one transient retry) — an API failure must never read as
 * "no projects yet".
 */
export async function listProjects(endpoint: string, cliToken: string): Promise<DeviceProject[]> {
  const base = trimTrailingSlash(endpoint);
  return withOneRetry(async () => {
    let res: Response;
    try {
      res = await deviceFetch(`${base}/v1/cli/projects`, { headers: cliAuthHeaders(cliToken) });
    } catch (err) {
      throw new DeviceAuthRequestError(
        'list_projects',
        `Could not reach ${base}/v1/cli/projects: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: { projects?: DeviceProject[] };
      error?: { message?: string };
    } | null;
    if (res.ok && json?.ok) return json.data?.projects ?? [];
    throw new DeviceAuthRequestError(
      'list_projects',
      json?.error?.message ?? `Could not list projects (HTTP ${res.status}).`,
      res.status,
    );
  });
}

export interface CreatedProject {
  id: string;
  name: string;
  slug: string;
  /** report:write SDK ingest key, minted server-side. Null if mint failed. */
  apiKey: string | null;
}

/** Create a project (server auto-mints a key). Throws on failure. */
export async function createProject(
  endpoint: string,
  cliToken: string,
  name: string,
  opts: {
    /** Narrow the auto-minted key (subset of report:write, mcp:read, mcp:write). */
    scopes?: readonly string[];
  } = {},
): Promise<CreatedProject> {
  const base = trimTrailingSlash(endpoint);
  const res = await deviceFetch(`${base}/v1/cli/projects`, {
    method: 'POST',
    headers: cliAuthHeaders(cliToken),
    body: JSON.stringify({ name, ...(opts.scopes ? { scopes: opts.scopes } : {}) }),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: { id: string; name: string; slug: string; apiKey: string | null };
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.ok || !json.data) {
    throw new Error(json?.error?.message ?? `Could not create project (HTTP ${res.status}).`);
  }
  const { id, name: created, slug, apiKey } = json.data;
  return { id, name: created, slug, apiKey: apiKey ?? null };
}

/**
 * Mint a fresh report:write key for an existing project (raw keys can't be
 * recovered, so selecting a project always mints a new one). Throws
 * DeviceAuthRequestError on failure (after one transient retry) so the wizard
 * can tell the user WHY minting failed instead of a bare "could not mint".
 */
export async function mintProjectKey(
  endpoint: string,
  cliToken: string,
  projectId: string,
  opts: {
    /**
     * Narrow the minted key. Must be a subset of the server's LOGIN_SCOPES
     * (report:write, mcp:read, mcp:write) — e.g. ['mcp:read'] for a
     * read-only key written into an editor's mcp.json.
     */
    scopes?: readonly string[];
    /** Console-visible key label, e.g. 'mcp-cursor'. Default: 'cli-login'. */
    label?: string;
  } = {},
): Promise<string> {
  const base = trimTrailingSlash(endpoint);
  // No withOneRetry here, unlike listProjects: minting isn't idempotent — the
  // server creates a new key on every call, so retrying a request whose
  // response was merely lost (not a confirmed failure) can silently orphan
  // a duplicate key. A single attempt surfaces the error to the wizard
  // instead of risking that.
  let res: Response;
  try {
    res = await deviceFetch(`${base}/v1/cli/projects/${projectId}/keys`, {
      method: 'POST',
      headers: cliAuthHeaders(cliToken),
      body: JSON.stringify({
        ...(opts.scopes ? { scopes: opts.scopes } : {}),
        ...(opts.label ? { label: opts.label } : {}),
      }),
    });
  } catch (err) {
    throw new DeviceAuthRequestError(
      'mint_key',
      `Could not reach ${base}/v1/cli/projects/…/keys: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: { key?: string };
    error?: { message?: string };
  } | null;
  if (res.ok && json?.ok && json.data?.key) return json.data.key;
  // Always propagate the real HTTP status, even when the server wrapped an
  // app-level error in a 2xx — otherwise `status` reads as `undefined` and
  // DeviceAuthRequestError.retryable misclassifies a real failure as a
  // transient one.
  throw new DeviceAuthRequestError(
    'mint_key',
    json?.error?.message ?? `Could not mint an SDK key (HTTP ${res.status}).`,
    res.status,
  );
}
