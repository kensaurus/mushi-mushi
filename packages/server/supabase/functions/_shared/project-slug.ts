/**
 * FILE: packages/server/supabase/functions/_shared/project-slug.ts
 * PURPOSE: Allocate a projects.slug that survives the global unique
 *          constraint projects_slug_key.
 *
 * Two apps named "Demo" (any team) slugify to the same string. Inserting
 * that slug once surfaced Postgres 23505 as DbError. Callers try the
 * plain slug, then -2, -3, … and a few random tails, and stop on the
 * first success or the first error that is not a unique violation.
 */

export const PROJECT_SLUG_MAX = 48

export function projectSlugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, PROJECT_SLUG_MAX)
  if (slug) return slug
  return `project-${crypto.randomUUID().slice(0, 8)}`
}

/** Suffix goes on after the base is trimmed so the result stays within PROJECT_SLUG_MAX. */
export function projectSlugWithSuffix(base: string, suffix: string): string {
  const extra = suffix.length + 1
  const head = base.slice(0, Math.max(1, PROJECT_SLUG_MAX - extra)).replace(/-+$/g, '')
  return `${head}-${suffix}`.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, PROJECT_SLUG_MAX)
}

export function isUniqueViolation(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  const code = error?.code ?? ''
  const msg = error?.message ?? ''
  return code === '23505' || /duplicate key|unique constraint/i.test(msg)
}

function randomSlugSuffix(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Plain slug, then -2..-11, then four random tails. Duplicates dropped. */
export function projectSlugCandidates(base: string): string[] {
  const numbered = Array.from({ length: 10 }, (_, i) => projectSlugWithSuffix(base, String(i + 2)))
  const random = Array.from({ length: 4 }, () => projectSlugWithSuffix(base, randomSlugSuffix()))
  const seen = new Set<string>()
  const out: string[] = []
  for (const slug of [base, ...numbered, ...random]) {
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

type SlugInsertError = { code?: string; message?: string } | null

/**
 * Insert `base`, then the next free candidate, until one row lands.
 * A non-unique error stops the loop so a real failure is not retried
 * into a different slug.
 */
export async function insertWithUniqueProjectSlug<T>(
  base: string,
  insert: (slug: string) => Promise<{ data: T | null; error: SlugInsertError }>,
): Promise<{ ok: true; slug: string; data: T } | { ok: false; error: SlugInsertError }> {
  let lastError: SlugInsertError = null
  for (const slug of projectSlugCandidates(base)) {
    const { data, error } = await insert(slug)
    if (data) return { ok: true, slug, data }
    lastError = error
    if (!isUniqueViolation(error)) break
  }
  return { ok: false, error: lastError }
}
