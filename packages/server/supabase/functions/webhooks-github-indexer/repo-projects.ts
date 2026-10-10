/**
 * FILE: packages/server/supabase/functions/webhooks-github-indexer/repo-projects.ts
 * PURPOSE: The projects bound to the GitHub repository a webhook is about.
 *
 *          Every GitHub App installation shares one webhook secret, so a
 *          verified delivery proves it came from GitHub, not which tenant it
 *          belongs to. check_run, pull_request and push handlers used to find
 *          fix_attempts by branch name, commit SHA or head ref alone, so a
 *          same-named branch in another installed repo could update another
 *          project's attempt and emit fix_events under its project_id. Those
 *          lookups now stay inside the projects that bound
 *          `repository.full_name`, through any of the bindings the
 *          fix-worker reads: a project_repos row, or project_settings
 *          github_repo_url / codebase_repo_url.
 *
 *          Pure apart from the injected client, so the vitest suite can run it.
 */

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }

const REPO_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i

/** True when `url` points at the GitHub repository `owner/repo` (case-insensitive). */
export function isRepoUrl(url: unknown, fullName: string): boolean {
  if (typeof url !== 'string') return false
  const m = REPO_URL_RE.exec(url.trim())
  return !!m && `${m[1]}/${m[2]}`.toLowerCase() === fullName.toLowerCase()
}

/** Escape LIKE wildcards; repo names may contain `_`. */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Project ids bound to `fullName` (`owner/repo`). Empty when the payload has
 * no repository or no project bound it. Throws on a read error so the
 * delivery fails and GitHub redelivers it.
 */
export async function projectIdsForRepo(db: Db, fullName: string | null | undefined): Promise<string[]> {
  if (!fullName || !fullName.includes('/')) return []
  const pattern = `%github.com/${likeLiteral(fullName)}%`
  const sources: Array<{ table: string; column: string }> = [
    { table: 'project_repos', column: 'repo_url' },
    { table: 'project_settings', column: 'github_repo_url' },
    { table: 'project_settings', column: 'codebase_repo_url' },
  ]
  const results = await Promise.all(
    sources.map(({ table, column }) => db.from(table).select(`project_id, ${column}`).ilike(column, pattern)),
  )
  const ids = new Set<string>()
  results.forEach((res: { data?: Array<Record<string, unknown>> | null; error?: { message: string } | null }, i) => {
    const { table, column } = sources[i]
    if (res.error) throw new Error(`${table}.${column} lookup failed: ${res.error.message}`)
    for (const row of res.data ?? []) {
      if (typeof row.project_id === 'string' && isRepoUrl(row[column], fullName)) ids.add(row.project_id)
    }
  })
  return [...ids]
}
