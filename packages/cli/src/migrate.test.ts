/**
 * FILE: packages/cli/src/migrate.test.ts
 * PURPOSE: Pin the detection paths for `mushi migrate`. Each competitor SDK
 *          and each in-transition shape gets its own test so a future
 *          refactor of the catalog can't silently drop a path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  detectMigrations,
  depsFromPackageJson,
  type MigrateGuide,
  runMigrate,
} from './migrate.js'

function makeTmp(): string {
  const dir = join(tmpdir(), `mushi-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writePkg(dir: string, deps: Record<string, string> = {}, devDeps: Record<string, string> = {}) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp', dependencies: deps, devDependencies: devDeps }),
  )
}

describe('detectMigrations — competitor SDK paths', () => {
  it('detects Instabug (legacy package name)', () => {
    const matches = detectMigrations(new Set(['instabug-reactnative']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['instabug-to-mushi'])
  })

  it('detects Luciq (post-rebrand package name)', () => {
    const matches = detectMigrations(new Set(['luciq-reactnative-sdk']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['instabug-to-mushi'])
  })

  it('detects @instabug/web', () => {
    const matches = detectMigrations(new Set(['@instabug/web']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['instabug-to-mushi'])
  })

  it('detects Shake (RN community fork)', () => {
    const matches = detectMigrations(new Set(['@shakebugs/react-native-shake']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['shake-to-mushi'])
  })

  it('detects LogRocket', () => {
    const matches = detectMigrations(new Set(['logrocket']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['logrocket-feedback-to-mushi'])
  })

  it('detects BugHerd', () => {
    const matches = detectMigrations(new Set(['bugherd-pubsub']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['bugherd-to-mushi'])
  })

  it('detects Pendo (browser package)', () => {
    const matches = detectMigrations(new Set(['pendo-io-browser']))
    expect(matches.map((m) => m.guide.slug)).toEqual(['pendo-feedback-to-mushi'])
  })

  it('returns no match for an unrelated bug-tracking dep (Sentry stays where it is)', () => {
    expect(detectMigrations(new Set(['@sentry/react']))).toEqual([])
  })
})

describe('detectMigrations — in-transition / legacy shapes', () => {
  it('detects Capacitor + RN coexistence (mid-port to RN)', () => {
    const matches = detectMigrations(new Set(['@capacitor/core', 'react-native']))
    expect(matches.map((m) => m.guide.slug)).toContain('capacitor-to-react-native')
  })

  it('detects Cordova', () => {
    const matches = detectMigrations(new Set(['cordova']))
    expect(matches.map((m) => m.guide.slug)).toContain('cordova-to-capacitor')
  })

  it('detects Cordova via cordova-ios alone (no top-level cordova dep)', () => {
    const matches = detectMigrations(new Set(['cordova-ios']))
    expect(matches.map((m) => m.guide.slug)).toContain('cordova-to-capacitor')
  })

  it('detects Create React App (react-scripts)', () => {
    const matches = detectMigrations(new Set(['react-scripts']))
    expect(matches.map((m) => m.guide.slug)).toContain('cra-to-vite')
  })

  it('Capacitor alone (without RN) does NOT suggest the Cap → RN guide', () => {
    /* Cap-only is a happy state; we don't push every Capacitor user to migrate. */
    const matches = detectMigrations(new Set(['@capacitor/core']))
    expect(matches.map((m) => m.guide.slug)).not.toContain('capacitor-to-react-native')
  })
})

describe('detectMigrations — multiple matches', () => {
  it('returns BOTH a competitor and an in-transition guide when both apply', () => {
    /* A real-world case: a Capacitor app that's mid-port to RN and used to
     * have Instabug. Both suggestions should surface so the team can pick. */
    const matches = detectMigrations(
      new Set(['@capacitor/core', 'react-native', 'instabug-reactnative']),
    )
    const slugs = matches.map((m) => m.guide.slug)
    expect(slugs).toContain('capacitor-to-react-native')
    expect(slugs).toContain('instabug-to-mushi')
  })
})

