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
 *          github_repo_url / codebase_repo_url, plus the organization
 *          default (organization_integration_settings.github_repo_url) that
 *          projects without their own repo inherit.
 *
 *          Pure apart from the injected client, so the vitest suite can run it.
 */

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }
type DbError = { message: string; code?: string | null }
type QueryResult = { data?: Array<Record<string, unknown>> | null; error?: DbError | null }

/**
 * A binding lookup failed. `dbError` keeps the PostgREST error, code included,
 * so the route can tell a pooler outage (503, logged as a warning) from a real
 * error (500, reported to Sentry).
 */
export class RepoLookupError extends Error {
  constructor(message: string, readonly dbError: DbError) {
    super(message)
    this.name = 'RepoLookupError'
  }
}

const REPO_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i

/** True when `url` points at the GitHub repository `owner/repo` (case-insensitive). */
export function isRepoUrl(url: unknown, fullName: string): boolean {
  if (typeof url !== 'string') return false
  const m = REPO_URL_RE.exec(url.trim())
  return !!m && `${m[1]}/${m[2]}`.toLowerCase() === fullName.toLowerCase()
}

function isStatementTimeout(err: DbError | null | undefined): boolean {
  return !!err && (err.code === '57014' || /statement timeout/i.test(err.message ?? ''))
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
    { table: 'organization_integration_settings', column: 'github_repo_url' },
  ]
  const lookup = ({ table, column }: { table: string; column: string }): Promise<QueryResult> => {
    const key = table === 'organization_integration_settings' ? 'organization_id' : 'project_id'
    return db.from(table).select(`${key}, ${column}`).ilike(column, pattern)
  }
  const first: QueryResult[] = await Promise.all(sources.map(lookup))
  // These tables hold a few rows each, so a statement timeout here means the
  // database was stalled for the whole 8 s, not a slow query: try that lookup
  // once more before failing a delivery GitHub will not resend on its own
  // (MUSHI-MUSHI-SERVER-2X).
  const results = await Promise.all(
    first.map((res, i) => (isStatementTimeout(res.error) ? lookup(sources[i]) : res)),
  )
  const ids = new Set<string>()
  const orgIds = new Set<string>()
  results.forEach((res: QueryResult, i) => {
    const { table, column } = sources[i]
    if (res.error) throw new RepoLookupError(`${table}.${column} lookup failed: ${res.error.message}`, res.error)
    for (const row of res.data ?? []) {
      if (!isRepoUrl(row[column], fullName)) continue
      if (typeof row.project_id === 'string') ids.add(row.project_id)
      if (typeof row.organization_id === 'string') orgIds.add(row.organization_id)
    }
  })
  if (orgIds.size > 0) {
    const res: QueryResult = await db.from('projects').select('id').in('organization_id', [...orgIds])
    if (res.error) throw new RepoLookupError(`projects lookup failed: ${res.error.message}`, res.error)
    for (const row of res.data ?? []) if (typeof row.id === 'string') ids.add(row.id)
  }
  return [...ids]
}
