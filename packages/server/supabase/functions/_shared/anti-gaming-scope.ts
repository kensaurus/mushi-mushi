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
 * Projects a device / event list should read: just the requested project
 * when it is one of the caller's, else all of them (the sidebar badge and
 * older clients send no project).
 */
export function antiGamingListScope(ownedIds: readonly string[], requested: string | null | undefined): string[] {
  const one = requestedOwnedProject(ownedIds, requested)
  return one ? [one] : [...ownedIds]
}
