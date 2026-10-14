/**
 * FILE: packages/server/supabase/functions/_shared/github-pr-checks.ts
 * PURPOSE: What the console needs to show and merge a pull request: its title,
 *          the checks its base branch requires, the check runs on its head,
 *          the repos connected to a project, and a merge message without
 *          CI-skip markers. Shared by UX runs and the Pull requests page.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { parseGithubRepoUrl, resolveProjectGithubToken, type GithubRepoRef } from './github.ts'
import type { CheckRunLike } from './ux-runs.ts'

export const githubJsonHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

export async function prTitle(token: string, ref: GithubRepoRef, n: number): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${n}`, { headers: githubJsonHeaders(token), signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  return ((await res.json()) as { title?: string }).title ?? null
}

/** Status checks the base branch's rules require (rulesets); none when there are no rules. */
export async function requiredChecks(token: string, ref: GithubRepoRef, branch: string): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/rules/branches/${encodeURIComponent(branch)}`, { headers: githubJsonHeaders(token), signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return []
  const rules = (await res.json()) as Array<{ type?: string; parameters?: { required_status_checks?: Array<{ context?: string }> } }>
  return [...new Set(rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => (r.parameters?.required_status_checks ?? []).map((s) => s.context ?? '')).filter(Boolean))]
}

export async function checkRuns(token: string, ref: GithubRepoRef, sha: string): Promise<CheckRunLike[]> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs?per_page=100`, { headers: githubJsonHeaders(token), signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return []
  return ((await res.json()) as { check_runs?: CheckRunLike[] }).check_runs ?? []
}

/**
 * Drops CI-skip markers ("[skip ci]", "[ci skip]", "***NO_CI***", …) from text that becomes a commit message.
 * GitHub's default squash message lists every commit's subject, and one "[skip ci]" in it silences every
 * workflow on the merge, a store release included (glot.it #146, 2026-10-07).
 * @internal Exported for tests only.
 */
export function stripCiSkips(text: string): string {
  return text.replace(/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|\*\*\*NO_CI\*\*\*/gi, '').replace(/\s{2,}/g, ' ').trim()
}

export const sameRepo = (a: GithubRepoRef, b: GithubRepoRef) =>
  a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()

/**
 * The GitHub repos connected to a project (project_repos, then the legacy
 * project_settings.github_repo_url), deduplicated. A stored token may reach
 * other repos, so every merge checks its repo against this list.
 */
export async function connectedRepoRefs(db: SupabaseClient, projectId: string): Promise<GithubRepoRef[]> {
  const [{ data: repos }, { data: settings }] = await Promise.all([
    db.from('project_repos').select('repo_url, is_primary').eq('project_id', projectId).order('is_primary', { ascending: false }),
    db.from('project_settings').select('github_repo_url').eq('project_id', projectId).maybeSingle(),
  ])
  const refs = [...((repos ?? []) as Array<{ repo_url: string | null }>).map((r) => r.repo_url), (settings as { github_repo_url?: string | null } | null)?.github_repo_url]
    .map((u) => parseGithubRepoUrl(u ?? null))
    .filter((r): r is GithubRepoRef => r !== null)
  return refs.filter((r, i) => refs.findIndex((x) => sameRepo(x, r)) === i)
}

/**
 * A token per connected repo, read with that repo's GitHub App installation
 * (its project_repos row, else the primary row's). resolveProjectGithubToken
 * mints an App token only when handed an installation id, so a project with
 * the App installed and no stored token read as "not connected" (lets-talk,
 * 2026-10-14). Never the platform token. One mint per installation.
 */
export async function repoTokenResolver(db: SupabaseClient, projectId: string): Promise<(ref: GithubRepoRef) => Promise<string | null>> {
  const { data } = await db.from('project_repos').select('repo_url, is_primary, github_app_installation_id').eq('project_id', projectId)
  const rows = ((data ?? []) as Array<{ repo_url: string | null; is_primary: boolean | null; github_app_installation_id: unknown }>).map((r) => ({
    ref: parseGithubRepoUrl(r.repo_url ?? null),
    primary: r.is_primary === true,
    installationId: Number(r.github_app_installation_id) > 0 ? Number(r.github_app_installation_id) : null,
  }))
  const primaryId = rows.find((r) => r.primary)?.installationId ?? null
  const tokens = new Map<number | null, Promise<string | null>>()
  return (ref) => {
    const id = rows.find((r) => r.ref !== null && sameRepo(r.ref, ref))?.installationId ?? primaryId
    if (!tokens.has(id)) tokens.set(id, resolveProjectGithubToken(db as never, projectId, id, { allowEnvFallback: false }))
    return tokens.get(id)!
  }
}
