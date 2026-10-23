/**
 * FILE: apps/admin/src/lib/projectPresence.ts
 * PURPOSE: Remember, per browser, whether this account owns a project, so a
 *          failed or pending `/v1/admin/setup` fetch never flips the shell
 *          into the "create your first project" state (console audit
 *          2026-10-20, B1). Page stats banners share it through
 *          statsWithProjectPresence (B1a). Kept apart from useSetupStatus so
 *          supabase.ts can clear it on sign-out without an import cycle.
 */

/**
 * The last answer to "does this account own a project?" that a setup
 * response gave, kept per browser so a failed fetch on the next page load
 * does not read as "no projects". Only a resolved response writes it.
 */
const HAS_ANY_PROJECT_KEY = 'mushi:has_any_project'
let rememberedHasAnyProject: boolean | null = null

export function readRememberedHasAnyProject(): boolean | null {
  if (rememberedHasAnyProject !== null) return rememberedHasAnyProject
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(HAS_ANY_PROJECT_KEY)
    if (raw === '1') rememberedHasAnyProject = true
    else if (raw === '0') rememberedHasAnyProject = false
  } catch {
    /* private mode / blocked storage: memory only */
  }
  return rememberedHasAnyProject
}

export function rememberHasAnyProject(value: boolean): void {
  rememberedHasAnyProject = value
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(HAS_ANY_PROJECT_KEY, value ? '1' : '0')
  } catch {
    /* non-fatal */
  }
}

/** Sign-out: the next account must not inherit this one's answer. */
export function forgetHasAnyProject(): void {
  rememberedHasAnyProject = null
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(HAS_ANY_PROJECT_KEY)
  } catch {
    /* non-fatal */
  }
}

/**
 * Pure derivation shared by useSetupStatus and useActivationStatus: a
 * resolved response is the truth and is remembered; otherwise the remembered
 * answer stands in, and with nothing remembered we assume a project exists
 * (the common case for a returning user) until the response says otherwise.
 */
export function deriveHasAnyProject(
  response: { has_any_project: boolean } | null | undefined,
  remembered: boolean | null,
): { hasAnyProject: boolean; resolved: boolean } {
  if (response) return { hasAnyProject: response.has_any_project, resolved: true }
  return { hasAnyProject: remembered ?? true, resolved: false }
}

/**
 * Fill a page's empty stats while its request is pending or failed.
 * A resolved payload is merged over `empty` and wins, including
 * `hasAnyProject: false`. With no payload, the remembered answer stands in,
 * and with nothing remembered we assume a project exists — the same rule as
 * `deriveHasAnyProject` — so the banner does not say "create a project first".
 */
export function statsWithProjectPresence<T extends { hasAnyProject: boolean }>(
  data: T | null | undefined,
  empty: T,
): T {
  if (data) return { ...empty, ...data }
  return { ...empty, hasAnyProject: readRememberedHasAnyProject() ?? true }
}
