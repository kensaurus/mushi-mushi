/**
 * Slug allocation for project create. projects.slug is unique across every
 * team, so a second "Demo" must take demo-2 instead of raising 23505.
 */
import { describe, expect, it } from 'vitest'
import {
  PROJECT_SLUG_MAX,
  insertWithUniqueProjectSlug,
  projectSlugCandidates,
  projectSlugFromName,
  projectSlugWithSuffix,
} from '../../supabase/functions/_shared/project-slug.ts'

describe('project slug allocation', () => {
  it('slugifies a name the way project create always has', () => {
    expect(projectSlugFromName('  Secret Slug!! ')).toBe('secret-slug')
    expect(projectSlugFromName('!!!')).toMatch(/^project-[0-9a-f]{8}$/)
  })

  it('keeps a suffixed slug inside the 48-character cap', () => {
    const base = 'a'.repeat(48)
    const slug = projectSlugWithSuffix(base, '2')
    expect(slug.length).toBeLessThanOrEqual(PROJECT_SLUG_MAX)
    expect(slug.endsWith('-2')).toBe(true)
  })

  it('offers the plain slug, then -2, -3', () => {
    expect(projectSlugCandidates('secret-slug').slice(0, 3)).toEqual([
      'secret-slug',
      'secret-slug-2',
      'secret-slug-3',
    ])
  })

  it('retries a unique violation and stops on any other error', async () => {
    const tried: string[] = []
    const taken = new Set(['secret-slug', 'secret-slug-2'])
    const won = await insertWithUniqueProjectSlug('secret-slug', async (slug) => {
      tried.push(slug)
      if (taken.has(slug)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "projects_slug_key"' } }
      return { data: { id: 'new' }, error: null }
    })
    expect(won).toEqual({ ok: true, slug: 'secret-slug-3', data: { id: 'new' } })
    expect(tried).toEqual(['secret-slug', 'secret-slug-2', 'secret-slug-3'])

    const stopped: string[] = []
    const lost = await insertWithUniqueProjectSlug('secret-slug', async (slug) => {
      stopped.push(slug)
      return { data: null, error: { code: '23502', message: 'null value in column "organization_id"' } }
    })
    expect(lost.ok).toBe(false)
    expect(stopped).toEqual(['secret-slug'])
  })
})
