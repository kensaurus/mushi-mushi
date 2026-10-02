/**
 * FILE: packages/server/supabase/functions/_shared/design-sets.ts
 * PURPOSE: Decide which token files form which set (Plan 019 Appendix B):
 *          the files mushi.recipe.json lists are the ACTIVE set; sibling
 *          folders under the same `directions/` parent are candidate
 *          directions shown beside it; `role: "export"` files form a
 *          read-only `export` set. Pure, so the set plan is testable.
 */

import { normalizeRepoPath } from './recipe-glob.ts'
import type { DesignToken, DesignTokenSet, RecipeIssue } from './recipe-types.ts'

export const MAX_TOKEN_FILES = 40
export const MAX_TOKEN_FILE_BYTES = 1024 * 1024

export interface ManifestTokenFile {
  path: string
  role: 'source' | 'export'
  generator?: string
}

export interface PlannedSet {
  name: string
  kind: DesignTokenSet['kind']
  active: boolean
  files: Array<{ path: string; role: 'source' | 'export'; generator: string | null }>
}

const DIRECTION_RE = /^(.*?(?:^|\/)directions\/)([^/]+)\/([^/]+\.json)$/

export function directionOf(path: string): { base: string; name: string; file: string } | null {
  const m = DIRECTION_RE.exec(path)
  return m ? { base: m[1], name: m[2], file: m[3] } : null
}

/**
 * Plan the sets. `treePaths` is the repo's blob list (used only to find
 * sibling directions; pass [] when it is unavailable).
 */
export function planTokenSets(declared: readonly ManifestTokenFile[], treePaths: readonly string[]): { sets: PlannedSet[]; issues: RecipeIssue[] } {
  const issues: RecipeIssue[] = []
  const safe = declared
    .map((t) => ({ ...t, path: normalizeRepoPath(t.path) }))
    .filter((t): t is ManifestTokenFile & { path: string } => t.path !== null)
  const sources = safe.filter((t) => t.role === 'source')
  const exports = safe.filter((t) => t.role === 'export')

  const sets: PlannedSet[] = []
  const dirs = sources.map((t) => directionOf(t.path))
  const sameDirection = sources.length > 0 && dirs.every((d) => d && d.base === dirs[0]!.base && d.name === dirs[0]!.name)
  const activeName = sameDirection ? dirs[0]!.name : 'default'
  if (sources.length > 0) {
    sets.push({
      name: activeName,
      kind: sameDirection ? 'direction' : 'default',
      active: true,
      files: sources.map((t) => ({ path: t.path, role: 'source' as const, generator: t.generator ?? null })),
    })
  }

  if (sameDirection) {
    const base = dirs[0]!.base
    const siblings = new Map<string, string[]>()
    for (const p of treePaths) {
      if (!p.startsWith(base)) continue
      const d = directionOf(p)
      if (!d || d.base !== base || d.name === activeName) continue
      if (!/\.tokens\.json$|^tokens\.json$/.test(d.file)) continue
      const list = siblings.get(d.name) ?? []
      list.push(p)
      siblings.set(d.name, list)
    }
    for (const name of [...siblings.keys()].sort()) {
      sets.push({
        name,
        kind: 'direction',
        active: false,
        files: siblings.get(name)!.sort().map((path) => ({ path, role: 'source' as const, generator: null })),
      })
    }
  }

  if (exports.length > 0) {
    sets.push({
      name: 'export',
      kind: 'export',
      active: sources.length === 0,
      files: exports.map((t) => ({ path: t.path, role: 'export' as const, generator: t.generator ?? null })),
    })
  }

  // Cap the total file count, keeping the active set whole.
  let budget = MAX_TOKEN_FILES
  const capped: PlannedSet[] = []
  for (const s of sets) {
    if (s.files.length > budget) {
      issues.push({ severity: 'warn', code: 'too_many_token_files', message: `Only ${MAX_TOKEN_FILES} token files are read per refresh; set "${s.name}" was skipped.` })
      continue
    }
    budget -= s.files.length
    capped.push(s)
  }
  return { sets: capped, issues }
}

export interface StoredTokenSet extends PlannedSet {
  tokens: DesignToken[]
  issues: RecipeIssue[]
}

/** The `app_recipe_snapshots.tokens` document. */
export interface StoredTokens {
  version: 1
  active: string | null
  sets: StoredTokenSet[]
}

/** The set deviance and edits use: the active set, else the export set. */
export function judgingSet(stored: StoredTokens | null): StoredTokenSet | null {
  if (!stored) return null
  return stored.sets.find((s) => s.active && s.tokens.length > 0) ?? stored.sets.find((s) => s.kind === 'export' && s.tokens.length > 0) ?? null
}

export function toSetSummary(s: StoredTokenSet): DesignTokenSet {
  return { name: s.name, active: s.active, kind: s.kind, files: s.files, tokenCount: s.tokens.length }
}
