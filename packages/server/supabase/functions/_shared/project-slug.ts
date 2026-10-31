/**
 * Project slugs. `projects.slug` is unique across every account, so a name
 * someone else used ("My SaaS App", 2026-10-29) gets a short random tail on
 * collision instead of a 500 (23505 projects_slug_key).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SLUG_MAX = 48
const SLUG_ATTEMPTS = 4

/** Lowercase, non-alphanumerics to '-', trimmed, ≤48 chars; never empty. */
export function projectSlugBase(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
  return slug || `project-${randomTail(8)}`
}

/** The base with a random tail, still ≤48 chars. */
export function projectSlugWithTail(base: string): string {
  const tail = randomTail(5)
  return `${base.slice(0, SLUG_MAX - tail.length - 1).replace(/-$/, '')}-${tail}`
}

function randomTail(n: number): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, n)
}

interface DbError {
  code?: string
  message: string
  details?: string | null
}

/** A unique violation on the slug, not on any other column. */
export function isSlugCollision(error: DbError | null | undefined): boolean {
  if (!error || error.code !== '23505') return false
  return /slug/i.test(`${error.message} ${error.details ?? ''}`)
}

export interface NewProject {
  name: string
  owner_id: string
  organization_id: string
}

/**
 * Insert a project under the readable slug, or a tailed one when that slug is
 * taken. Any other error is returned unchanged for the caller's error path.
 */
export async function insertProjectWithFreeSlug(
  db: SupabaseClient,
  project: NewProject,
): Promise<{ data: { id: string; slug: string } | null; error: DbError | null }> {
  const base = projectSlugBase(project.name)
  let slug = base
  let lastError: DbError | null = null
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const { data, error } = await db
      .from('projects')
      .insert({ ...project, slug })
      .select('id, slug')
      .single()
    if (!error) return { data: data as { id: string; slug: string }, error: null }
    lastError = error as DbError
    if (!isSlugCollision(lastError)) break
    slug = projectSlugWithTail(base)
  }
  return { data: null, error: lastError }
}
