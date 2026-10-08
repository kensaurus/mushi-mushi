// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { quoteArg } from './agents.js'
import { buildPacket, findDesignFiles } from './packet.js'
import { appEnv, scrubbedEnv } from './proc.js'
import type { Surface } from './types.js'

const surface: Surface = {
  key: 'settings-abc123',
  kind: 'tab',
  path: '/settings',
  steps: [{ action: 'click', selector: 'role=tab[name="AI keys"]', label: 'AI keys' }],
  label: 'Settings › AI keys',
  domHash: 'x',
}

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('buildPacket', () => {
  it('names the screen, its screenshots, measured problems, tokens and guardrails', () => {
    const text = buildPacket({
      surface,
      iteration: 2,
      shots: { desktop: '.mushi-ux/desktop.png', mobile: '.mushi-ux/mobile.png' },
      probes: {
        mobile: {
          axe: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 2, targets: ['.hint'] }],
          overflowX: true,
          smallTargets: 3,
          consoleErrors: [],
          cls: 0,
        },
      },
      designFiles: ['apps/admin/src/styles/theme-tokens.css'],
      skillText: null,
      previousRejection: 'Rolled back: mobile: the page now scrolls sideways.',
    })
    expect(text).toContain('# UX pass — Settings › AI keys')
    expect(text).toContain('then click "AI keys"')
    expect(text).toContain('- mobile: .mushi-ux/mobile.png')
    expect(text).toContain('[mobile] color-contrast (serious, 2 nodes)')
    expect(text).toContain('scrolls sideways')
    expect(text).toContain('3 tap target(s)')
    expect(text).toContain('apps/admin/src/styles/theme-tokens.css')
    expect(text).toContain('Your previous attempt was rolled back')
    expect(text).toContain('Do not change data fetching')
  })

  it('caps a huge skill text', () => {
    const text = buildPacket({
      surface,
      iteration: 1,
      shots: {},
      probes: {},
      designFiles: [],
      skillText: 'x'.repeat(100_000),
      previousRejection: null,
    })
    // The packet cap (24k chars) keeps it usable by short-context models.
    expect(text.length).toBeLessThanOrEqual(24_000)
  })
})

describe('findDesignFiles', () => {
  it('finds token CSS, tailwind config and token json, skipping node_modules', () => {
    dir = mkdtempSync(join(tmpdir(), 'mushi-ux-design-'))
    mkdirSync(join(dir, 'src', 'styles'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'lib'), { recursive: true })
    writeFileSync(join(dir, 'src', 'styles', 'theme.css'), '@theme { --color-brand: oklch(0.6 0.2 260); }')
    writeFileSync(join(dir, 'src', 'styles', 'page.css'), '.a { color: red }')
    writeFileSync(join(dir, 'tailwind.config.ts'), 'export default {}')
    writeFileSync(join(dir, 'design.tokens.json'), '{}')
    writeFileSync(join(dir, 'node_modules', 'lib', 'theme.css'), '@theme {}')
    expect(findDesignFiles(dir).sort()).toEqual(['design.tokens.json', 'src/styles/theme.css', 'tailwind.config.ts'])
  })
})

describe('quoteArg', () => {
  it('leaves plain tokens alone and quotes model specs with shell characters', () => {
    expect(quoteArg('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(quoteArg('grok-4.7?reasoning_effort=xhigh&context=500k', 'win32')).toBe(
      '"grok-4.7?reasoning_effort=xhigh&context=500k"',
    )
    expect(quoteArg("it's here", 'linux')).toBe(`'it'\\''s here'`)
  })
})

describe('scrubbedEnv', () => {
  it('drops credentials except the ones the agent needs', () => {
    const env = scrubbedEnv(['ANTHROPIC_API_KEY'], {
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'a',
      OPENAI_API_KEY: 'o',
      MUSHI_API_KEY: 'm',
      SUPABASE_URL: 's',
      GITHUB_TOKEN: 'g',
      DB_PASSWORD: 'p',
      HOME: '/home/x',
    })
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'a', HOME: '/home/x' })
  })
})

