/**
 * mushi.recipe.json parsing, the design-rule defaults, the write allowlist
 * (Plan 019 §2 `change`, §6) and the design-change edit builders.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVENTORY_PATH,
  effectiveDesignRules,
  inventoryPathOf,
  isWritablePath,
  parseRecipeManifest,
  RECIPE_MANIFEST_MAX_BYTES,
  type RecipeManifest,
} from '../../supabase/functions/_shared/recipe-schema.ts'
import { matchGlob, normalizeRepoPath } from '../../supabase/functions/_shared/recipe-glob.ts'
import { applyRulesEdit, applyTokenEdits, buildTokenValue, findTokenNode, unifiedDiff } from '../../supabase/functions/_shared/design-change.ts'
import { directionOf, judgingSet, planTokenSets } from '../../supabase/functions/_shared/design-sets.ts'
import { parseCssScopes } from '../../supabase/functions/_shared/css-scopes.ts'

const GLOT = resolve(__dirname, 'fixtures/recipe/glot')
const glotText = readFileSync(resolve(GLOT, 'mushi.recipe.json'), 'utf8')
const extendedText = readFileSync(resolve(__dirname, 'fixtures/recipe/glot-extended.recipe.json'), 'utf8')
const glot = (() => {
  const r = parseRecipeManifest(glotText)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.manifest
})()

describe('parseRecipeManifest', () => {
  it("accepts glot.it's own committed manifest with no issues, and keeps unknown keys", () => {
    const r = parseRecipeManifest(glotText)
    expect(r).toMatchObject({ ok: true, issues: [] })
    if (r.ok) expect((r.manifest as Record<string, unknown>).deploy).toBeDefined()
    const ext = parseRecipeManifest(extendedText)
    expect(ext.ok && (ext.manifest as Record<string, unknown>)['x-fixture-note']).toBeTruthy()
  })
  it('rejects invalid JSON, a wrong version, an oversized file and anything shaped like a secret', () => {
    expect(parseRecipeManifest('{').ok).toBe(false)
    const v2 = parseRecipeManifest(JSON.stringify({ version: 2 }))
    expect(v2.ok ? null : v2.issues[0].code).toBe('MANIFEST_SCHEMA')
    const big = parseRecipeManifest(JSON.stringify({ version: 1, pad: 'x'.repeat(RECIPE_MANIFEST_MAX_BYTES) }))
    expect(big.ok ? null : big.issues[0].code).toBe('MANIFEST_TOO_LARGE')
    const secret = parseRecipeManifest(JSON.stringify({ version: 1, connectors: { stripe: { binding: ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_') } } }))
    expect(secret.ok ? null : secret.issues[0].code).toBe('SECRET_DETECTED')
    const gh = parseRecipeManifest(JSON.stringify({ version: 1, note: ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_') }))
    expect(gh.ok).toBe(false)
  })
  it('flags unsafe token paths and unknown rule ids without rejecting the file', () => {
    const r = parseRecipeManifest(JSON.stringify({ version: 1, design: { tokens: [{ path: '../secrets.json', role: 'source' }], rules: { made_up: { enabled: true } } } }))
    expect(r.ok).toBe(true)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['UNKNOWN_RULE', 'UNSAFE_PATH'])
  })
})

describe('design.directions[] (Plan 019 §2)', () => {
  const withDirs = (dirs: unknown[]) => JSON.stringify({ ...JSON.parse(glotText), design: { ...JSON.parse(glotText).design, directions: dirs } })
  const soi = ['primitive', 'semantic', 'component'].map((n) => `packages/design-tokens/tokens/directions/soi-signpaint/${n}.tokens.json`)
  const pha = soi.map((p) => p.replace('soi-signpaint', 'pha-khram'))

  it("accepts glot's manifest: one active direction equal to the source token paths", () => {
    expect(parseRecipeManifest(glotText)).toMatchObject({ ok: true, issues: [] })
    expect(parseRecipeManifest(withDirs([{ name: 'soi', status: 'active', tokens: [...soi].reverse() }])).ok).toBe(true)
  })
  it('rejects an active direction whose tokens differ from the source paths (directions_active_mismatch)', () => {
    const r = parseRecipeManifest(withDirs([{ name: 'pha', status: 'active', tokens: pha }, { name: 'soi', status: 'inactive', tokens: soi }]))
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toEqual(['directions_active_mismatch'])
    const partial = parseRecipeManifest(withDirs([{ name: 'soi', status: 'active', tokens: soi.slice(0, 2) }]))
    expect(partial.ok ? null : partial.issues[0].code).toBe('directions_active_mismatch')
  })
  it('rejects two active directions, and a duplicate name', () => {
    const two = parseRecipeManifest(withDirs([{ name: 'soi', status: 'active', tokens: soi }, { name: 'pha', status: 'active', tokens: pha }]))
    expect(two.ok ? null : two.issues[0].code).toBe('directions_active_mismatch')
    const dup = parseRecipeManifest(withDirs([{ name: 'soi', status: 'active', tokens: soi }, { name: 'soi', status: 'inactive', tokens: pha }]))
    expect(dup.ok ? null : dup.issues.map((i) => i.code)).toContain('directions_duplicate_name')
  })
  it('allows no active direction (all inactive, comparison only)', () => {
    expect(parseRecipeManifest(withDirs([{ name: 'pha', status: 'inactive', tokens: pha }])).ok).toBe(true)
  })
})

describe('parseCssScopes (light/dark modes are scopes)', () => {
  const css = readFileSync(resolve(GLOT, 'app/styles/globals/theme-soi-signpaint.css'), 'utf8')
  const declared = ['html:root[data-direction="soi-signpaint"]', 'html.dark:root[data-direction="soi-signpaint"]']

  it("reads glot's two declared scopes (light and dark) with no undeclared vars", () => {
    const r = parseCssScopes('theme-soi-signpaint.css', css, declared)
    expect(r.scopes.map((s) => [s.selector, s.kind])).toEqual([
      ['html:root[data-direction="soi-signpaint"]', 'declared'],
      ['html.dark:root[data-direction="soi-signpaint"]', 'declared'],
    ])
    expect(r.scopes[0].vars.find((v) => v.name === '--color-cta')).toMatchObject({ value: '#C42A22', hex: '#C42A22' })
    expect(r.issues.filter((i) => i.code === 'css_vars_in_undeclared_scope')).toEqual([])
  })
  it('vars under an undeclared selector are an info issue, never silence', () => {
    const r = parseCssScopes('theme-soi-signpaint.css', css, [declared[0]])
    expect(r.scopes).toHaveLength(1)
    expect(r.undeclared[0]).toMatchObject({ selector: declared[1] })
    expect(r.issues.find((i) => i.code === 'css_vars_in_undeclared_scope')).toMatchObject({ severity: 'info', file: 'theme-soi-signpaint.css' })
  })
  it(':root and @theme always count; a declared scope with no vars is a warning; comments are ignored', () => {
    const r = parseCssScopes('a.css', ':root { --a: #fff; }\n@theme inline { --color-b: oklch(1 0 0); }\n/* .x { --c: 1px } */\n@media (min-width: 1px) { .card { --d: 2px; } }', ['.missing'])
    expect(r.scopes.map((s) => s.kind)).toEqual(['root', 'theme'])
    expect(r.undeclared).toEqual([{ selector: '.card', count: 1 }])
    expect(r.issues.map((i) => i.code).sort()).toEqual(['css_scope_empty', 'css_vars_in_undeclared_scope'])
  })
})

