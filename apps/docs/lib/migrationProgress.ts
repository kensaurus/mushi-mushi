/**
 * FILE: apps/docs/lib/migrationProgress.ts
 * PURPOSE: Talk to /v1/admin/migrations/progress on behalf of a docs reader,
 *          AND own the local/remote merge contract used by MigrationChecklist.
 *
 * Why this lives in apps/docs (not a shared package):
 *   - The docs site is a static Nextra v4 export; pulling in a workspace
 *     package just for two API helpers and a merge function would force the
 *     bundler to chase the entire @mushi-mushi/admin or core surface area.
 *   - The merge contract is intentionally docs-specific. The admin console
 *     never deletes localStorage on behalf of the user; the docs site
 *     reserves that right because it owns the storage namespace.
 *
 * SECURITY POSTURE
 *   - The docs site never holds a Supabase refresh token. We get a
 *     short-lived ACCESS token from the admin console via a postMessage
 *     bridge (see openAdminAuthBridge). Tokens live in sessionStorage so
 *     they expire with the tab; the merge logic falls back to localStorage
 *     when the token has not been issued yet.
 *   - The bridge validates: (a) `event.origin` is in the admin allowlist,
 *     (b) `event.data.type` is the exact magic string,
 *     (c) `event.data.nonce` matches the nonce we sent.
 *     Without all three, the message is silently dropped.
 *
 * MERGE POLICY (local-wins-on-completion)
 *   - Union of completed step IDs. If you completed `intro` locally and
 *     the server has `setup`, the merged set is `{intro, setup}`. We never
 *     silently uncheck a step because the server lacks it — that would
 *     undo work the user definitely did, just on a different device.
 *   - When the user explicitly clicks Reset on the docs side, we DELETE
 *     the remote row too (so the next sync doesn't restore the cleared
 *     steps). When the user logs out, we leave the remote row alone.
 */

export interface RemoteProgress {
  guideSlug: string
  projectId: string | null
  completedStepIds: string[]
  requiredStepCount: number | null
  completedRequiredCount: number
  source: 'docs' | 'admin' | 'cli'
  clientUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DocsAuthSession {
  accessToken: string
  expiresAt: number
  email: string | null
  projectId: string | null
  organizationId: string | null
  adminOrigin: string
  apiUrl: string
}

const SESSION_KEY = 'mushi:docs:auth'
const NONCE_KEY = 'mushi:docs:bridge-nonce'

const DEFAULT_ADMIN_ORIGIN =
  process.env.NEXT_PUBLIC_MUSHI_ADMIN_ORIGIN ?? 'https://kensaur.us'
const DEFAULT_ADMIN_BRIDGE_PATH =
  process.env.NEXT_PUBLIC_MUSHI_ADMIN_BRIDGE_PATH ??
  '/mushi-mushi/admin/docs-bridge'
const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_MUSHI_API_URL ??
  'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

// Allowlist mirrors `MUSHI_ADMIN_ORIGIN_ALLOWLIST` defaults in
// packages/server/supabase/functions/api/index.ts. Extending this list also
// requires extending the server-side allowlist; the bridge will reject any
// origin not present in BOTH.
const ALLOWED_ADMIN_ORIGINS = new Set<string>(
  [
    DEFAULT_ADMIN_ORIGIN,
    'https://kensaur.us',
    'https://www.kensaur.us',
    'https://admin.mushimushi.dev',
    'https://app.mushimushi.dev',
    'http://localhost:6464',
    'http://127.0.0.1:6464',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].map((s) => s.replace(/\/+$/, '')),
)

// ── session storage helpers ───────────────────────────────────────────────

function readSession(): DocsAuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DocsAuthSession
    if (!parsed.accessToken || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt * 1000 <= Date.now() + 5_000) {
      window.sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeSession(session: DocsAuthSession): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    window.dispatchEvent(new CustomEvent('mushi:docs:auth-change'))
  } catch {
    /* sessionStorage disabled — sync UI will report not-signed-in */
  }
}

function clearSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
    window.dispatchEvent(new CustomEvent('mushi:docs:auth-change'))
  } catch {
    /* ignore */
  }
}

export function getDocsAuthSession(): DocsAuthSession | null {
  return readSession()
}

export function signOutDocs(): void {
  clearSession()
}

// ── bridge ─────────────────────────────────────────────────────────────────

interface BridgeOptions {
  /** Override the admin host. Mostly useful from local dev or e2e. */
  adminOrigin?: string
}

