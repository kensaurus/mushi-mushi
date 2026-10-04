/**
 * FILE: packages/server/supabase/functions/_shared/skill-catalog.ts
 * PURPOSE: One rule for reading the global skill catalog by slug.
 *
 * `agent_skills` is unique on (source_id, slug), and `skill_sources` is
 * unique per (project_id, repo_slug). When two projects each add the same
 * repo (the suggested `kensaurus/skills`), every slug exists once per source.
 * A `.maybeSingle()` lookup by slug then errors for every tenant: the skill
 * detail 404s, pipeline start says "not found, run skill sync", and the
 * catalog lists each skill twice (console QA #23, 2026-10-04).
 *
 * Every reader picks ONE row per slug with the same preference:
 *   1. a row from one of the caller's own sources, when given;
 *   2. otherwise the most recently updated row;
 *   3. ties broken by id so the choice is stable.
 *
 * No imports: vitest loads this file directly.
 */

export interface SkillRowLike {
  slug: string
  source_id?: string | null
  updated_at?: string | null
  id?: string | null
}

function rank(row: SkillRowLike, preferred: ReadonlySet<string>): [number, string, string] {
  const own = row.source_id && preferred.has(row.source_id) ? 1 : 0
  return [own, row.updated_at ?? '', row.id ?? '']
}

/** True when `a` should win over `b` for the same slug. */
function beats(a: SkillRowLike, b: SkillRowLike, preferred: ReadonlySet<string>): boolean {
  const [ownA, updA, idA] = rank(a, preferred)
  const [ownB, updB, idB] = rank(b, preferred)
  if (ownA !== ownB) return ownA > ownB
  if (updA !== updB) return updA > updB
  return idA > idB
}

/** One row per slug, keeping the input order of first appearance. */
export function dedupeSkillsBySlug<T extends SkillRowLike>(
  rows: readonly T[],
  preferredSourceIds: Iterable<string> = [],
): T[] {
  const preferred = new Set(preferredSourceIds)
  const order: string[] = []
  const best = new Map<string, T>()
  for (const row of rows) {
    const current = best.get(row.slug)
    if (!current) {
      order.push(row.slug)
      best.set(row.slug, row)
    } else if (beats(row, current, preferred)) {
      best.set(row.slug, row)
    }
  }
  return order.map((slug) => best.get(slug)!)
}

/** The single row a slug lookup should use, or null. */
export function pickSkillRow<T extends SkillRowLike>(
  rows: readonly T[] | null | undefined,
  preferredSourceIds: Iterable<string> = [],
): T | null {
  if (!rows || rows.length === 0) return null
  return dedupeSkillsBySlug(rows, preferredSourceIds)[0] ?? null
}

/** Minimal query surface so callers pass a supabase client without a type import. */
interface SkillQuery {
  select(cols: string): SkillQuery
  eq(col: string, value: unknown): SkillQuery
  limit(n: number): SkillQuery
  then<R>(onfulfilled: (v: { data: unknown; error: { message: string } | null }) => R): PromiseLike<R>
}
interface SkillDb {
  from(table: string): unknown
}

/** Most rows one slug can have: one per source that carries it. */
const SLUG_ROW_CAP = 200

/**
 * Read one active skill by slug, tolerating the same slug from several
 * sources. `columns` must include `slug`; `source_id, updated_at, id` are
 * added so the preference rule can run.
 */
export async function findActiveSkillBySlug<T extends SkillRowLike>(
  db: SkillDb,
  slug: string,
  columns: string,
  preferredSourceIds: Iterable<string> = [],
): Promise<{ skill: T | null; error: string | null }> {
  const cols = withRankColumns(columns)
  const q = (db.from('agent_skills') as SkillQuery)
    .select(cols)
    .eq('slug', slug)
    .eq('is_active', true)
    .limit(SLUG_ROW_CAP)
  const { data, error } = await q
  if (error) return { skill: null, error: error.message }
  return { skill: pickSkillRow((data ?? []) as T[], preferredSourceIds), error: null }
}

/** The ids of the project's own skill sources (for the preference rule). */
export async function projectSkillSourceIds(db: SkillDb, projectId: string | null | undefined): Promise<string[]> {
  if (!projectId) return []
  const q = (db.from('skill_sources') as SkillQuery).select('id').eq('project_id', projectId)
  const { data } = await q
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

export function withRankColumns(columns: string): string {
  if (columns.trim() === '*') return '*'
  const have = new Set(columns.split(',').map((c) => c.trim()).filter(Boolean))
  for (const c of ['slug', 'source_id', 'updated_at', 'id']) have.add(c)
  return [...have].join(', ')
}
