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
