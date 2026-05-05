/**
 * inventory-grounding — pins the new template-aware path matcher that
 * landed as part of the Copilot-comment audit fix (PR #83).
 *
 * The previous matcher used literal `===` comparison between the
 * concrete browser pathname (`/practice/abc-123`) and the inventory's
 * stored Page.path (`/practice/[id]`), which silently dropped grounding
 * for every dynamic route in the catalog. These tests pin the matrix
 * we actually care about so a future refactor cannot regress the fix.
 */

import { describe, expect, it } from 'vitest'

import { pagePathMatchesRoute } from '../../supabase/functions/_shared/inventory-grounding.ts'

describe('pagePathMatchesRoute', () => {
  describe('null / empty', () => {
    it('returns false when template is null', () => {
      expect(pagePathMatchesRoute(null, '/x')).toBe(false)
    })
    it('returns false when concrete is null', () => {
      expect(pagePathMatchesRoute('/x', null)).toBe(false)
    })
    it('returns false when both are null', () => {
      expect(pagePathMatchesRoute(null, null)).toBe(false)
    })
  })

  describe('static paths', () => {
    it('matches identical static paths', () => {
      expect(pagePathMatchesRoute('/dashboard', '/dashboard')).toBe(true)
    })
    it('matches across trailing-slash differences', () => {
      expect(pagePathMatchesRoute('/dashboard/', '/dashboard')).toBe(true)
      expect(pagePathMatchesRoute('/dashboard', '/dashboard/')).toBe(true)
    })
    it('rejects different static paths', () => {
      expect(pagePathMatchesRoute('/dashboard', '/settings')).toBe(false)
    })
    it('rejects when the static template appears as a prefix only', () => {
      expect(pagePathMatchesRoute('/dashboard', '/dashboard/extra')).toBe(false)
    })
  })

  describe('dynamic single-segment templates', () => {
    it('matches `[id]` against a uuid-shaped segment', () => {
      expect(pagePathMatchesRoute('/practice/[id]', '/practice/abc-123')).toBe(true)
    })
    it('matches `[id]` against a numeric segment', () => {
      expect(pagePathMatchesRoute('/users/[userId]', '/users/42')).toBe(true)
    })
    it('matches multiple `[param]` segments in one template', () => {
      expect(
        pagePathMatchesRoute('/users/[userId]/posts/[postId]', '/users/u1/posts/p2'),
      ).toBe(true)
    })
    it('rejects when the concrete path is too short', () => {
      expect(pagePathMatchesRoute('/practice/[id]', '/practice')).toBe(false)
    })
    it('rejects when the concrete path is too long', () => {
      expect(pagePathMatchesRoute('/practice/[id]', '/practice/abc/extra')).toBe(false)
    })
    it('rejects when a literal segment differs', () => {
      expect(pagePathMatchesRoute('/practice/[id]', '/sessions/abc')).toBe(false)
    })
    it('rejects an empty dynamic segment (browser would not produce //)', () => {
      expect(pagePathMatchesRoute('/practice/[id]', '/practice/')).toBe(false)
    })
  })

  describe('catch-all templates', () => {
    it('`[...slug]` matches any tail with at least one segment', () => {
      expect(pagePathMatchesRoute('/docs/[...slug]', '/docs/getting-started')).toBe(true)
      expect(
        pagePathMatchesRoute('/docs/[...slug]', '/docs/setup/auth/redirects'),
      ).toBe(true)
    })
    it('`[...slug]` rejects when zero tail segments are present', () => {
      expect(pagePathMatchesRoute('/docs/[...slug]', '/docs')).toBe(false)
    })
    it('`[[...slug]]` (optional catch-all) matches the prefix alone', () => {
      expect(pagePathMatchesRoute('/blog/[[...slug]]', '/blog')).toBe(true)
      expect(pagePathMatchesRoute('/blog/[[...slug]]', '/blog/2026/05/post')).toBe(true)
    })
  })

  describe('mixed templates', () => {
    it('matches param + literal interleaved', () => {
      expect(
        pagePathMatchesRoute('/[lang]/blog/[slug]', '/en/blog/hello-world'),
      ).toBe(true)
    })
    it('rejects when an interior literal mismatches', () => {
      expect(
        pagePathMatchesRoute('/[lang]/blog/[slug]', '/en/news/hello-world'),
      ).toBe(false)
    })
  })
})
