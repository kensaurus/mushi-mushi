/**
 * FILE: packages/server/supabase/functions/_shared/anti-gaming-scope.ts
 * PURPOSE: Which projects the /v1/admin/anti-gaming/* reads cover. Pure, so it
 *          is unit-testable without Deno.
 */

/**
 * The project the console asked for (`?project_id=` or the
 * X-Mushi-Project-Id header) when the caller owns it; otherwise null.
 * Stats used to ignore the request and always describe the oldest project.
 */
export function requestedOwnedProject(
  ownedIds: readonly string[],
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const id of candidates) {
    const trimmed = id?.trim()
    if (trimmed && ownedIds.includes(trimmed)) return trimmed
  }
  return null
}

/**
 * Projects a device / event list or count should read: just the requested
 * project (`?project_id=` first, then the X-Mushi-Project-Id header) when it
 * is one of the caller's, else all of them (older clients send no project).
 * The sidebar badge sends the project only in the header; reading the query
 * alone made it count every owned project ("16 flagged" over a page of 4).
 */
export function antiGamingListScope(
  ownedIds: readonly string[],
  ...requested: Array<string | null | undefined>
): string[] {
  const one = requestedOwnedProject(ownedIds, ...requested)
  return one ? [one] : [...ownedIds]
}
