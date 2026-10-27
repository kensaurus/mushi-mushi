/**
 * Smoke: cinematic landing still ships north-star copy from the SSOT.
 * Guards against accidental hero/CTA/nav drift when motion components wrap prose.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LANDING_WHAT_THIS_IS,
  LANDING_HERO,
  LANDING_HERO_START,
  LANDING_INSTALL,
  LANDING_SETUP_PROMPT,
  LANDING_FIX_PROMPT,
  LANDING_PILLARS,
  LANDING_OPERATOR,
  LANDING_WHERE_TO_START,
  LANDING_QUICKSTART_PLATFORMS,
  LANDING_COMPARISON_ROWS,
  LANDING_TRUST_LINKS,
} from './landing-copy'
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'
import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('landing cinematic copy SSOT', () => {
  it('keeps category eyebrow on the v2 ladder', () => {
    expect(LANDING_HERO.eyebrow).toBe(MUSHI_TAGLINE_V2.category)
  })

  it('says what Mushi Mushi is in one sentence built from the brand ladder', () => {
    const { definition } = LANDING_WHAT_THIS_IS
    expect(definition.startsWith('Mushi Mushi is ')).toBe(true)
    expect(definition.toLowerCase()).toContain(MUSHI_TAGLINE_V2.category.toLowerCase())
    expect(definition.toLowerCase()).toContain(MUSHI_TAGLINE_V2.promise.toLowerCase())
    expect(definition.split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(1)
    // index.mdx carries it as plain text so the Markdown mirrors keep it.
    const landing = readFileSync(join(__dirname, '..', 'content', 'index.mdx'), 'utf8')
    expect(landing).toContain(`\n${definition}\n`)
  })

  it('keeps the free-plan pricing claim under the hero install box', () => {
    expect(LANDING_HERO.reassure).toMatch(/50 diagnoses/i)
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

  it('keeps a clear closing question and a tracked solo CTA to console signup', () => {
    expect(LANDING_OPERATOR.question.length).toBeGreaterThan(0)
    expect(LANDING_OPERATOR.soloCta).toBe('Start free →')
    expect(LANDING_OPERATOR.soloHref).toBe(`${ADMIN_DEMO_BASE}/signup?src=landing-closing`)
    expect(LANDING_OPERATOR.soloCtaId).toBe('landing-closing')
    expect(LANDING_OPERATOR.teamHref).toContain('github.com/kensaurus/mushi-mushi')
  })

  it('keeps the funnel ids on the hero links: console signup, Cursor, npx and other editors', () => {
    const { console: signup, cursor, npx, more } = LANDING_HERO_START
    // `landing-hero` stays on signup so the funnel keeps its history.
    expect(signup.id).toBe('landing-hero')
    expect(signup.href).toBe(`${ADMIN_DEMO_BASE}/signup?src=landing-hero`)
    expect(cursor.id).toBe('landing-hero-cursor')
    expect(npx.cmd).toBe('npx mushi-mushi')
    expect(more.href).toBe('/connect')
    expect(new Set([signup.id, cursor.id, npx.id, more.id]).size).toBe(4)
  })

  it('installs from the hero: pick Claude Code, Cursor or another editor, then three steps with one prompt', () => {
    expect(LANDING_INSTALL.tabs.map((t) => t.id)).toEqual(['claude-code', 'cursor', 'other'])
    for (const tab of LANDING_INSTALL.tabs) expect(tab.connect.length).toBeGreaterThan(0)
    // ADR 0027's cycle: connect, a report comes in, a fix you review.
    expect(Object.values(LANDING_INSTALL.steps)).toEqual(['Connect your editor', 'Paste this prompt', 'Fix a real bug'])
    expect(LANDING_INSTALL.fixCheck).toMatch(/You review the change/)
    // The prompt has the AI run the wizard non-interactively (an agent shell
    // cannot answer prompts) and send a test report it can show.
    expect(LANDING_SETUP_PROMPT).toContain('npx mushi-mushi --yes')
    expect(LANDING_SETUP_PROMPT).toContain('npx mushi-mushi test')
    expect(LANDING_FIX_PROMPT).toMatch(/latest Mushi report/)
    const hero = readFileSync(join(__dirname, '..', 'components', 'landing', 'CinematicEditorialHero.tsx'), 'utf8')
    expect(hero).toContain('<LandingInstallStrip />')
    const landing = readFileSync(join(__dirname, '..', 'content', 'index.mdx'), 'utf8')
    // The install lives in the hero only; the pipeline picture comes right after it.
    expect(landing).not.toContain('<LandingInstallStrip')
    expect(landing.indexOf('<LoopPipeline')).toBeGreaterThan(landing.indexOf('<CinematicEditorialHero'))
    expect(landing.indexOf('<LoopPipeline')).toBeLessThan(landing.indexOf('<OssTrustStrip'))
  })

  it('keeps the hero lead on the solo-builder positioning against Sentry', () => {
    expect(LANDING_HERO.lead).toMatch(/solo builders/i)
    expect(LANDING_HERO.lead).toMatch(/Sentry/)
  })

  it('tags the console card as a tracked CTA with a src param', () => {
    const console = LANDING_WHERE_TO_START.find((c) => c.ctaId === 'landing-console')
    expect(console?.href).toBe(`${ADMIN_DEMO_BASE}/onboarding?src=landing-console`)
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
    expect(LANDING_TRUST_LINKS.some((t) => {
      try { return new URL(t.href).hostname === 'github.com' } catch { return false }
    })).toBe(true)
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
