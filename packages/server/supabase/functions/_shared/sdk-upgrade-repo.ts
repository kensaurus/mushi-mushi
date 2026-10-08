/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-repo.ts
 * PURPOSE: Pure choice of which linked repo an SDK upgrade PR targets.
 *
 * OVERVIEW:
 * - A project can link several repos (`project_repos`: frontend, backend,
 *   mobile, ...). The upgrade runner used to read only the legacy
 *   `project_settings.github_repo_url`, so a project whose SDK lives in a
 *   non-legacy repo never got an upgrade PR.
 * - Primary first, then the roles that install `@mushi-mushi/*` (backend
 *   counts: `@mushi-mushi/node`). docs/infra repos are a last resort.
 * - The legacy column stays the fallback for projects with no repo rows.
 */

export interface SdkUpgradeRepoRow {
  repo_url: string | null
  role: string | null
  is_primary: boolean | null
  default_branch: string | null
  github_app_installation_id: number | null
}

export interface SdkUpgradeRepoChoice {
  repoUrl: string
  /**
   * Branch recorded on the repo row. Only a fallback when GitHub can't be
   * asked: the column defaults to 'main', so it can be stale.
   */
  defaultBranch: string | null
  installationId: number | null
}

const ROLE_ORDER = ['monorepo', 'frontend', 'mobile', 'backend', 'other', 'ai'] as const
const LAST_RESORT_ROLES = new Set(['docs', 'infra'])

function roleRank(role: string | null): number {
  const i = ROLE_ORDER.indexOf((role ?? 'other') as (typeof ROLE_ORDER)[number])
  return i === -1 ? ROLE_ORDER.length : i
}

export function pickSdkUpgradeRepo(
  rows: readonly SdkUpgradeRepoRow[],
  legacyRepoUrl: string | null,
): SdkUpgradeRepoChoice | null {
  const linked = rows.filter((r) => typeof r.repo_url === 'string' && r.repo_url.trim() !== '')
  const ranked = [...linked].sort((a, b) => {
    const aLast = LAST_RESORT_ROLES.has(a.role ?? '')
    const bLast = LAST_RESORT_ROLES.has(b.role ?? '')
    if (aLast !== bLast) return aLast ? 1 : -1
    if (Boolean(a.is_primary) !== Boolean(b.is_primary)) return a.is_primary ? -1 : 1
    return roleRank(a.role) - roleRank(b.role)
  })
  const best = ranked[0]
  if (best) {
    return {
      repoUrl: best.repo_url as string,
      defaultBranch: best.default_branch?.trim() || null,
      installationId: best.github_app_installation_id ?? null,
    }
  }
  const legacy = legacyRepoUrl?.trim()
  return legacy ? { repoUrl: legacy, defaultBranch: null, installationId: null } : null
}
