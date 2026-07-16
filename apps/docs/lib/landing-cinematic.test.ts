/**
 * Smoke: cinematic landing still ships north-star copy from the SSOT.
 * Guards against accidental hero/CTA/nav drift when motion components wrap prose.
 */
import { describe, expect, it } from 'vitest'
import {
  LANDING_HERO,
  LANDING_HERO_CTAS,
  LANDING_SIXTY_SECOND,
  LANDING_PILLARS,
  LANDING_OPERATOR,
  LANDING_WHERE_TO_START,
  LANDING_QUICKSTART_PLATFORMS,
  LANDING_COMPARISON_ROWS,
  LANDING_TRUST_LINKS,
  MUSHI_TAGLINE_V2,
} from './landing-copy'

describe('landing cinematic copy SSOT', () => {
  it('keeps category eyebrow on the v2 ladder', () => {
    expect(LANDING_HERO.eyebrow).toBe(MUSHI_TAGLINE_V2.category)
  })

  it('keeps 60-second proof pricing claim', () => {
    expect(LANDING_SIXTY_SECOND.pricing).toMatch(/50 diagnoses/i)
  })

  it('exposes four diagnosis pillars for the scroll stage', () => {
    expect(LANDING_PILLARS).toHaveLength(4)
    expect(LANDING_PILLARS.map((p) => p.name)).toEqual([
      'User reports',
      'Plain read',
      'One row',
      'Draft PR',
    ])
  })

  it('keeps a clear closing question and solo CTA to incident-loop', () => {
    expect(LANDING_OPERATOR.question.length).toBeGreaterThan(0)
    expect(LANDING_OPERATOR.soloHref).toBe('/quickstart/incident-loop')
    expect(LANDING_OPERATOR.teamHref).toContain('github.com/kensaurus/mushi-mushi')
  })

  it('ships hero CTAs for wizard, repo, and connect', () => {
    const hrefs = LANDING_HERO_CTAS.map((c) => c.href)
    expect(hrefs).toContain('/quickstart/incident-loop')
    expect(hrefs.some((h) => h.includes('github.com/kensaurus/mushi-mushi'))).toBe(true)
    expect(hrefs).toContain('/connect')
  })

  it('keeps both start paths — intent picker plus platform quickstarts', () => {
    expect(LANDING_WHERE_TO_START.length).toBeGreaterThanOrEqual(3)
    expect(LANDING_QUICKSTART_PLATFORMS.length).toBeGreaterThanOrEqual(4)
    expect(LANDING_QUICKSTART_PLATFORMS[0]?.href).toBe('/quickstart/incident-loop')
  })

  it('keeps the full Sentry comparison matrix (not over-trimmed)', () => {
    expect(LANDING_COMPARISON_ROWS.length).toBeGreaterThanOrEqual(6)
  })

  it('links trust chips to real destinations', () => {
    expect(LANDING_TRUST_LINKS.some((t) => t.href.startsWith('https://github.com'))).toBe(true)
    expect(LANDING_TRUST_LINKS.some((t) => t.href === '/self-hosting')).toBe(true)
  })
})

describe('landing motion integrity (no scroll hijack)', () => {
  it('does not ship Lenis / LandingMotionRoot / gsap in docs package.json', async () => {
    const pkg = await import('../package.json')
    const deps = {
      ...pkg.default.dependencies,
      ...pkg.default.devDependencies,
    } as Record<string, string | undefined>
    expect(deps.gsap).toBeUndefined()
    expect(deps.lenis).toBeUndefined()
    expect(deps.motion).toBeDefined()
  })

  it('landing MDX omits LandingMotionRoot', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const mdx = readFileSync(join(here, '../content/index.mdx'), 'utf8')
    expect(mdx).not.toMatch(/LandingMotionRoot/)
    expect(mdx).toMatch(/CinematicEditorialHero/)
  })
})
