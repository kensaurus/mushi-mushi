/**
 * _shared/dtcg.ts — the DTCG 2025.10 normalizer, with the shorthand real
 * repos ship (Plan 019 decision 2) and three real fixtures: Mushi's own
 * brand.tokens.json, glot.it's generated export (flat dotted keys, legacy
 * strings), and glot.it's Pha Khram source direction (conformant 2025.10).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredFontFamilies, normalizeTokenSet, stableStringify } from '../../supabase/functions/_shared/dtcg.ts'

const REPO = resolve(__dirname, '../../../..')
const GLOT = resolve(__dirname, 'fixtures/recipe/glot')
const file = (path: string, text: unknown, role: 'source' | 'export' = 'source') => ({ path, role, text: typeof text === 'string' ? text : JSON.stringify(text) })
const byPath = (tokens: { path: string }[]) => new Map(tokens.map((t) => [t.path, t]))
const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

describe('normalizeTokenSet — 2025.10 objects', () => {
  it('reads colour objects, dimensions, durations and inherits $type from groups', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', {
      color: { $type: 'color', bg: { $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#FFFFFF' } } },
      space: { $type: 'dimension', '4': { $value: { value: 16, unit: 'px' } }, half: { $value: { value: 0.5, unit: 'rem' } } },
      motion: { $type: 'duration', quick: { $value: { value: 120, unit: 'ms' } } },
    })])
    const t = byPath(tokens)
    expect(t.get('color.bg')).toMatchObject({ type: 'color', hex: '#FFFFFF', display: '#FFFFFF', group: 'color' })
    expect(t.get('space.4')).toMatchObject({ type: 'dimension', px: 16, display: '16px' })
    expect(t.get('space.half')).toMatchObject({ px: 8, display: '0.5rem' })
    expect(t.get('motion.quick')).toMatchObject({ type: 'duration', display: '120ms' })
    expect(issues).toEqual([])
  })

  it('computes hex from components when no hex is given, and keeps alpha', () => {
    const { tokens } = normalizeTokenSet([file('a.json', { c: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 } } })])
    expect(tokens[0].hex).toBe('#00000080')
  })

  it('reads the mushi extension names', () => {
    const { tokens } = normalizeTokenSet([file('a.json', { color: { cta: { $type: 'color', $value: '#E8387F', $extensions: { 'us.kensaur.mushi': { cssVar: '--color-cta', ts: 'colors.cta', rn: 'cta' } } } } })])
    expect(tokens[0]).toMatchObject({ cssVar: '--color-cta', ts: 'colors.cta', rn: 'cta' })
  })
})

describe('normalizeTokenSet — tolerated shorthand (info issues, never rejection)', () => {
  it('expands hex shorthand #abc / #abcd and flags it', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', { c: { $type: 'color', short: { $value: '#abc' }, shortA: { $value: '#abcd' } } })])
    const t = byPath(tokens)
    expect(t.get('c.short')!.hex).toBe('#AABBCC')
    expect(t.get('c.shortA')!.hex).toBe('#AABBCCDD')
    expect(codes(issues)).toContain('hex_shorthand')
    expect(codes(issues)).toContain('legacy_color_string')
    expect(issues.every((i) => i.severity === 'info')).toBe(true)
  })

  it('reads legacy rgba() strings and "16px" / "0.2s" strings', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', {
      c: { $type: 'color', $value: 'rgba(0, 0, 0, 0.12)' },
      d: { $type: 'dimension', $value: '16px' },
      t: { $type: 'duration', $value: '0.2s' },
    })])
    const t = byPath(tokens)
    expect(t.get('c')!.hex).toBe('#0000001F')
    expect(t.get('d')).toMatchObject({ px: 16, value: { value: 16, unit: 'px' } })
    expect(t.get('t')).toMatchObject({ display: '200ms' })
    expect(codes(issues)).toEqual(expect.arrayContaining(['legacy_color_string', 'legacy_dimension_string', 'legacy_duration_string']))
  })

  it('splits flat dotted names into path segments and flags each', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', { primitive: { 'color.bg': { $type: 'color', $value: '#FAFAF8' }, 'color.surface.hover': { $type: 'color', $value: '#F5F0EA' } } })])
    expect(tokens.map((t) => t.path)).toEqual(['primitive.color.bg', 'primitive.color.surface.hover'])
    expect(issues.filter((i) => i.code === 'token_nonconformant')).toHaveLength(2)
  })

  it('infers a missing $type and says so', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', { c: { $value: '#123456' } })])
    expect(tokens[0]).toMatchObject({ type: 'color', hex: '#123456' })
    expect(codes(issues)).toContain('token_missing_type')
  })

  it('warns, without throwing, on an unreadable colour', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', { c: { $type: 'color', $value: 'tomato-ish' } })])
    expect(tokens[0].hex).toBeNull()
    expect(issues.find((i) => i.code === 'color_unparseable')?.severity).toBe('warn')
  })
})

describe('normalizeTokenSet — aliases', () => {
  it('resolves {a.b} across files and records the alias target', () => {
    const { tokens } = normalizeTokenSet([
      file('primitive.json', { color: { $type: 'color', palette: { red: { $value: { colorSpace: 'srgb', components: [0.78, 0.22, 0.18], hex: '#C8372D' } } } } }),
      file('semantic.json', { color: { $type: 'color', action: { primary: { $value: '{color.palette.red}' } } } }),
      file('component.json', { button: { bg: { $type: 'color', $value: '{color.action.primary}' } } }),
    ])
    const t = byPath(tokens)
    expect(t.get('color.action.primary')).toMatchObject({ hex: '#C8372D', aliasOf: 'color.palette.red', file: 'semantic.json' })
    expect(t.get('button.bg')).toMatchObject({ hex: '#C8372D', aliasOf: 'color.action.primary' })
  })

  it('resolves $ref JSON pointers and aliases nested in composite values', () => {
    const { tokens } = normalizeTokenSet([file('a.json', {
      font: { family: { body: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] } }, size: { body: { $type: 'dimension', $value: { value: 17, unit: 'px' } } } },
      typography: { body: { $type: 'typography', $value: { fontFamily: '{font.family.body}', fontSize: '{font.size.body}' } } },
      alias: { $type: 'fontFamily', $value: { $ref: '#/font/family/body' } },
    })])
    const t = byPath(tokens)
    expect(t.get('typography.body')!.value).toEqual({ fontFamily: ['Inter', 'sans-serif'], fontSize: { value: 17, unit: 'px' } })
    expect(t.get('typography.body')!.display).toBe('17px Inter, sans-serif')
    expect(t.get('alias')).toMatchObject({ aliasOf: 'font.family.body', display: 'Inter, sans-serif' })
  })

  it('reports unresolved aliases and cycles instead of looping', () => {
    const { tokens, issues } = normalizeTokenSet([file('a.json', {
      a: { $type: 'color', $value: '{b}' },
      b: { $type: 'color', $value: '{a}' },
      c: { $type: 'color', $value: '{nope.missing}' },
    })])
    expect(codes(issues)).toEqual(expect.arrayContaining(['alias_cycle', 'alias_unresolved']))
    expect(byPath(tokens).get('c')!.display).toBe('{nope.missing} (unresolved)')
  })

  it('reports invalid JSON per file and keeps the other files', () => {
    const { tokens, issues } = normalizeTokenSet([file('bad.json', '{ nope'), file('good.json', { c: { $type: 'color', $value: '#000000' } })])
    expect(tokens).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'token_file_invalid_json', file: 'bad.json', severity: 'error' })
  })
})

describe('fixtures', () => {
  it("Mushi's brand.tokens.json normalizes with every colour readable", () => {
    const text = readFileSync(resolve(REPO, 'packages/brand/tokens/brand.tokens.json'), 'utf8')
    const { tokens, issues } = normalizeTokenSet([file('packages/brand/tokens/brand.tokens.json', text)])
    const colors = tokens.filter((t) => t.type === 'color')
    expect(colors.length).toBeGreaterThan(10)
    expect(colors.every((t) => t.hex)).toBe(true)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it("glot's generated export (flat dotted keys, legacy strings) normalizes with info issues only", () => {
    const text = readFileSync(resolve(GLOT, 'packages/design-tokens/dtcg/tokens.json'), 'utf8')
    const { tokens, issues } = normalizeTokenSet([file('packages/design-tokens/dtcg/tokens.json', text, 'export')])
    expect(tokens.length).toBeGreaterThan(100)
    expect(byPath(tokens).get('primitive.color.bg')!.hex).toBe('#FAFAF8')
    expect(issues.some((i) => i.code === 'token_nonconformant')).toBe(true)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it("glot's Pha Khram source direction is conformant: 0 issues, every alias resolved, Thai family kept", () => {
    const dir = 'packages/design-tokens/tokens/directions/pha-khram'
    const files = ['primitive', 'semantic', 'component'].map((n) => file(`${dir}/${n}.tokens.json`, readFileSync(resolve(GLOT, dir, `${n}.tokens.json`), 'utf8')))
    const { tokens, issues } = normalizeTokenSet(files)
    expect(issues).toEqual([])
    const t = byPath(tokens)
    expect(t.get('color.action.primary')).toMatchObject({ hex: '#C8372D', cssVar: '--color-cta', ts: 'colors.cta' })
    expect(t.get('button.primary.background')!.hex).toBe('#C8372D')
    expect(t.get('font.family.body')!.display).toBe('IBM Plex Sans Thai Looped, sans-serif')
    expect(t.get('space.target.min')!.px).toBe(44)
    expect(tokens.every((tok) => !tok.display.includes('(unresolved)'))).toBe(true)
    expect(declaredFontFamilies(tokens)).toEqual(new Set(['ibm plex sans thai looped', 'sans-serif', 'ibm plex mono', 'monospace']))
  })
})

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }))
  })
})
