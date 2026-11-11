/**
 * The repo guard of `mushi work`: the CLI keeps one key, and keys are bound to
 * one project. After `mushi login --project-id <app A>`, a run pointed at app
 * B's clone would "fix" app A's reports inside app B (found 2026-11-11; only
 * a dry run caught it). whoami names the repos the key's project is linked
 * to; a clone whose origin is none of them stops before anything is claimed.
 */

/** Strip `user:password@` from a remote, so a token in a clone URL is never printed. @internal Exported for tests. */
export function redactRemote(url: string): string {
  return url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1')
}

/**
 * `host/owner/repo`, lower case, for any spelling of the same remote:
 * `https://host/o/r.git`, `ssh://git@host:22/o/r`, `git@host:o/r`, a
 * token in the URL, a trailing slash. A bare `owner/repo` is read as GitHub.
 * Null when nothing is left.
 * @internal Exported for tests.
 */
export function normaliseRepoUrl(url: string): string | null {
  let s = url.trim()
  if (!s) return null
  const proto = /^[a-z][a-z0-9+.-]*:\/\//i.exec(s)
  if (proto) {
    s = s.slice(proto[0].length).replace(/^[^@/]*@/, '')
    // host[:port]/path → host/path
    s = s.replace(/^([^/:]+):\d+(?=\/|$)/, '$1')
  } else {
    // scp-like `git@host:owner/repo`
    s = s.replace(/^[^@/]*@/, '')
    s = s.replace(/^([^/:]+):(?!\/)/, '$1/')
  }
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
  if (!s) return null
  const parts = s.split('/').filter(Boolean)
  if (parts.length === 2 && !parts[0]!.includes('.')) parts.unshift('github.com')
  return parts.length ? parts.join('/') : null
}

/** True when the origin is one of the linked repos (an empty list matches anything). @internal Exported for tests. */
export function originMatchesRepos(origin: string | null, repoUrls: readonly string[]): boolean {
  if (!repoUrls.length) return true
  const o = origin ? normaliseRepoUrl(origin) : null
  if (!o) return false
  return repoUrls.some((u) => normaliseRepoUrl(u) === o)
}

/**
 * The words `mushi work` stops with when the clone is not the key's project's
 * repo. Null when it matches or the server named no repos (an older server,
 * or a project with none linked).
 * @internal Exported for tests.
 */
export function wrongRepoMessage(o: {
  projectName: string | null | undefined
  projectId: string | null | undefined
  repoUrls: readonly string[] | undefined
  origin: string | null
  repoDir: string
}): { message: string; hint: string } | null {
  if (!o.repoUrls?.length || originMatchesRepos(o.origin, o.repoUrls)) return null
  const project = o.projectName ? `${o.projectName}${o.projectId ? ` (${o.projectId})` : ''}` : (o.projectId ?? 'this key\'s project')
  const origin = o.origin ? redactRemote(o.origin) : '(no origin remote)'
  return {
    message:
      `Wrong repo: your Mushi key belongs to ${project}, which is linked to ${o.repoUrls.join(', ')}, ` +
      `but ${o.repoDir} has origin ${origin}. mushi work would apply that project's reports to this repo, so it stopped before claiming anything.`,
    hint:
      'In this repo, run `mushi login --upgrade-scope --project-id <the project for this repo>`, ' +
      'or pass --repo-dir with a clone of the linked repo. For a monorepo or a fork, pass --any-repo to skip this check.',
  }
}