describe('effectiveDesignRules', () => {
  it('uses Mushi defaults without a manifest (raw elements off)', () => {
    const rules = effectiveDesignRules(null)
    expect(rules.map((r) => [r.id, r.enabled, r.severity, r.fromManifest])).toEqual([
      ['off_token_color', true, 'warn', false],
      ['off_token_font', true, 'warn', false],
      ['off_scale_spacing', true, 'info', false],
      ['off_scale_radius', true, 'info', false],
      ['contrast_below_aa', true, 'error', false],
      ['raw_interactive_element', false, 'info', false],
    ])
  })
  it('layers manifest rules over the defaults', () => {
    const ext = parseRecipeManifest(extendedText)
    if (!ext.ok) throw new Error('extended fixture invalid')
    const raw = effectiveDesignRules(ext.manifest).find((r) => r.id === 'raw_interactive_element')!
    expect(raw).toMatchObject({ enabled: true, fromManifest: true, primitives: { button: 'Button' } })
  })
})

describe('paths and globs', () => {
  it('normalizeRepoPath refuses traversal, absolute, Windows and encoded paths', () => {
    for (const bad of ['../x', 'a/../b', '/etc/passwd', 'C:/x', 'a\\b', 'a/%2e%2e/b', 'a//b', './a', '', 'a/\u0000b']) {
      expect(normalizeRepoPath(bad), bad).toBeNull()
    }
    expect(normalizeRepoPath(' packages/a.json ')).toBe('packages/a.json')
  })
  it('matchGlob handles **, *, ? and braces', () => {
    expect(matchGlob('packages/design-tokens/tokens/directions/a/x.json', 'packages/design-tokens/tokens/**')).toBe(true)
    expect(matchGlob('app/page.tsx', 'app/**/*.{ts,tsx,css}')).toBe(true)
    expect(matchGlob('app/a/b/page.css', 'app/**/*.{ts,tsx,css}')).toBe(true)
    expect(matchGlob('app/page.js', 'app/**/*.{ts,tsx,css}')).toBe(false)
    expect(matchGlob('a/b.ts', '*.ts')).toBe(false)
    expect(matchGlob('ab.ts', 'a?.ts')).toBe(true)
  })
})

