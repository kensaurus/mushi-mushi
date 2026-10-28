/**
 * Smoke: cinematic landing still ships north-star copy from the SSOT.
 * Guards against accidental hero/CTA/nav drift when motion components wrap prose.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LANDING_WHAT_THIS_IS,
  LANDING_HERO,
  LANDING_HERO_START,
  LANDING_INSTALL,
  LANDING_INSTALL_LOVABLE,
  LANDING_SAMPLE_LINK,
  LANDING_SETUP_PROMPT,
  LANDING_FIX_PROMPT,
  LANDING_PILLARS,
  LANDING_OPERATOR,
  LANDING_PRICING_STRIP,
  LANDING_WHERE_TO_START,
  LANDING_QUICKSTART_PLATFORMS,
  LANDING_COMPARISON_ROWS,
  LANDING_TRUST_LINKS,
} from './landing-copy'
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'
import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS = join(__dirname, '..')
const read = (...rel: string[]) => readFileSync(join(DOCS, ...rel), 'utf8')

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

  it('explains the one job in three steps: a user reports, Mushi explains, your AI fixes (ADR 0052)', () => {
    expect(LANDING_PILLARS.map((p) => p.name)).toEqual(['A user reports it', 'Mushi explains it', 'Your AI fixes it'])
    expect(LANDING_PILLARS.map((p) => p.glyph)).toEqual(['report', 'diagnose', 'ship'])
  })

  it('keeps a clear closing question and a tracked solo CTA to console signup', () => {
    expect(LANDING_OPERATOR.question.length).toBeGreaterThan(0)
    expect(LANDING_OPERATOR.soloCta).toBe('Start free →')
    expect(LANDING_OPERATOR.soloHref).toBe(`${ADMIN_DEMO_BASE}/signup?src=landing-closing`)
    expect(LANDING_OPERATOR.soloCtaId).toBe('landing-closing')
  })

  it('keeps enterprise plumbing off the landing: no SSO, audit logs or operator docs (ADR 0052)', () => {
    const closing = read('components', 'landing', 'ClosingCta.tsx')
    const landing = read('content', 'index.mdx')
    for (const text of [JSON.stringify(LANDING_OPERATOR), closing, landing]) {
      expect(text).not.toMatch(/single sign-on|SSO|audit log|docs\/operators/)
    }
    expect(LANDING_PRICING_STRIP.tierIds).toEqual(['free', 'indie', 'pro'])
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

  it('installs from the hero: pick Claude Code, Cursor, Lovable or Bolt, or another editor, then three steps', () => {
    expect(LANDING_INSTALL.tabs.map((t) => t.id)).toEqual(['claude-code', 'cursor', 'lovable', 'other'])
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
    // The install lives in the hero only.
    expect(read('content', 'index.mdx')).not.toContain('<LandingInstallStrip')
  })

  it('gives Lovable and Bolt a no-terminal path: a script tag pasted through a prompt', () => {
    const tab = LANDING_INSTALL.tabs.find((t) => t.id === 'lovable')
    expect(tab?.label).toBe('Lovable or Bolt')
    // The same loader URL the script-tag quickstart documents.
    const loaderUrl = LANDING_INSTALL_LOVABLE.prompt.match(/src="([^"]+)"/)?.[1] ?? ''
    expect(loaderUrl).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mushi-mushi\/web@\d+\/dist\/mushi\.loader\.global\.js$/)
    expect(read('content', 'quickstart', 'web.mdx')).toContain(loaderUrl)
    expect(LANDING_INSTALL_LOVABLE.prompt).toContain('data-project="YOUR_PROJECT_ID"')
    expect(LANDING_INSTALL_LOVABLE.prompt).toContain('data-key="YOUR_API_KEY"')
    // No terminal step: Lovable and Bolt have none.
    expect(LANDING_INSTALL_LOVABLE.prompt).not.toMatch(/\bnpx\b|\bnpm (?:i|install)\b|terminal/)
    expect(LANDING_INSTALL_LOVABLE.guide.href).toBe('/quickstart/lovable-bolt')
    expect(existsSync(join(DOCS, 'content', 'quickstart', 'lovable-bolt.mdx'))).toBe(true)
    // The connector guide is launch-connector's page (feat/launch-connector).
    expect(LANDING_INSTALL_LOVABLE.connector.href).toBe('/quickstart/lovable-mcp')
    // Its first step is the console signup, which keeps the `landing-hero` funnel id.
    expect(read('components', 'landing', 'LandingInstallStrip.tsx')).toContain('LANDING_HERO_START.console.href')
  })

  it('leads with one job: a user says it is broken, Mushi says why and hands the fix to the AI', () => {
    expect(LANDING_HERO.lead).toMatch(/user says your app is broken/i)
    expect(LANDING_HERO.lead).toMatch(/plain English/)
    expect(LANDING_HERO.lead).toMatch(/Cursor, Claude Code or Lovable/)
    expect(LANDING_HERO.lead).toMatch(/No Sentry/)
  })

  it('has one primary action and one secondary link in the hero: the install box and the sample diagnosis', () => {
    const hero = read('components', 'landing', 'CinematicEditorialHero.tsx')
    expect(hero.match(/<LandingInstallStrip \/>/g)).toHaveLength(1)
    expect(hero.match(/<Link /g)).toHaveLength(1)
    expect(hero).toContain('LANDING_SAMPLE_LINK.href')
    // No signup, star or other-editor links compete with the install box.
    expect(hero).not.toMatch(/<a\s/)
    expect(hero).not.toContain('LANDING_HERO_START')
    expect(LANDING_SAMPLE_LINK.href).toBe('/demo/diagnosis')
    expect(LANDING_SAMPLE_LINK.label).toMatch(/sample/i)
    expect(existsSync(join(DOCS, 'content', 'demo', 'diagnosis.mdx'))).toBe(true)
  })

  it('orders the landing: hero, how it works, what it takes, FAQ, closing', () => {
    const landing = read('content', 'index.mdx')
    const order = ['<CinematicEditorialHero', '<DiagnosisScrollStage', '## What it takes', '<LandingFaq', '<ClosingCta']
    const at = order.map((s) => landing.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('keeps the other jobs off the landing but one click away (ADR 0052)', () => {
    const landing = read('content', 'index.mdx')
    for (const gone of ['<LoopPipeline', '<MediatorMap', '<WhereToStartGrid', '<QuickstartGrid', '<ComparisonScrub', '<DocsMediaShowcase', 'Spend less on CI', 'voice']) {
      expect(landing).not.toContain(gone)
    }
    // Each moved block lives on a docs page the "More" line links to.
    const homes: Array<[string, string[], string]> = [
      ['/concepts/closed-loop', ['content', 'concepts', 'closed-loop.mdx'], '<LoopPipeline'],
      ['/plugins', ['content', 'plugins', 'index.mdx'], '<MediatorMap'],
      ['/quickstart', ['content', 'quickstart', 'index.mdx'], '<WhereToStartGrid'],
      ['/quickstart', ['content', 'quickstart', 'index.mdx'], '<QuickstartGrid'],
      ['/admin', ['content', 'admin', 'index.mdx'], '<DocsMediaShowcase'],
    ]
    for (const [href, file, block] of homes) {
      expect(landing).toContain(`](${href})`)
      expect(read(...file)).toContain(block)
    }
    expect(read('content', 'admin', 'ci.mdx')).toContain('## Spend less on CI')
    expect(read('content', 'use-cases', 'sentry-alternative.mdx')).toContain('<ComparisonScrub>')
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
