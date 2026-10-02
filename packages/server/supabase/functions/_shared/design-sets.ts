/**
 * FILE: packages/server/supabase/functions/_shared/design-sets.ts
 * PURPOSE: Decide which token files form which set (Plan 019 Appendix B):
 *          the files mushi.recipe.json lists are the ACTIVE set; sibling
 *          folders under the same `directions/` parent are candidate
 *          directions shown beside it; `role: "export"` files form a
 *          read-only `export` set. Pure, so the set plan is testable.
 */

import { normalizeRepoPath } from './recipe-glob.ts'
import type { CssScope } from './css-scopes.ts'
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

export interface DirectionMeta {
  displayName: string
  nativeName: string | null
  concept: string | null
}

export interface StoredAsset {
  path: string
  kind: string
  size: number | null
}

export interface StoredTokenSet extends PlannedSet {
  tokens: DesignToken[]
  issues: RecipeIssue[]
  /** Directions only (absent on snapshots written before the board existed). */
  meta?: DirectionMeta
  assets?: StoredAsset[]
}

function titleCase(slug: string): string {
  return slug.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

/**
 * Name and concept for a direction, from its token files' root metadata:
 * `$extensions["us.kensaur.mushi"].direction = {name, nativeName, concept}`
 * wins; otherwise a root `$description` of the form
 * "… art direction Name (ชื่อ)[, tagline]: …" is read; otherwise the folder name.
 */
export function readDirectionMeta(folder: string, fileTexts: readonly string[]): DirectionMeta {
  let displayName: string | null = null
  let nativeName: string | null = null
  let concept: string | null = null
  for (const text of fileTexts) {
    let doc: Record<string, unknown>
    try {
      doc = JSON.parse(text)
    } catch {
      continue
    }
    const ext = (doc.$extensions as Record<string, unknown> | undefined)?.['us.kensaur.mushi'] as Record<string, unknown> | undefined
    const dir = ext?.direction as Record<string, unknown> | undefined
    if (dir) {
      if (typeof dir.name === 'string' && !displayName) displayName = dir.name.slice(0, 80)
      if (typeof dir.nativeName === 'string' && !nativeName) nativeName = dir.nativeName.slice(0, 80)
      if (typeof dir.concept === 'string' && !concept) concept = dir.concept.slice(0, 500)
    }
    const desc = typeof doc.$description === 'string' ? doc.$description : null
    if (desc) {
      const m = /art direction\s+([^(:,]+?)\s*(?:\(([^)]+)\))?\s*(?:,\s*([^:]+))?:/i.exec(desc)
      if (m) {
        displayName ??= m[1].trim().slice(0, 80)
        nativeName ??= m[2]?.trim().slice(0, 80) ?? null
        if (m[3] && !concept) concept = m[3].trim().slice(0, 500)
      }
    }
  }
  return { displayName: displayName ?? titleCase(folder), nativeName, concept }
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|avif|gif|svg)$/i
export const MAX_ASSETS_PER_SET = 8
export const MAX_ASSET_BYTES = 5 * 1024 * 1024

function assetKind(path: string): string {
  const p = path.toLowerCase()
  if (/icon|logo|favicon/.test(p)) return 'icon'
  if (/sprite|motif|illustration|art/.test(p)) return 'illustration'
  return 'image'
}

/**
 * A set's assets: manifest `design.assets[]` entries naming this direction
 * (or carrying no direction, for the active set), then images found in the
 * repo under `directions/<name>/`. Capped, de-duplicated, images only.
 */
export function collectSetAssets(
  set: Pick<PlannedSet, 'name' | 'kind' | 'active' | 'files'>,
  declared: ReadonlyArray<{ path: string; kind?: string; direction?: string }>,
  tree: ReadonlyArray<{ path: string; size: number }>,
): StoredAsset[] {
  const sizes = new Map(tree.map((e) => [e.path, e.size]))
  const out: StoredAsset[] = []
  const seen = new Set<string>()
  const add = (path: string, kind: string) => {
    const safe = normalizeRepoPath(path)
    if (!safe || seen.has(safe) || out.length >= MAX_ASSETS_PER_SET) return
    seen.add(safe)
    out.push({ path: safe, kind, size: sizes.get(safe) ?? null })
  }
  for (const a of declared) {
    if (!(a.direction ? a.direction === set.name : set.active)) continue
    const safe = normalizeRepoPath(a.path.replace(/\/+$/, ''))
    if (!safe) continue
    // A declared folder lists the images inside it.
    const inside = tree.filter((e) => e.path.startsWith(`${safe}/`) && IMAGE_EXT_RE.test(e.path) && e.size <= MAX_ASSET_BYTES).map((e) => e.path).sort()
    if (inside.length > 0 && !sizes.has(safe)) inside.forEach((p) => add(p, a.kind ?? assetKind(p)))
    else add(safe, a.kind ?? assetKind(safe))
  }
  const dir = set.files.map((f) => directionOf(f.path)).find(Boolean)
  if (set.kind === 'direction' && dir) {
    const prefix = `${dir.base}${set.name}/`
    tree
      .filter((e) => e.path.startsWith(prefix) && IMAGE_EXT_RE.test(e.path) && e.size <= MAX_ASSET_BYTES)
      .map((e) => e.path)
      .sort()
      .forEach((p) => add(p, assetKind(p)))
  }
  return out
}

export interface StoredCss {
  path: string
  role: string
  scopes: CssScope[]
}

/** The `app_recipe_snapshots.tokens` document. */
export interface StoredTokens {
  version: 1
  active: string | null
  sets: StoredTokenSet[]
  /** design.css[] read per scope (light/dark modes are scopes). */
  css?: StoredCss[]
}

/** The set deviance and edits use: the active set, else the export set. */
export function judgingSet(stored: StoredTokens | null): StoredTokenSet | null {
  if (!stored) return null
  return stored.sets.find((s) => s.active && s.tokens.length > 0) ?? stored.sets.find((s) => s.kind === 'export' && s.tokens.length > 0) ?? null
}

export function toSetSummary(s: StoredTokenSet): DesignTokenSet {
  return { name: s.name, active: s.active, kind: s.kind, files: s.files, tokenCount: s.tokens.length, note: s.note ?? null }
}
