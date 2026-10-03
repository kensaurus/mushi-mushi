/**
 * FILE: packages/server/supabase/functions/_shared/design-sets.ts
 * PURPOSE: Decide which token files form which set (Plan 019 Appendix B):
 *          the files mushi.recipe.json lists are the ACTIVE set; sibling
 *          folders under the same `directions/` parent are candidate
 *          directions shown beside it; `role: "export"` files form a
 *          read-only `export` set. Pure, so the set plan is testable.
 *
 * The plan itself (planTokenSets, judgingSet) lives in design-set-plan.ts,
 * the engine shared with `mushi recipe check`, and is re-exported here.
 */

import { normalizeRepoPath } from './recipe-glob.ts'
import type { CssScope } from './css-scopes.ts'
import type { DesignToken, DesignTokenSet, RecipeIssue } from './recipe-types.ts'
import { directionOf, type PlannedSet } from './design-set-plan.ts'

export {
  directionOf,
  judgingSet,
  MAX_TOKEN_FILE_BYTES,
  MAX_TOKEN_FILES,
  planTokenSets,
  type DeclaredDirection,
  type ManifestTokenFile,
  type PlannedSet,
} from './design-set-plan.ts'

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

export function toSetSummary(s: StoredTokenSet): DesignTokenSet {
  return { name: s.name, active: s.active, kind: s.kind, files: s.files, tokenCount: s.tokens.length, note: s.note ?? null }
}
