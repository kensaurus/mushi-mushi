/**
 * Shared reads for in-process fan-out routes.
 *
 * `GET /v1/admin/workspace/nav-meta` answers ~45 stats routes in one trip by
 * dispatching each one in-process. Every one of those routes used to verify
 * the JWT with GoTrue (`auth.getUser`) and re-read the caller's memberships,
 * so one sidebar load cost ~45 GoTrue calls and ~150 identical membership
 * reads. Two narrow tools remove that duplication without changing any
 * route's own logic:
 *
 *   - `trustSubRequest` / `trustedSubRequestUser`: the fan-out marks the
 *     `Request` objects IT created with the user it already verified, and
 *     `jwtAuth` accepts that instead of calling GoTrue again. The map is keyed
 *     by object identity, so a request arriving from the network can never be
 *     in it — there is no header or flag a caller could forge.
 *   - `withFanoutMemo` / `fanoutMemo`: while a fan-out runs for a user,
 *     identical membership reads for that same user share one promise. The
 *     window closes when the fan-out settles; outside it `fanoutMemo` is a
 *     plain call. A concurrent ordinary request by the same user inside the
 *     window may share a read too — it is that user's own access set, read
 *     moments earlier, so the answer is the one it would have computed.
 */

export interface TrustedUser {
  id: string
  email?: string | null
}

const trustedSubRequests = new WeakMap<Request, TrustedUser>()

/** Mark an in-process sub-request as already authenticated as `user`. */
export function trustSubRequest(req: Request, user: TrustedUser): Request {
  trustedSubRequests.set(req, user)
  return req
}

/** The user an in-process fan-out already verified for `req`, if any. */
export function trustedSubRequestUser(req: Request | undefined): TrustedUser | null {
  if (!req) return null
  return trustedSubRequests.get(req) ?? null
}

interface FanoutScope {
  depth: number
  reads: Map<string, Promise<unknown>>
}

const fanoutScopes = new Map<string, FanoutScope>()

/** Run `fn` with a shared-read window open for `userId`. Re-entrant. */
export async function withFanoutMemo<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  let scope = fanoutScopes.get(userId)
  if (!scope) {
    scope = { depth: 0, reads: new Map() }
    fanoutScopes.set(userId, scope)
  }
  scope.depth++
  try {
    return await fn()
  } finally {
    scope.depth--
    if (scope.depth === 0 && fanoutScopes.get(userId) === scope) fanoutScopes.delete(userId)
  }
}

/**
 * Share one in-flight read per `(userId, key)` while a fan-out window is open
 * for `userId`. A rejected read is evicted so a retry runs again.
 */
export function fanoutMemo<T>(userId: string, key: string, fn: () => Promise<T>): Promise<T> {
  const scope = fanoutScopes.get(userId)
  if (!scope) return fn()
  const hit = scope.reads.get(key)
  if (hit) return hit as Promise<T>
  const pending = fn()
  scope.reads.set(key, pending)
  pending.catch(() => scope.reads.delete(key))
  return pending
}