describe('isWritablePath — the recipe PR allowlist', () => {
  const tokenFile = 'packages/design-tokens/tokens/directions/pha-khram/semantic.tokens.json'
  const scope = [tokenFile, 'mushi.recipe.json']

  it('allows a role:"source" token file and the manifest, inside change.allowPaths', () => {
    expect(isWritablePath(tokenFile, glot, scope)).toEqual({ ok: true, path: tokenFile })
    expect(isWritablePath('mushi.recipe.json', glot, scope).ok).toBe(true)
  })

  it('refuses every non-token path, even ones change.allowPaths would match', () => {
    const cases: Array<[string, RegExp]> = [
      ['.github/workflows/ci.yml', /workflow/],
      ['packages/x/.github/workflows/x.yml', /workflow/],
      ['pnpm-lock.yaml', /lockfile/],
      ['apps/web/package-lock.json', /lockfile/],
      ['.env', /env files/],
      ['apps/web/.env.production', /env files/],
      ['packages/design-tokens/dtcg/tokens.json', /generated export/],
      ['supabase/migrations/20261002_x.sql', /migration/],
      ['../../etc/passwd', /safe repo-relative/],
      ['packages/design-tokens/tokens/logo.png', /binary/],
      ['app/page.tsx', /outside what this change may touch/],
      ['inventory.yaml', /outside what this change may touch/],
      ['.env.example', /outside what this change may touch/],
    ]
    for (const [path, reason] of cases) {
      const r = isWritablePath(path, glot, scope)
      expect(r.ok, path).toBe(false)
      if (!r.ok) expect(r.reason, path).toMatch(reason)
    }
  })

  it('refuses everything without a manifest or without change.allowPaths', () => {
    expect(isWritablePath(tokenFile, null).ok).toBe(false)
    const noAllow: RecipeManifest = { ...glot, change: {} }
    const r = isWritablePath(tokenFile, noAllow, scope)
    expect(r.ok ? null : r.reason).toMatch(/no change.allowPaths/)
  })

  it('refuses a token file outside change.allowPaths', () => {
    const narrow: RecipeManifest = { ...glot, change: { allowPaths: ['mushi.recipe.json'] } }
    expect(isWritablePath(tokenFile, narrow, scope).ok).toBe(false)
  })
})

describe('design-sets', () => {
  it('reads directions/<name>/ and finds sibling directions in the tree', () => {
    expect(directionOf('packages/design-tokens/tokens/directions/pha-khram/semantic.tokens.json')).toMatchObject({ name: 'pha-khram' })
    const tree = [
      'packages/design-tokens/tokens/directions/pha-khram/primitive.tokens.json',
      'packages/design-tokens/tokens/directions/nang-lamp/primitive.tokens.json',
      'packages/design-tokens/tokens/directions/nang-lamp/semantic.tokens.json',
      'packages/design-tokens/tokens/directions/nang-lamp/README.md',
    ]
    // Without design.directions[], siblings come from the tree.
    const { sets } = planTokenSets(glot.design!.tokens! as never, tree)
    expect(sets.map((s) => [s.name, s.kind, s.active, s.files.length])).toEqual([
      ['soi-signpaint', 'direction', true, 3],
      ['nang-lamp', 'direction', false, 2],
      ['pha-khram', 'direction', false, 1],
      ['export', 'export', false, 1],
    ])
  })
  it('with design.directions[] the declared directions win, in manifest order, with their notes', () => {
    const { sets } = planTokenSets(glot.design!.tokens! as never, [], glot.design!.directions as never)
    expect(sets.map((s) => [s.name, s.active, s.files.length])).toEqual([
      ['soi-signpaint', true, 3],
      ['pha-khram', false, 3],
      ['nang-lamp', false, 3],
      ['export', false, 1],
    ])
    expect(sets[0].note).toMatch(/Soi Signpaint look/)
  })
  it('an export-only manifest makes the export set the judging set', () => {
    const { sets } = planTokenSets([{ path: 'dtcg/tokens.json', role: 'export' }], [])
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ name: 'export', active: true })
    const stored = { version: 1 as const, active: 'export', sets: [{ ...sets[0], tokens: [{ path: 'a' } as never], issues: [] }] }
    expect(judgingSet(stored)?.name).toBe('export')
  })
})

