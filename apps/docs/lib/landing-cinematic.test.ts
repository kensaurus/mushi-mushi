/**
 * Smoke: cinematic landing still ships north-star copy from the SSOT.
 * Guards against accidental hero/CTA/nav drift when motion components wrap prose.
 *
 * ADR 0056 (2026-11-11) changed the locked hero pair, the install tab order and
 * the section order: the free check's address box is the one primary action,
 * the install box (Lovable or Bolt first) the one secondary action. The tests
 * below hold that shape; changing it again needs a superseding ADR.
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
  LANDING_CHECK,
  LANDING_HOW_STEPS,
  normalizeCheckUrl,
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
  LANDING_FAQ,
  LANDING_FAQ_GROUPS,
} from './landing-copy'
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'
import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'
import { urlFromSearch } from './production-check'
import { FEATURES, NEED_LABELS } from '../components/FeatureTour'
import { LANDING_FEATURE_IDS } from '../components/landing/LandingFeatures'

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

  it('keeps the free-plan claim and the setup facts in the hero facts row (ADR 0056)', () => {
    // Free since 2026-10-28: one app, 100 diagnoses a month (docs/plan-pricing.md).
    expect(LANDING_HERO.facts[0]).toMatch(/free for one app: 100 diagnoses/i)
    expect(LANDING_HERO.facts).toContain('About 5 minutes to set up')
    expect(LANDING_HERO.facts).toContain('No coding needed with Lovable or Bolt')
    const hero = read('components', 'landing', 'CinematicEditorialHero.tsx')
    expect(hero).toContain('LANDING_HERO.facts')
  })

  it('sells the pricing strip by apps watched, with no retired plan names', () => {
    expect(LANDING_PRICING_STRIP.lead).toMatch(/number of apps/)
    expect(read('components', 'landing', 'PricingStrip.tsx')).toContain('apps')
    expect(JSON.stringify(LANDING_FAQ)).not.toMatch(/\bIndie\b|50 diagnoses/)
  })

  it('explains how it works in four steps, each with what you do and what Mushi Mushi does (ADR 0056)', () => {
    expect(LANDING_HOW_STEPS.map((p) => p.name)).toEqual([
      'Add the button',
      'A customer reports a problem',
      'Read what went wrong',
      'Let your AI fix it',
    ])
    expect(LANDING_HOW_STEPS.map((p) => p.glyph)).toEqual(['install', 'report', 'diagnose', 'ship'])
    for (const step of LANDING_HOW_STEPS) {
      expect(step.you.length).toBeGreaterThan(0)
      expect(step.role.length).toBeGreaterThan(0)
    }
    expect(read('components', 'landing', 'DiagnosisScrollStage.tsx')).toContain('LANDING_HOW_STEPS.map')
    // The docs sub-pages' <Pillars> keep the three-card version.
    expect(LANDING_PILLARS.map((p) => p.name)).toEqual(['A user reports it', 'Mushi Mushi explains it', 'Your AI fixes it'])
  })

  it('shows three extra checks, each tagged with what it needs, none promised as free (ADR 0056)', () => {
    expect(LANDING_FEATURE_IDS).toHaveLength(3)
    const shown = LANDING_FEATURE_IDS.map((id) => FEATURES.find((f) => f.id === id))
    expect(shown.every(Boolean)).toBe(true)
    // One of each need: an account to connect, a paid key, a computer of yours.
    expect(new Set(shown.map((f) => f?.kind))).toEqual(new Set(['connect', 'paid-key', 'computer']))
    const cards = read('components', 'landing', 'LandingFeatures.tsx')
    expect(cards).toContain('NEED_LABELS[f.kind]')
    expect(Object.values(NEED_LABELS).join(' ')).not.toMatch(/\bfree\b/i)
    expect(cards.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bfree\b/i)
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

  it('installs from the hero: Lovable or Bolt first, then Claude Code, Cursor or another editor, then three steps (ADR 0056)', () => {
    expect(LANDING_INSTALL.tabs.map((t) => t.id)).toEqual(['lovable', 'claude-code', 'cursor', 'other'])
    // The first tab is the one open on load.
    expect(read('components', 'landing', 'LandingInstallStrip.tsx')).toContain('useState<TabId>(LANDING_INSTALL.tabs[0].id)')
    for (const tab of LANDING_INSTALL.tabs) expect(tab.connect.length).toBeGreaterThan(0)
    // ADR 0027's cycle: connect, a report comes in, a fix you review.
    expect(Object.values(LANDING_INSTALL.steps)).toEqual(['Connect your editor', 'Paste this prompt', 'Fix a real bug'])
    expect(LANDING_INSTALL.fixCheck).toMatch(/You review the change/)
    // The prompt has the AI run the wizard non-interactively (an agent shell
    // cannot answer prompts) and send a test report it can show.
    expect(LANDING_SETUP_PROMPT).toContain('npx mushi-mushi --yes')
    expect(LANDING_SETUP_PROMPT).toContain('npx mushi-mushi test')
    expect(LANDING_FIX_PROMPT).toMatch(/latest Mushi Mushi report/)
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
    // One placeholder name everywhere: the one the console's Script tag tab prints.
    expect(LANDING_INSTALL_LOVABLE.prompt).toContain('data-key="YOUR_SDK_KEY"')
    expect(read('..', 'admin', 'src', 'lib', 'sdkSnippets.ts')).toContain("const API_KEY_PLACEHOLDER = 'YOUR_SDK_KEY'")
    const guide = read('content', 'quickstart', 'lovable-bolt.mdx')
    expect(guide).toContain('data-project="YOUR_PROJECT_ID" data-key="YOUR_SDK_KEY"')
    expect(`${guide}${JSON.stringify(LANDING_INSTALL_LOVABLE)}`).not.toContain('YOUR_API_KEY')
    // The landing line is an example, and its button says so.
    expect(LANDING_INSTALL_LOVABLE.copyLabel).toBe('Copy example')
    expect(LANDING_INSTALL_LOVABLE.setupLead).toBe('This is an example. Your real line is waiting after sign-up.')
    expect(read('components', 'landing', 'LandingInstallStrip.tsx')).toContain('L.copyLabel')
    // No terminal step: Lovable and Bolt have none.
    expect(LANDING_INSTALL_LOVABLE.prompt).not.toMatch(/\bnpx\b|\bnpm (?:i|install)\b|terminal/)
    expect(LANDING_INSTALL_LOVABLE.guide.href).toBe('/quickstart/lovable-bolt')
    expect(existsSync(join(DOCS, 'content', 'quickstart', 'lovable-bolt.mdx'))).toBe(true)
    // The connector guide is launch-connector's page (feat/launch-connector).
    expect(LANDING_INSTALL_LOVABLE.connector.href).toBe('/quickstart/lovable-mcp')
    // Its first step is the console signup, which keeps the `landing-hero` funnel id.
    expect(read('components', 'landing', 'LandingInstallStrip.tsx')).toContain('LANDING_HERO_START.console.href')
  })

  it('leads with the plain subline from the brand ladder: both ways in, then what every bug gets (ADR 0056)', () => {
    expect(LANDING_HERO.lead).toBe(MUSHI_TAGLINE_V2.subHero)
    expect(LANDING_HERO.lead).toMatch(/tap a button/)
    expect(LANDING_HERO.lead).toMatch(/checks your live site/)
    expect(LANDING_HERO.lead).toMatch(/plain-English/)
  })

  it('has one primary and one secondary action in the hero: the free check box, then the install box (ADR 0056)', () => {
    const hero = read('components', 'landing', 'CinematicEditorialHero.tsx')
    // Exactly one of each, the check box first.
    expect(hero.match(/<LandingCheckBox \/>/g)).toHaveLength(1)
    expect(hero.match(/<LandingInstallStrip \/>/g)).toHaveLength(1)
    expect(hero.indexOf('<LandingCheckBox />')).toBeLessThan(hero.indexOf('<LandingInstallStrip />'))
    // No links of the hero's own compete with the two actions.
    expect(hero).not.toMatch(/<Link\s/)
    expect(hero).not.toMatch(/<a\s/)
    expect(hero).not.toContain('LANDING_HERO_START')
    // The check box: "Check your live app free", no sign-up, started on submit
    // with the hero's funnel id, then the report opens on /check.
    const box = read('components', 'landing', 'LandingCheckBox.tsx')
    expect(LANDING_CHECK.heading).toBe('Check your live app free')
    expect(LANDING_CHECK.note).toMatch(/No sign-up, nothing to install/)
    expect(LANDING_CHECK.src).toBe('landing-hero')
    expect(LANDING_CHECK.id).toBe('landing-check')
    expect(box).toContain('startCheck({ url, src: LANDING_CHECK.src })')
    expect(box).toContain('data-mushi-cta={LANDING_CHECK.id}')
    expect(box).toContain('/check?id=')
    // One form, one button; no link out of the box.
    expect(box.match(/<form\s/g)).toHaveLength(1)
    expect(box.match(/<button\s/g)).toHaveLength(1)
    expect(box).not.toMatch(/<Link\s|<a\s/)
    // A text input: type="url" would reject "my-app.com".
    expect(box).toContain('inputMode="url"')
    expect(box).not.toContain('type="url"')
    expect(existsSync(join(DOCS, 'app', 'check', 'page.tsx'))).toBe(true)
    // The sample stays one scroll down, in How it works.
    expect(read('components', 'landing', 'DiagnosisScrollStage.tsx')).toContain('LANDING_SAMPLE_LINK.href')
    expect(LANDING_SAMPLE_LINK.href).toBe('/demo/diagnosis')
    expect(LANDING_SAMPLE_LINK.label).toMatch(/sample/i)
    expect(existsSync(join(DOCS, 'content', 'demo', 'diagnosis.mdx'))).toBe(true)
  })

  it('brings Field Kenji into the hero as decoration that shows the job: the mark in the eyebrow, the magnify pose on desktop (owner, 2026-11-14)', () => {
    const hero = read('components', 'landing', 'CinematicEditorialHero.tsx')
    // The mark (Kenji + Mushi-chan under his magnifier) replaced the dot stamp;
    // both images are decorative.
    expect(hero).toContain("from '../../assets/brand/kenji-mark.webp'")
    expect(hero).not.toContain('docs-editorial-hero__stamp')
    expect(hero).toMatch(/alt: '',\s*'aria-hidden': true/)
    // The figure only loads at 1024px+; phones get a blank pixel, so the
    // address box stays above the fold and nothing heavy downloads.
    expect(hero).toContain("from '../../assets/mascot/mascot-magnify.webp'")
    expect(hero).toContain('<div className="landing-hero-guide" data-guides={HERO_GUIDES.length} aria-hidden="true">')
    // The slot is ready for a pair of guides.
    expect(read('app', 'globals.css')).toContain(".landing-hero-guide[data-guides='2'] {")
    expect(hero).toContain('media="(min-width: 1024px)"')
    expect(hero).toMatch(/<img src=\{BLANK_PIXEL\} alt=""/)
    const css = read('app', 'globals.css')
    const guide = css.slice(css.indexOf('.landing-hero-guide {'))
    expect(guide).toMatch(/^\.landing-hero-guide \{\s*display: none;/)
    expect(guide).toContain('pointer-events: none')
    // Idle motion only when the reader allows it, and it stops after three cycles.
    expect(css).toMatch(/@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{\s*\.landing-hero-guide \{/)
    expect(css).toMatch(/\.landing-hero-guide img \{\s*animation: docs-guide-idle [^;]* 3;/)
  })

  it('groups the FAQ, no coding first, and answers "what does it collect" and "how do I remove it"', () => {
    expect(LANDING_FAQ_GROUPS.map((g) => g.label)).toEqual(['No coding', 'Developers'])
    for (const item of LANDING_FAQ) expect(['no-code', 'developers']).toContain(item.group)
    const noCode = LANDING_FAQ.filter((i) => i.group === 'no-code').map((i) => i.q)
    expect(noCode[0]).toBe('Do I need to know how to code?')
    const collect = LANDING_FAQ.find((i) => i.q === 'What does it collect from my users?')
    const remove = LANDING_FAQ.find((i) => i.q === 'How do I remove it?')
    expect(collect?.group).toBe('no-code')
    expect(remove?.group).toBe('no-code')
    // Each links the guide section that has the detail, and that section exists.
    const guide = read('content', 'quickstart', 'lovable-bolt.mdx')
    expect(collect?.more?.href).toBe('/quickstart/lovable-bolt#what-it-collects-from-your-users')
    expect(remove?.more?.href).toBe('/quickstart/lovable-bolt#how-to-remove-it')
    expect(guide).toContain('## What it collects from your users')
    expect(guide).toContain('## How to remove it')
    // True of the code: Free keeps reports 14 days (_shared/plans.ts), and the
    // screenshot blacks out password and card boxes (ALWAYS_REDACT_SELECTORS).
    expect(collect?.a).toMatch(/deleted after 14 days/)
    expect(read('..', '..', 'packages', 'server', 'supabase', 'functions', '_shared', 'plans.ts')).toMatch(/max_projects: 1,\s+retention_days: 14,/)
    expect(read('..', '..', 'packages', 'web', 'src', 'capture', 'screenshot.ts')).toContain('input[type="password"],input[autocomplete^="cc-"]')
    // The structured data is still one flat list of every question, grouped only on screen.
    const faq = read('components', 'landing', 'LandingFaq.tsx')
    expect(faq).toContain('<JsonLd data={faqJsonLd(shown)} />')
    expect(faq).toContain('LANDING_FAQ_GROUPS.flatMap')
    // A no-code reader is not told it only works in a code editor.
    expect(LANDING_WHAT_THIS_IS.boundary).toMatch(/Lovable or Bolt/)
  })

  it('turns what a visitor types into an address /check accepts', () => {
    expect(normalizeCheckUrl('my-app.com')).toBe('https://my-app.com')
    expect(normalizeCheckUrl('  https://my-app.lovable.app/  ')).toBe('https://my-app.lovable.app/')
    expect(normalizeCheckUrl('http://my-app.com')).toBe('http://my-app.com')
    expect(normalizeCheckUrl('')).toBeNull()
    expect(normalizeCheckUrl('not a site')).toBeNull()
    expect(normalizeCheckUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeCheckUrl('ftp://my-app.com')).toBeNull()
    // Whatever it returns, the check page's own parser takes it.
    const url = normalizeCheckUrl('my-app.com') ?? ''
    expect(urlFromSearch(`?url=${encodeURIComponent(url)}`)).toBe(url)
  })

  it('orders the landing: hero, how it works, more than bug reports, what it takes, FAQ, closing (ADR 0056)', () => {
    const landing = read('content', 'index.mdx')
    const order = ['<CinematicEditorialHero', '<DiagnosisScrollStage', '<LandingFeatures', '## What it takes', '<LandingFaq', '<ClosingCta']
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