describe('detectMigrations — only published guides surface', () => {
  /* These tests pin a safety property: the CLI must never suggest a guide
   * whose docs page isn't live yet (status: 'draft'). The previous version
   * of these tests was vacuous — it scanned MIGRATE_CATALOG for draft
   * entries with a `match` function, but every prod entry happens to be
   * published, so the assertion loop never ran. A regression that flipped
   * the filter to `g.status !== 'published'` would have shipped silently.
   *
   * The fix: drive `detectMigrations` with a SYNTHETIC catalog (via the
   * optional second arg) so the test asserts the predicate's behavior
   * directly, independent of which guides happen to be in the real
   * catalog right now.
   */

  const ANY_DEP = new Set(['anything'])
  /** Helper — a fake guide whose `match` always returns true. If the
   *  filter is wrong, this guide WILL surface; if right, it won't. */
  const fakeGuide = (overrides: Partial<MigrateGuide>): MigrateGuide => ({
    slug: 'fake',
    title: 'Fake',
    summary: 'Fake summary',
    category: 'competitor',
    status: 'published',
    match: () => true,
    ...overrides,
  })

  it('positive control: a published guide whose match() returns true DOES surface', () => {
    const guide = fakeGuide({ slug: 'published-fake', status: 'published' })
    const matches = detectMigrations(ANY_DEP, [guide])
    expect(matches.map((m) => m.guide.slug)).toEqual(['published-fake'])
  })

  it('negative control: a draft guide whose match() returns true is NEVER surfaced', () => {
    /* This is the actual safety property. If anyone flips the predicate
     * to `g.status !== 'published'` or removes the status check, this
     * fails immediately — the test no longer has a vacuous escape. */
    const guide = fakeGuide({ slug: 'draft-fake', status: 'draft' })
    const matches = detectMigrations(ANY_DEP, [guide])
    expect(matches).toEqual([])
  })

  it('mixed catalog: only the published entries surface', () => {
    const catalog: MigrateGuide[] = [
      fakeGuide({ slug: 'a-published', status: 'published' }),
      fakeGuide({ slug: 'b-draft', status: 'draft' }),
      fakeGuide({ slug: 'c-published', status: 'published' }),
    ]
    const matches = detectMigrations(ANY_DEP, catalog)
    expect(matches.map((m) => m.guide.slug)).toEqual(['a-published', 'c-published'])
  })

  it('a guide with no match() is filtered out even when published', () => {
    const guide = fakeGuide({ slug: 'no-matcher', status: 'published', match: undefined })
    expect(detectMigrations(ANY_DEP, [guide])).toEqual([])
  })

  it('the real MIGRATE_CATALOG never surfaces a draft for a kitchen-sink deps set', () => {
    /* Regression guard against the real catalog. Builds a deps set that
     * triggers EVERY known matcher we care about (every competitor SDK
     * + every in-transition shape) and asserts that nothing returned by
     * the real `detectMigrations` is a draft. If a future contributor
     * adds a draft guide whose match() fires on any of these deps, this
     * fails — preventing a 404-link suggestion in `mushi migrate`. */
    const kitchenSink = new Set([
      // Competitors
      'instabug-reactnative',
      'luciq-reactnative-sdk',
      '@instabug/web',
      'instabug',
      '@shakebugs/react-native-shake',
      '@shakebugs/shake-react-native',
      '@softnoesis/shakebug-js',
      'logrocket',
      'logrocket-react',
      'bugherd-pubsub',
      'pendo-io-browser',
      '@pendo/web',
      // In-transition shapes (Capacitor + RN, CRA, etc.)
      '@capacitor/core',
      '@capacitor/ios',
      '@capacitor/android',
      'react-native',
      'react-scripts',
      'vue',
      'next',
    ])
    const matches = detectMigrations(kitchenSink)
    /* Sanity: at least one match must fire so the assertion below is
     * non-vacuous. If this hits zero, the kitchen-sink set has drifted
     * from the catalog — fix the set, don't soften the assertion. */
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      expect(m.guide.status).toBe('published')
    }
  })
})

describe('depsFromPackageJson', () => {
  it('returns empty set for null', () => {
    expect(depsFromPackageJson(null).size).toBe(0)
  })

  it('merges deps + devDeps + peerDeps', () => {
    const deps = depsFromPackageJson({
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^5.0.0' },
      peerDependencies: { 'react-dom': '^19.0.0' },
    })
    expect(deps.has('react')).toBe(true)
    expect(deps.has('vite')).toBe(true)
    expect(deps.has('react-dom')).toBe(true)
  })

  it('survives a package.json with no deps blocks at all', () => {
    expect(depsFromPackageJson({}).size).toBe(0)
  })
})

describe('runMigrate (end-to-end with tmp package.json)', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTmp()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits a "no package.json" message when run outside a project', () => {
    const lines: string[] = []
    const result = runMigrate({ cwd: dir, log: (s) => lines.push(s) })
    expect(result.matches).toEqual([])
    expect(lines.some((l) => l.includes('No package.json'))).toBe(true)
  })

  it('lists matches in pretty mode', () => {
    writePkg(dir, { 'instabug-reactnative': '^14.0.0' })
    const lines: string[] = []
    const result = runMigrate({ cwd: dir, log: (s) => lines.push(s) })
    expect(result.matches.map((m) => m.guide.slug)).toEqual(['instabug-to-mushi'])
    const out = lines.join('\n')
    expect(out).toContain('Instabug')
    expect(out).toContain('https://docs.mushimushi.dev/migrations/instabug-to-mushi')
  })

  it('emits machine-readable JSON in --json mode', () => {
    writePkg(dir, { 'react-scripts': '^5.0.0' })
    const lines: string[] = []
    runMigrate({ cwd: dir, json: true, log: (s) => lines.push(s) })
    const parsed = JSON.parse(lines.join('\n'))
    expect(parsed.ok).toBe(true)
    expect(parsed.matches).toHaveLength(1)
    expect(parsed.matches[0].slug).toBe('cra-to-vite')
    expect(parsed.matches[0].url).toBe('https://docs.mushimushi.dev/migrations/cra-to-vite')
  })

  it('emits "no suggestions" for an unrelated package.json', () => {
    writePkg(dir, { lodash: '^4.0.0' })
    const lines: string[] = []
    const result = runMigrate({ cwd: dir, log: (s) => lines.push(s) })
    expect(result.matches).toEqual([])
    expect(lines.some((l) => l.includes('No migrations suggested'))).toBe(true)
  })

  it('--json output for an unrelated project still parses and has empty matches', () => {
    writePkg(dir, { lodash: '^4.0.0' })
    const lines: string[] = []
    runMigrate({ cwd: dir, json: true, log: (s) => lines.push(s) })
    const parsed = JSON.parse(lines.join('\n'))
    expect(parsed.ok).toBe(true)
    expect(parsed.matches).toEqual([])
  })
})