describe('design-change', () => {
  const tokenText = JSON.stringify({
    color: {
      $type: 'color',
      palette: { signal: { $value: { colorSpace: 'srgb', components: [0.78, 0.22, 0.18], hex: '#C8372D' } } },
      action: { primary: { $value: '{color.palette.signal}' } },
    },
    'space.legacy': { $type: 'dimension', $value: '16px' },
    motion: { quick: { $type: 'duration', $value: { value: 120, unit: 'ms' } } },
  }, null, 2) + '\n'

  it('finds tokens through nested and dotted keys', () => {
    const doc = JSON.parse(tokenText)
    expect(findTokenNode(doc, 'color.palette.signal')).not.toBeNull()
    expect(findTokenNode(doc, 'space.legacy')).not.toBeNull()
    expect(findTokenNode(doc, 'color.nope')).toBeNull()
  })

  it('rewrites a colour as a 2025.10 object and keeps file formatting', () => {
    const r = applyTokenEdits(tokenText, [{ path: 'color.palette.signal', type: 'color', value: '#B23A2E' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = JSON.parse(r.text)
    expect(doc.color.palette.signal.$value).toEqual({ colorSpace: 'srgb', components: [0.698, 0.2275, 0.1804], hex: '#B23A2E' })
    expect(r.text.endsWith('\n')).toBe(true)
    const d = unifiedDiff('t.json', tokenText, r.text)
    expect(d.diff).toContain('-          "hex": "#C8372D"')
    expect(d.diff).toContain('+          "hex": "#B23A2E"')
    expect(d.diff.startsWith('--- a/t.json\n+++ b/t.json\n@@ ')).toBe(true)
  })

  it('keeps a legacy string token a string, and converts durations', () => {
    const r = applyTokenEdits(tokenText, [
      { path: 'space.legacy', type: 'dimension', value: '12px' },
      { path: 'motion.quick', type: 'duration', value: '0.2s' },
    ])
    expect(r.ok && JSON.parse(r.text)['space.legacy'].$value).toBe('12px')
    expect(r.ok && JSON.parse(r.text).motion.quick.$value).toEqual({ value: 0.2, unit: 's' })
  })

  it('refuses to overwrite an alias, an unknown token, or a bad value', () => {
    expect(applyTokenEdits(tokenText, [{ path: 'color.action.primary', type: 'color', value: '#000000' }])).toMatchObject({ ok: false, reason: expect.stringMatching(/alias of \{color.palette.signal\}/) })
    expect(applyTokenEdits(tokenText, [{ path: 'color.missing', type: 'color', value: '#000000' }]).ok).toBe(false)
    expect(applyTokenEdits(tokenText, [{ path: 'color.palette.signal', type: 'color', value: 'red-ish' }]).ok).toBe(false)
    expect(buildTokenValue('dimension', '12', null).ok).toBe(false)
    expect(buildTokenValue('shadow', 'x', null).ok).toBe(false)
  })

  it('writes rule overrides into design.rules of the manifest', () => {
    const r = applyRulesEdit(extendedText, { off_scale_radius: { severity: 'warn', allowValues: [' 18px ', ''] }, off_token_color: { enabled: false } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = JSON.parse(r.text)
    expect(doc.design.rules.off_scale_radius).toEqual({ severity: 'warn', allowValues: ['18px'] })
    expect(doc.design.rules.off_token_color).toEqual({ enabled: false })
    expect(doc.design.rules.raw_interactive_element.primitives).toEqual({ button: 'Button' })
    expect(applyRulesEdit(extendedText, { nope: { enabled: true } } as never).ok).toBe(false)
  })

  it('an unchanged file has an empty diff', () => {
    expect(unifiedDiff('a', 'x\ny\n', 'x\ny\n')).toEqual({ diff: '', additions: 0, deletions: 0 })
  })
})

describe('routes.inventory (the inventory file the host CI ingests)', () => {
  it('defaults to inventory.yaml, follows a declared safe path, and never falls back from an unsafe one', () => {
    expect(inventoryPathOf(glot)).toBe(DEFAULT_INVENTORY_PATH)
    const declared = parseRecipeManifest('{"version":1,"routes":{"inventory":"apps/web/inventory.yaml"}}')
    expect(declared.ok && inventoryPathOf(declared.manifest)).toBe('apps/web/inventory.yaml')
    const unsafe = parseRecipeManifest('{"version":1,"routes":{"inventory":"../x.yaml"}}')
    expect(unsafe.ok).toBe(true)
    if (!unsafe.ok) return
    expect(unsafe.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'UNSAFE_PATH', message: expect.stringMatching(/routes\.inventory/) })])
    expect(inventoryPathOf(unsafe.manifest)).toBeNull()
    expect(parseRecipeManifest('{"version":1,"routes":{"inventory":7}}').ok).toBe(false)
  })
})
