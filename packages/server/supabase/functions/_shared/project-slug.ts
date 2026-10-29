/**
 * FILE: packages/server/supabase/functions/_shared/project-slug.ts
 * PURPOSE: Allocate a `projects.slug` on create without turning a taken
 *          handle into a 500. `projects.slug` is globally unique
 *          (`projects_slug_key`). Two apps named "My SaaS App" both derive
 *          `my-saas-app`; the second insert used to fail with SQLSTATE 23505
 *          and the admin route reported it as DbError.
 *
 * OVERVIEW:
 * - Slug shape matches the historical create routes: lowercase, non-alphanumerics
 *   become "-", one leading and trailing dash stripped, then 48 characters.
 * - Insert the plain slug, then `-2` … `-11`, then four random tails.
 * - Retry only a slug unique violation. Any other error stops the loop.
 *
 * DEPENDENCIES: none. Callers pass the service-role client.
 *
 * USAGE: POST /v1/admin/projects and POST /v1/cli/projects.
 */

export const PROJECT_SLUG_MAX = 48

export type ProjectInsertError = {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
}

type InsertResult = { data: { id: string } | null; error: ProjectInsertError | null }

/** The subset of the service client this allocator calls. */
export interface ProjectSlugDb {
  from(table: string): {
    insert(values: {
      name: string
      slug: string
      owner_id: string
      organization_id: string
    }): {
      select(columns: string): {
        single(): PromiseLike<InsertResult>
      }
    }
  }
}

function randomSlugTail(): string {
  return crypto.randomUUID().slice(0, 8)
}

/** Historical slug for a project name. Empty results (emoji, "!!!") get a random tail. */
export function projectSlugBase(name: string, randomTail: () => string = randomSlugTail): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, PROJECT_SLUG_MAX)
  return slug || `project-${randomTail()}`
}

/** Keep `base + suffix` inside the 48-character cap. `suffix` includes its leading dash. */
function fitSlug(base: string, suffix: string): string {
  const room = PROJECT_SLUG_MAX - suffix.length
  const head = (room > 0 ? base.slice(0, room) : '').replace(/-+$/g, '')
  return `${head}${suffix}`.replace(/^-+/, '').slice(0, PROJECT_SLUG_MAX).replace(/-+$/g, '')
}

/**
 * Plain slug, then `-2` through `-11`, then four random tails.
 * Suffixes are fitted so a 48-character base still fits.
 */
export function projectSlugCandidates(base: string, randomTail: () => string = randomSlugTail): string[] {
  const numbered = Array.from({ length: 10 }, (_, i) => fitSlug(base, `-${i + 2}`))
  const randoms = Array.from({ length: 4 }, () => fitSlug(base, `-${randomTail()}`))
  const seen = new Set<string>()
  const out: string[] = []
  for (const slug of [base, ...numbered, ...randoms]) {
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

/**
 * True only for the slug unique key. A primary-key collision (`projects_pkey`)
 * or a not-null failure must not be retried under a different slug.
 * The in-memory test double reports `duplicate key on projects` and has no
 * constraint name; Postgres names `projects_slug_key` or `Key (slug)=`.
 */
export function isProjectSlugConflict(error: ProjectInsertError | null | undefined): boolean {
  if (!error) return false
  const message = error.message ?? ''
  const unique = error.code === '23505' || /duplicate key|unique constraint/i.test(message)
  if (!unique) return false
  const text = `${message}\n${error.details ?? ''}`
  if (/projects_slug_key|\(slug\)\s*=/.test(text)) return true
  return /^duplicate key on projects(?: \(partial unique index\))?$/.test(message)
}

/**
 * Insert one project, retrying only when `projects.slug` is already taken.
 * The returned error is always an object, so callers can pass it to `dbError`.
 */
export async function insertProjectAllocatingSlug(
  db: ProjectSlugDb,
  row: { name: string; owner_id: string; organization_id: string },
  randomTail: () => string = randomSlugTail,
): Promise<{ ok: true; id: string; slug: string } | { ok: false; error: ProjectInsertError }> {
  const candidates = projectSlugCandidates(projectSlugBase(row.name, randomTail), randomTail)
  let last: ProjectInsertError = { message: 'project_insert_failed_no_free_slug' }
  for (const slug of candidates) {
    const { data, error } = await db
      .from('projects')
      .insert({
        name: row.name,
        slug,
        owner_id: row.owner_id,
        organization_id: row.organization_id,
      })
      .select('id')
      .single()
    if (data?.id) return { ok: true, id: data.id, slug }
    last = error ?? { code: 'PGRST116', message: 'project insert returned no row' }
    if (!isProjectSlugConflict(error)) break
  }
  return { ok: false, error: last }
}
