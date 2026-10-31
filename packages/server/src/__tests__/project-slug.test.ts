/**
 * _shared/project-slug.ts: a project name another account already used must
 * not 500. On 2026-10-29 two new accounts in a first-time user test both named
 * their app "My SaaS App" (the console's placeholder); the second got
 * DB_ERROR 23505 on projects_slug_key and could not create an app.
 */
import { describe, it, expect } from 'vitest'

import {
  insertProjectWithFreeSlug,
  isSlugCollision,
  projectSlugBase,
  projectSlugWithTail,
} from '../../supabase/functions/_shared/project-slug.ts'

const SLUG_TAKEN = { code: '23505', message: 'duplicate key value violates unique constraint "projects_slug_key"' }

/** A projects table with a unique slug, recording every insert attempt. */
function fakeDb(taken: string[], other?: { code: string; message: string }) {
  const slugs = new Set(taken)
  const tried: string[] = []
  const db = {
    from(table: string) {
      expect(table).toBe('projects')
      return {
        insert(row: { slug: string; name: string; organization_id: string }) {
          tried.push(row.slug)
          const result = other
            ? { data: null, error: other }
            : slugs.has(row.slug)
              ? { data: null, error: SLUG_TAKEN }
              : (slugs.add(row.slug), { data: { id: `id-${tried.length}`, slug: row.slug }, error: null })
          return { select: () => ({ single: async () => result }) }
        },
      }
    },
  }
  return { db: db as never, tried }
}

const NEW = { name: 'My SaaS App', owner_id: 'u1', organization_id: 'o1' }

describe('project slugs', () => {
  it('keeps the readable slug when it is free', async () => {
    const { db, tried } = fakeDb([])
    const { data, error } = await insertProjectWithFreeSlug(db, NEW)
    expect(error).toBeNull()
    expect(data?.slug).toBe('my-saas-app')
    expect(tried).toEqual(['my-saas-app'])
  })

  it('adds a short tail when another account already has the slug', async () => {
    const { db, tried } = fakeDb(['my-saas-app'])
    const { data, error } = await insertProjectWithFreeSlug(db, NEW)
    expect(error).toBeNull()
    expect(data?.slug).toMatch(/^my-saas-app-[0-9a-f]{5}$/)
    expect(tried).toHaveLength(2)
  })

  it('returns any other database error unchanged, without retrying', async () => {
    const notNull = { code: '23502', message: 'null value in column "organization_id"' }
    const { db, tried } = fakeDb([], notNull)
    const { data, error } = await insertProjectWithFreeSlug(db, NEW)
    expect(data).toBeNull()
    expect(error).toEqual(notNull)
    expect(tried).toHaveLength(1)
  })

  it('gives up after a few collisions and returns the error', async () => {
    const { db, tried } = fakeDb([], SLUG_TAKEN)
    const { error } = await insertProjectWithFreeSlug(db, NEW)
    expect(error?.code).toBe('23505')
    expect(tried).toHaveLength(4)
  })

  it('never writes an empty slug and keeps every slug within 48 characters', () => {
    expect(projectSlugBase('!!! 🐛')).toMatch(/^project-[0-9a-f]{8}$/)
    const long = projectSlugBase('a'.repeat(80))
    expect(long).toHaveLength(48)
    expect(projectSlugWithTail(long).length).toBeLessThanOrEqual(48)
    expect(projectSlugWithTail('ab-cd-'.repeat(8))).not.toMatch(/--/)
  })

  it('treats only a unique violation on the slug as a collision', () => {
    expect(isSlugCollision(SLUG_TAKEN)).toBe(true)
    expect(isSlugCollision({ code: '23505', message: 'duplicate key value violates unique constraint "projects_pkey"' })).toBe(false)
    expect(isSlugCollision({ code: '23502', message: 'slug is null' })).toBe(false)
    expect(isSlugCollision(null)).toBe(false)
  })
})
