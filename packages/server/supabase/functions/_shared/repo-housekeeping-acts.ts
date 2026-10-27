/**
 * FILE: packages/server/supabase/functions/_shared/repo-housekeeping-acts.ts
 * PURPOSE: The names of the GitHub connector's repo clean-up acts (ADR 0051),
 *          kept apart from their executor so `api` (at its deploy size
 *          limit) carries only these names. The executor
 *          (_shared/repo-housekeeping-run.ts) runs in `api-ext` only:
 *          executeConnectorAction refuses these actions unless the caller
 *          injects it, so the generic org connector-action routes in `api`
 *          answer USE_REPO_CLEANUP instead of running them.
 *
 * No imports: vitest loads this file directly.
 */

export const HOUSEKEEPING_ACTIONS = ['delete_branches', 'close_prs', 'set_delete_branch_on_merge', 'restore_branches'] as const
export type HousekeepingAction = (typeof HOUSEKEEPING_ACTIONS)[number]

export function isHousekeepingAction(action: string): action is HousekeepingAction {
  return (HOUSEKEEPING_ACTIONS as readonly string[]).includes(action)
}

export const USE_REPO_CLEANUP_MESSAGE =
  'Repo clean-up runs only from Repo → Clean up (/v1/admin/projects/:id/repo-cleanup): Mushi builds each list from a preview and re-checks every item when it runs.'
