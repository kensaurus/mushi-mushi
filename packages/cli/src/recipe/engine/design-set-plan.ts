/**
 * FILE: packages/server/supabase/functions/_shared/design-set-plan.ts
 * PURPOSE: Which token files form which set (Plan 019 Appendix B), and which
 *          set deviance judges against. Moved out of design-sets.ts, which
 *          re-exports it, so the CLI can plan sets without the asset and
 *          direction-board code.
 *
 * Engine file: kept byte-identical in packages/cli/src/recipe/engine/
 * (see design-engine-types.ts).
 */

import { normalizeRepoPath } from './recipe-glob.ts'
import type { RecipeIssue, TokenSetKind } from './design-engine-types.ts'

export const MAX_TOKEN_FILES = 40
export const MAX_TOKEN_FILE_BYTES = 1024 * 1024

export interface ManifestTokenFile {
  path: string
  role: 'source' | 'export'
  generator?: string
}

export interface PlannedSet {
  name: string
  kind: TokenSetKind
  active: boolean
  files: Array<{ path: string; role: 'source' | 'export'; generator: string | null }>
  /** design.directions[].note, when the manifest declares directions. */
  note?: string | null
}

export interface DeclaredDirection {
  name: string
  status: 'active' | 'inactive'
  tokens: string[]
  note?: string
}

const DIRECTION_RE = /^(.*?(?:^|\/)directions\/)([^/]+)\/([^/]+\.json)$/

export function directionOf(path: string): { base: string; name: string; file: string } | null {
  const m = DIRECTION_RE.exec(path)
  return m ? { base: m[1], name: m[2], file: m[3] } : null
}

/**
 * Plan the sets. When the manifest declares `design.directions[]`, those are
 * the directions (Plan 019 §2): the active one is the `source` files, the
 * inactive ones are read-only comparison sets. Without it, sibling folders
 * under the same `directions/` parent are found in `treePaths` (pass [] when
 * the tree is unavailable).
 */
export function planTokenSets(
  declared: readonly ManifestTokenFile[],
  treePaths: readonly string[],
  directions: readonly DeclaredDirection[] = [],
): { sets: PlannedSet[]; issues: RecipeIssue[] } {
  const issues: RecipeIssue[] = []
  const safe = declared
    .map((t) => ({ ...t, path: normalizeRepoPath(t.path) }))
    .filter((t): t is ManifestTokenFile & { path: string } => t.path !== null)
  const sources = safe.filter((t) => t.role === 'source')
  const exports = safe.filter((t) => t.role === 'export')

  const sets: PlannedSet[] = []
  const dirs = sources.map((t) => directionOf(t.path))
  const sameDirection = sources.length > 0 && dirs.every((d) => d && d.base === dirs[0]!.base && d.name === dirs[0]!.name)
  const declaredActive = directions.find((d) => d.status === 'active')
  const activeName = declaredActive?.name ?? (sameDirection ? dirs[0]!.name : 'default')
  if (sources.length > 0) {
    sets.push({
      name: activeName,
      kind: sameDirection || declaredActive ? 'direction' : 'default',
      active: true,
      files: sources.map((t) => ({ path: t.path, role: 'source' as const, generator: t.generator ?? null })),
      note: declaredActive?.note ?? null,
    })
  }

  if (directions.length > 0) {
    for (const d of directions) {
      if (d.status !== 'inactive' || d.name === activeName) continue
      const files = d.tokens.map((p) => normalizeRepoPath(p)).filter((p): p is string => p !== null)
      sets.push({ name: d.name, kind: 'direction', active: false, files: files.map((path) => ({ path, role: 'source' as const, generator: null })), note: d.note ?? null })
    }
  } else if (sameDirection) {
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

/**
 * The set deviance and edits use: the active set, else the export set
 * (each only when it has tokens).
 */
export function judgingSet<S extends { active: boolean; kind: TokenSetKind; tokens: readonly unknown[] }>(stored: { sets: readonly S[] } | null): S | null {
  if (!stored) return null
  return stored.sets.find((s) => s.active && s.tokens.length > 0) ?? stored.sets.find((s) => s.kind === 'export' && s.tokens.length > 0) ?? null
}