interface BridgeMessage {
  type: 'mushi:docs-bridge:token'
  nonce: string
  accessToken: string
  expiresAt: number
  email: string | null
  projectId: string | null
  organizationId: string | null
  /* Intentionally NO `apiUrl` field. The docs site already knows the
   * Supabase Functions URL at build time via NEXT_PUBLIC_MUSHI_API_URL
   * (DEFAULT_API_URL below). Letting the bridge override it would make
   * the fetch destination user-controlled (CodeQL js/request-forgery,
   * via session.apiUrl in apiFetch). The bridge MAY send the field for
   * forward-compat — we just don't read it. */
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    m.type === 'mushi:docs-bridge:token' &&
    typeof m.nonce === 'string' &&
    typeof m.accessToken === 'string' &&
    typeof m.expiresAt === 'number'
  )
}

function generateNonce(): string {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Open the admin docs-auth bridge in a popup and resolve once it posts back
 * a valid token (or reject after a 2-minute timeout / explicit close).
 *
 * UX: the popup opens immediately on user click (no async work first) so
 * Safari and Firefox don't silently swallow it as a non-user-initiated
 * window.open. The caller MUST invoke openAdminAuthBridge from inside an
 * onClick handler.
 */
export function openAdminAuthBridge(
  options: BridgeOptions = {},
): Promise<DocsAuthSession> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Bridge requires a browser environment'))
  }

  const adminOrigin = (options.adminOrigin ?? DEFAULT_ADMIN_ORIGIN).replace(
    /\/+$/,
    '',
  )
  if (!ALLOWED_ADMIN_ORIGINS.has(adminOrigin)) {
    return Promise.reject(
      new Error(`Admin origin "${adminOrigin}" is not in the allowlist`),
    )
  }

  const nonce = generateNonce()
  try {
    window.sessionStorage.setItem(NONCE_KEY, nonce)
  } catch {
    /* private mode — postMessage handler will still verify the in-memory closure */
  }

  const returnOrigin = window.location.origin
  const url = `${adminOrigin}${DEFAULT_ADMIN_BRIDGE_PATH}?nonce=${encodeURIComponent(nonce)}&returnOrigin=${encodeURIComponent(returnOrigin)}`

  // Centred popup — UX nicety; the bridge is otherwise minimal-chrome.
  const w = 480
  const h = 620
  const left = Math.max(0, (window.screen.width - w) / 2)
  const top = Math.max(0, (window.screen.height - h) / 2)
  const popup = window.open(
    url,
    'mushi-docs-bridge',
    `width=${w},height=${h},left=${left},top=${top},noopener=no`,
  )

  if (!popup) {
    return Promise.reject(
      new Error('Could not open the sign-in popup. Allow popups for this site and try again.'),
    )
  }

  return new Promise<DocsAuthSession>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(pollInterval)
      window.clearTimeout(timeout)
    }

    const onMessage = (event: MessageEvent) => {
      if (settled) return
      const eventOrigin = event.origin?.replace(/\/+$/, '')
      if (!eventOrigin || !ALLOWED_ADMIN_ORIGINS.has(eventOrigin)) return
      if (eventOrigin !== adminOrigin) return
      if (!isBridgeMessage(event.data)) return
      if (event.data.nonce !== nonce) return

      settled = true
      cleanup()
      try {
        popup.close()
      } catch {
        /* user may have already closed it */
      }

      const session: DocsAuthSession = {
        accessToken: event.data.accessToken,
        expiresAt: event.data.expiresAt,
        email: event.data.email,
        projectId: event.data.projectId,
        organizationId: event.data.organizationId,
        adminOrigin,
        /* Pinned to the build-time DEFAULT_API_URL — never read from the
         * postMessage payload. See BridgeMessage typedef above for the
         * security rationale (CodeQL js/request-forgery). */
        apiUrl: DEFAULT_API_URL,
      }
      writeSession(session)
      resolve(session)
    }

    // Detect manual popup close so we don't hang forever.
    const pollInterval = window.setInterval(() => {
      if (settled) return
      if (popup.closed) {
        settled = true
        cleanup()
        reject(new Error('Sign-in window was closed before completing.'))
      }
    }, 500)

    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      try {
        popup.close()
      } catch {
        /* ignore */
      }
      reject(new Error('Timed out waiting for the admin sign-in window.'))
    }, 2 * 60 * 1000)

    window.addEventListener('message', onMessage)
  })
}

// ── API client ────────────────────────────────────────────────────────────