describe('appEnv', () => {
  it('keeps the app variables and drops the tool credentials', () => {
    const env = appEnv({
      PATH: '/bin',
      VITE_SUPABASE_ANON_KEY: 'public',
      DATABASE_URL: 'postgres://local',
      CURSOR_API_KEY: 'c',
      ANTHROPIC_API_KEY: 'a',
      GITHUB_TOKEN: 'g',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc',
      MUSHI_PROJECT_ID: 'p',
    })
    expect(env).toEqual({ PATH: '/bin', VITE_SUPABASE_ANON_KEY: 'public', DATABASE_URL: 'postgres://local' })
  })
})

describe('steps mode', () => {
  it('reads a plan from a PLAN.md or a reply, whatever the list style', async () => {
    const { parsePlan } = await import('./packet.js')
    const text = 'Here is the plan:\n1. Raise the review button to 44 px tall in words-toolbar.tsx\n- [ ] **Shorten** the empty-state copy in words-content.tsx\n* ok\n- Shorten the empty-state copy in words-content.tsx\n2) Move the add-word action into the header row'
    expect(parsePlan(text)).toEqual([
      'Raise the review button to 44 px tall in words-toolbar.tsx',
      'Shorten the empty-state copy in words-content.tsx',
      'Move the add-word action into the header row',
    ])
    expect(parsePlan(text, 2)).toHaveLength(2)
    expect(parsePlan('No list here, the screen is fine.')).toEqual([])
    expect(parsePlan('- The Continue bar hides “School &amp; Study” on mobile')).toEqual(['The Continue bar hides “School & Study” on mobile'])
  })

  it('shortens a long step at a word, never inside a `code` span', async () => {
    const { cutAtWord, parsePlan } = await import('./packet.js')
    expect(cutAtWord('short enough', 40)).toBe('short enough')
    expect(cutAtWord('increase the padding so the last tile clears the bar', 30)).toBe('increase the padding so the…')
    expect(cutAtWord('increase padding in `FLOW_SCROLL_PADDING_BOTTOM` now', 40)).toBe('increase padding in…')
    const long = `- ${'word '.repeat(80)}end`
    const [step] = parsePlan(long)
    expect(step.length).toBeLessThanOrEqual(280)
    expect(step.endsWith('word…')).toBe(true)
  })

  it('briefs one step at a time, and plans without editing', async () => {
    const { buildPacket, buildPlanPacket } = await import('./packet.js')
    const base = { surface: { key: 'home', kind: 'page' as const, path: '/', steps: [], label: 'Home', domHash: 'h' }, shots: { mobile: '.mushi-ux/mobile.png' }, probes: {}, designFiles: [], skillText: null, timeBudgetMin: 8, entryFiles: ['app/page.tsx'] }
    const plan = buildPlanPacket(base, 4)
    expect(plan).toContain('# UX plan — Home')
    expect(plan).toContain('List 2 to 4 small, separate improvements')
    expect(plan).toContain('Do not edit any other file')
    const step = buildPacket({ ...base, iteration: 2, previousRejection: null, step: { text: 'Shorten the hero copy', index: 2, total: 3, done: ['Raise the CTA'] } })
    expect(step).toContain('## This step (2 of 3)\nShorten the hero copy')
    expect(step).toContain('Already done in earlier steps: "Raise the CTA"')
    expect(step).toContain('touching at most 3 files')
  })
})

describe('time and scope in the packet', () => {
  it('tells the agent its time limit and keeps an app-wide skill to this one screen', async () => {
    const { buildPacket } = await import('./packet.js')
    const out = buildPacket({
      surface: { key: 'home', kind: 'page', path: '/', steps: [], label: 'Home', domHash: 'h' },
      iteration: 1,
      shots: { mobile: '.mushi-ux/mobile.png' },
      probes: {},
      designFiles: [],
      skillText: '# enhance-mobile-native-feel\nRun one coherent pass over the whole app.',
      previousRejection: null,
      timeBudgetMin: 20,
      entryFiles: ['app/page.tsx', 'app/_components/hero.tsx'],
    })
    expect(out).toContain('You have 20 minutes')
    expect(out).toContain('first edit within 7 minutes')
    expect(out).toContain('Skip its whole-app steps')
    // The files that render the screen come before the screenshots, so the agent starts there.
    expect(out.indexOf('## Start here')).toBeGreaterThan(-1)
    expect(out.indexOf('## Start here')).toBeLessThan(out.indexOf('## Screenshots'))
    expect(out).toContain('- app/_components/hero.tsx')
    expect(out).toContain('Do not read or change node_modules')
  })
})
