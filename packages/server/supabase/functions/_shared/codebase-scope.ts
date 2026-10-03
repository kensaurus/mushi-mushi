/**
 * Path scoping for codebase index / RAG / graph queries.
 * NULL scope_paths = whole repo (backward compatible).
 */

export interface CodebaseScopeSettings {
  scope_paths: string[] | null
  exclude_globs: string[] | null
}

/** Normalize path for prefix/glob matching. */
export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function pathMatchesScope(
  filePath: string,
  scope: CodebaseScopeSettings | null | undefined,
): boolean {
  if (!scope) return true
  const p = normalizeRepoPath(filePath)

  const excludes = scope.exclude_globs ?? []
  for (const g of excludes) {
    const pat = g.trim()
    if (!pat) continue
    if (globToRegExp(normalizeRepoPath(pat)).test(p)) return false
  }

  const prefixes = scope.scope_paths
  if (!prefixes?.length) return true

  return prefixes.some((raw) => {
    const prefix = normalizeRepoPath(raw).replace(/\/+$/, '')
    if (!prefix) return true
    return p === prefix || p.startsWith(`${prefix}/`)
  })
}

export function filterPathsByScope(
  paths: string[],
  scope: CodebaseScopeSettings | null | undefined,
): string[] {
  return paths.filter((p) => pathMatchesScope(p, scope))
}

/**
 * A path-filter glob as a RegExp. Like globToRegExp, except that `**` followed
 * by a slash also matches zero directories, the way gitignore and most glob
 * libraries read it: `<star><star>/<star>.ts` matches a.ts at the repo root
 * and `src/<star><star>/<star>.ts` matches src/a.ts. (globToRegExp, which the
 * scope's exclude globs use, is left as it is so existing excludes do not
 * widen.)
 */
function pathGlobToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '<<ANYDIRS>>')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<ANYDIRS>>/g, '(?:.*/)?')
    .replace(/<<GLOBSTAR>>/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * A repo's `project_repos.path_globs` (the console's "Path filter"): the file
 * must match at least one glob. Empty or missing = every file. `**` spans
 * directories (zero or more, so `<star><star>/<star>.ts` also matches root
 * files), `*` stays inside one segment (`apps/<star>/src/<star><star>`
 * matches apps/web/src/a.ts, not apps/web/lib/a.ts); a glob with no star is a
 * directory prefix.
 *
 * The same column routes the fix worker (by prefix), and since gap 16b it
 * also limits which files the codebase index holds: a sweep tombstones
 * indexed files a narrowed filter excludes.
 */
export function pathMatchesAnyGlob(filePath: string, globs: readonly string[] | null | undefined): boolean {
  const pats = (globs ?? []).map((g) => normalizeRepoPath(g.trim())).filter(Boolean)
  if (pats.length === 0) return true
  const p = normalizeRepoPath(filePath)
  return pats.some((g) => {
    if (g.includes('*')) return pathGlobToRegExp(g).test(p)
    // A bare directory or file ("src", "src/") is a prefix.
    const prefix = g.replace(/\/+$/, '')
    return p === prefix || p.startsWith(`${prefix}/`)
  })
}
