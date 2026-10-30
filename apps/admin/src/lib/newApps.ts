/**
 * FILE: apps/admin/src/lib/newApps.ts
 * PURPOSE: Tell a just-made app that has not checked in yet (setup left to
 *          do) from one that should have and did not (something to fix), so
 *          creating an app is not greeted with a warning.
 */

/** An app this young without an SDK heartbeat is still being set up. @internal */
export const NEW_APP_MS = 24 * 60 * 60 * 1000

/**
 * True when every app missing an SDK heartbeat is younger than a day. The
 * list may be capped, so a count above its length is never "all new".
 */
export function missingAppsAreNew(
  missing: ReadonlyArray<{ createdAt?: string | null }> | undefined,
  missingCount: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!missing || missing.length === 0) return false
  if ((missingCount ?? missing.length) > missing.length) return false
  return missing.every((p) => {
    const t = p.createdAt ? Date.parse(p.createdAt) : NaN
    return Number.isFinite(t) && now - t < NEW_APP_MS
  })
}
