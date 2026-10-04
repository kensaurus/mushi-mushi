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
 *   - `withFanoutMemo` / `fanoutMemo`: inside one fan-out, identical
 *     membership reads for its user share one promise. The window is the
 *     fan-out's async context (AsyncLocalStorage), so it closes when the
 *     fan-out settles and no other request ever reads from it.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

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
  userId: string
  reads: Map<string, Promise<unknown>>
}

// The window is bound to the fan-out's own async chain, not to the user: a
// request by the same user that arrives over the network while a fan-out is
// in flight runs outside this context and reads fresh. A user-keyed window
// let overlapping nav-meta calls keep a removed or demoted member's old
// access set alive for every request on the isolate.
const fanoutStore = new AsyncLocalStorage<FanoutScope>()

/** Run `fn` with a shared-read window open for `userId`. Re-entrant. */
export function withFanoutMemo<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const current = fanoutStore.getStore()
  if (current && current.userId === userId) return fn()
  return fanoutStore.run({ userId, reads: new Map() }, fn)
}

/**
 * Share one in-flight read per `(userId, key)` inside a fan-out window for
 * `userId`. Outside one it is a plain call. A rejected read is evicted so a
 * retry runs again.
 */
export function fanoutMemo<T>(userId: string, key: string, fn: () => Promise<T>): Promise<T> {
  const scope = fanoutStore.getStore()
  if (!scope || scope.userId !== userId) return fn()
  const hit = scope.reads.get(key)
  if (hit) return hit as Promise<T>
  const pending = fn()
  scope.reads.set(key, pending)
  pending.catch(() => scope.reads.delete(key))
  return pending
}
