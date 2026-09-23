/**
 * The landing alias (/mushi-mushi/, outside basePath) must read as the docs
 * root "/", or the footer and analytics disagree with the server render.
 */
import { describe, expect, it } from 'vitest'
import { planRouteViews } from './site-analytics'
import { toSitePathname } from './site-pathname'

const ALIAS = '/mushi-mushi'

describe('toSitePathname', () => {
  it('maps the landing alias, with or without the trailing slash, to "/"', () => {
    expect(toSitePathname('/mushi-mushi/', ALIAS)).toBe('/')
    expect(toSitePathname('/mushi-mushi', ALIAS)).toBe('/')
  })

  it('leaves docs routes and look-alike paths alone', () => {
    expect(toSitePathname('/', ALIAS)).toBe('/')
    expect(toSitePathname('/pricing', ALIAS)).toBe('/pricing')
    expect(toSitePathname('/mushi-mushi-extra', ALIAS)).toBe('/mushi-mushi-extra')
    expect(toSitePathname('/mushi-mushi/pricing', ALIAS)).toBe('/mushi-mushi/pricing')
  })

  it('is a no-op without an alias (local dev) or without a pathname', () => {
    expect(toSitePathname('/mushi-mushi/', '')).toBe('/mushi-mushi/')
    expect(toSitePathname(null, ALIAS)).toBeNull()
  })

  it('makes a landing visit at the alias emit landing_view (2026-09-23: it never had)', () => {
    const plan = planRouteViews(toSitePathname('/mushi-mushi/', ALIAS), { page: null, specific: null })
    expect(plan.events.map((e) => e.name)).toContain('landing_view')
  })
})