async function apiFetch<T>(
  session: DocsAuthSession,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  headers.set('Authorization', `Bearer ${session.accessToken}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (session.projectId && !headers.has('X-Mushi-Project-Id')) {
    headers.set('X-Mushi-Project-Id', session.projectId)
  }

  const res = await fetch(`${session.apiUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401) {
    clearSession()
    throw new Error('Sign-in expired. Sign in again to sync.')
  }

  const json = (await res.json().catch(() => ({}))) as {
    ok: boolean
    data?: T
    error?: { code: string; message: string }
  }
  if (!res.ok || !json.ok) {
    const message = json.error?.message ?? `Request failed with ${res.status}`
    throw new Error(message)
  }
  return json.data as T
}

interface ProgressListResponse {
  progress: Array<{
    id: string
    guide_slug: string
    project_id: string | null
    completed_step_ids: string[]
    required_step_count: number | null
    completed_required_count: number
    source: RemoteProgress['source']
    client_updated_at: string | null
    created_at: string
    updated_at: string
    is_self: boolean
  }>
  knownGuideSlugs: string[]
}

function fromApi(row: ProgressListResponse['progress'][number]): RemoteProgress {
  return {
    guideSlug: row.guide_slug,
    projectId: row.project_id,
    completedStepIds: row.completed_step_ids ?? [],
    requiredStepCount: row.required_step_count,
    completedRequiredCount: row.completed_required_count,
    source: row.source,
    clientUpdatedAt: row.client_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchRemoteProgress(
  session: DocsAuthSession,
  guideSlug: string,
): Promise<RemoteProgress | null> {
  const data = await apiFetch<ProgressListResponse>(
    session,
    `/v1/admin/migrations/progress?guide_slug=${encodeURIComponent(guideSlug)}&scope=mine${
      session.projectId ? `&project_id=${encodeURIComponent(session.projectId)}` : ''
    }`,
  )
  // Prefer the project-scoped row when one exists (matches the active
  // project the admin handed us); fall back to account-scoped otherwise.
  const projectScoped = data.progress.find(
    (r) => session.projectId && r.project_id === session.projectId,
  )
  const accountScoped = data.progress.find((r) => r.project_id === null)
  const chosen = projectScoped ?? accountScoped ?? data.progress[0]
  return chosen ? fromApi(chosen) : null
}

export async function pushProgress(
  session: DocsAuthSession,
  payload: {
    guideSlug: string
    completedStepIds: string[]
    requiredStepCount: number | null
    completedRequiredCount: number
    projectId?: string | null
  },
): Promise<RemoteProgress> {
  const data = await apiFetch<{ progress: ProgressListResponse['progress'][number] }>(
    session,
    `/v1/admin/migrations/progress/${encodeURIComponent(payload.guideSlug)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        project_id: payload.projectId ?? session.projectId ?? null,
        completed_step_ids: payload.completedStepIds,
        required_step_count: payload.requiredStepCount,
        completed_required_count: payload.completedRequiredCount,
        source: 'docs',
        client_updated_at: new Date().toISOString(),
      }),
    },
  )
  return fromApi(data.progress)
}

export async function clearRemoteProgress(
  session: DocsAuthSession,
  guideSlug: string,
): Promise<void> {
  await apiFetch<unknown>(
    session,
    `/v1/admin/migrations/progress/${encodeURIComponent(guideSlug)}${
      session.projectId ? `?project_id=${encodeURIComponent(session.projectId)}` : ''
    }`,
    { method: 'DELETE' },
  )
}

// ── merge contract ────────────────────────────────────────────────────────

/**
 * Merge a local set of completed step IDs with a remote snapshot.
 *
 * Local wins on COMPLETION (a step ticked locally never gets unticked just
 * because the server lacks it). Remote can ADD steps the server has but
 * the local browser doesn't (cross-device union). Step IDs we no longer
 * recognise (renamed since last visit) are dropped — keeps the checklist
 * coherent without losing visible progress.
 *
 * Returns the merged sorted set plus a flag describing whether the merge
 * changed local — so the caller can decide whether to push the union back
 * to the server immediately.
 */
export interface MergeResult {
  merged: string[]
  localChanged: boolean
  remoteIsBehind: boolean
}

export function mergeProgress(
  knownStepIds: readonly string[],
  local: readonly string[],
  remote: readonly string[] | null,
): MergeResult {
  const known = new Set<string>(knownStepIds)
  const localSet = new Set(local.filter((id) => known.has(id)))
  const remoteSet = new Set((remote ?? []).filter((id) => known.has(id)))
  const merged = new Set<string>()
  for (const id of localSet) merged.add(id)
  for (const id of remoteSet) merged.add(id)

  const mergedSorted = Array.from(merged).sort()
  const localBefore = Array.from(localSet).sort()
  const remoteBefore = Array.from(remoteSet).sort()

  const localChanged = !arraysEqual(mergedSorted, localBefore)
  const remoteIsBehind = !arraysEqual(mergedSorted, remoteBefore)
  return { merged: mergedSorted, localChanged, remoteIsBehind }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
