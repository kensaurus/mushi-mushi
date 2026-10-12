/**
 * FILE: packages/server/supabase/functions/_shared/key-project-scope.ts
 * PURPOSE: Request-scoped project limit for an account-level API key that was
 *          granted only some projects (`project_api_keys.allowed_project_ids`,
 *          ADR 0026).
 *
 * An account key authenticates as its owner, and ~50 routes ask "which
 * projects can this user reach?" through accessibleProjectIds /
 * userCanAccessProject. Patching each route would miss one. Instead the auth
 * middleware runs the rest of the request inside this scope and those two
 * primitives intersect their answer with it, so every route inherits the
 * limit. Same AsyncLocalStorage pattern as request-memo.ts: the scope is
 * bound to the request's own async chain, never to the user, so a concurrent
 * console request by the same user is not narrowed.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

interface KeyProjectScope {
  userId: string
  allowed: ReadonlySet<string>
}

const scopeStore = new AsyncLocalStorage<KeyProjectScope>()

/** Run `fn` with access for `userId` limited to `allowed`. */
export function runWithKeyProjectScope<T>(userId: string, allowed: readonly string[], fn: () => Promise<T>): Promise<T> {
  return scopeStore.run({ userId, allowed: new Set(allowed) }, fn)
}

/** The project limit for `userId` on this request, or null when unlimited. */
export function keyProjectLimit(userId: string): ReadonlySet<string> | null {
  const scope = scopeStore.getStore()
  return scope && scope.userId === userId ? scope.allowed : null
}

/** `ids` narrowed to this request's key limit for `userId` (unchanged when unlimited). */
export function limitToKeyProjects(userId: string, ids: string[]): string[] {
  const limit = keyProjectLimit(userId)
  return limit ? ids.filter((id) => limit.has(id)) : ids
}

/** False when this request's key limit for `userId` excludes `projectId`. */
export function keyAllowsProject(userId: string, projectId: string): boolean {
  const limit = keyProjectLimit(userId)
  return !limit || limit.has(projectId)
}
