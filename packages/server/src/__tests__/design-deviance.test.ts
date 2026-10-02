/**
 * _shared/design-deviance.ts — every deviance rule with a positive and a
 * negative case, comment masking, the contrast evaluator, the score formula,
 * and a realistic run over the glot.it fixture tokens.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor, toHex } from '../../supabase/functions/_shared/design-color.ts'
import {
  buildDevianceContext,
  computeDevianceScore,
  contrastFindings,
  DEVIANCE_K,
  devianceStatus,
  evaluateContrast,
  maskComments,
  scanSourceFile,
} from '../../supabase/functions/_shared/design-deviance.ts'
import { normalizeTokenSet } from '../../supabase/functions/_shared/dtcg.ts'
import { effectiveDesignRules, parseRecipeManifest } from '../../supabase/functions/_shared/recipe-schema.ts'
import type { DesignRuleConfig, DesignRuleId } from '../../supabase/functions/_shared/recipe-types.ts'

const TOKENS = normalizeTokenSet([{
  path: 'tokens.json',
  role: 'source',
  text: JSON.stringify({
    color: {
      $type: 'color',
      cta: { $value: { colorSpace: 'srgb', components: [0.784, 0.216, 0.176], hex: '#C8372D' }, $extensions: { 'us.kensaur.mushi': { cssVar: '--color-cta', ts: 'colors.cta' } } },
      canvas: { $value: { colorSpace: 'srgb', components: [0.075, 0.125, 0.227], hex: '#13203A' } },
      cotton: { $value: { colorSpace: 'srgb', components: [0.957, 0.929, 0.882], hex: '#F4EDE1' } },
      white: { $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#FFFFFF' } },
    },
    font: { family: { $type: 'fontFamily', body: { $value: ['IBM Plex Sans Thai Looped', 'sans-serif'] } } },
    space: { $type: 'dimension', '1': { $value: { value: 4, unit: 'px' } }, '2': { $value: { value: 8, unit: 'px' } }, '4': { $value: { value: 16, unit: 'px' } } },
    radius: { $type: 'dimension', control: { $value: { value: 12, unit: 'px' } }, round: { $value: { value: 9999, unit: 'px' } } },
  }),
}]).tokens

function rules(over: Partial<Record<DesignRuleId, Partial<DesignRuleConfig>>> = {}): DesignRuleConfig[] {
  return effectiveDesignRules(null).map((r) => ({ ...r, ...(over[r.id] ?? {}) }))
}

function scan(path: string, text: string, over: Partial<Record<DesignRuleId, Partial<DesignRuleConfig>>> = {}, componentGlobs: string[] = []) {
  return scanSourceFile(path, text, buildDevianceContext(TOKENS, rules(over), componentGlobs)).findings
}
const ids = (f: { rule_id: string }[]) => f.map((x) => x.rule_id)

describe('colour maths', () => {
  it('parses hex, rgb, hsl, oklch and Tailwind underscores', () => {
    expect(toHex(parseCssColor('#c8372d')!)).toBe('#C8372D')
    expect(toHex(parseCssColor('rgb(200 55 45)')!)).toBe('#C8372D')
    expect(toHex(parseCssColor('rgba(200,55,45,0.5)')!)).toBe('#C8372D80')
    expect(toHex(parseCssColor('hsl(0 100% 50%)')!)).toBe('#FF0000')
    expect(toHex(parseCssColor('hsl(340_80%_75%)')!)).toBe('#F28CAE')
    expect(toHex(parseCssColor('oklch(1 0 0)')!)).toBe('#FFFFFF')
    expect(parseCssColor('var(--x)')).toBeNull()
  })
  it('computes WCAG ratios', () => {
    expect(contrastRatio(parseCssColor('#000')!, parseCssColor('#fff')!)).toBe(21)
    expect(contrastRatio(parseCssColor('#F4EDE1')!, parseCssColor('#13203A')!)).toBe(13.93)
  })
})

describe('off_token_color', () => {
  it('flags a hex literal in CSS that matches no token, with the nearest token', () => {
    const f = scan('a.css', '.btn { color: #C8372E; }')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ rule_id: 'off_token_color', line: 1, value: '#C8372E', suggestion: { token: 'color.cta', cssVar: '--color-cta' } })
  })
  it('does not flag a literal equal to a token, in any notation or case', () => {
    expect(scan('a.css', '.a { color: #c8372d; background: rgb(200, 55, 45); border-color: #fff; }')).toEqual([])
  })
  it('flags rgb/hsl/oklch literals and Tailwind arbitrary values in TSX strings', () => {
    const f = scan('a.tsx', `export const A = () => <div className="bg-[#123456] text-[rgb(1_2_3)]" style={{ color: 'hsl(120 50% 50%)', fill: 'oklch(0.5 0.1 200)' }} />`)
    expect(f.map((x) => x.value)).toEqual(['#123456', 'rgb(1_2_3)', 'hsl(120 50% 50%)', 'oklch(0.5 0.1 200)'])
  })
  it('ignores comments, CSS selectors, href anchors and code that is not a string', () => {
    const src = [
      '// #123456 in a line comment',
      '/* rgb(1, 2, 3) in a block comment */',
      'const link = <a href="#top">top</a>',
      'const x = rgb(1, 2, 3) // a function call, not a literal',
      'const issue = "see #1234 in the tracker"',
    ].join('\n')
    expect(scan('a.tsx', src)).toEqual([])
    expect(scan('a.css', '#add-button { display: none; }')).toEqual([])
  })
  it('respects allowValues and allowFiles', () => {
    expect(scan('a.css', '.a { color: #123456; }', { off_token_color: { allowValues: ['#123456'] } })).toEqual([])
    expect(scan('legacy/a.css', '.a { color: #123456; }', { off_token_color: { allowFiles: ['legacy/**'] } })).toEqual([])
  })
  it('is silent when disabled', () => {
    expect(scan('a.css', '.a { color: #123456; }', { off_token_color: { enabled: false } })).toEqual([])
  })
})

describe('off_token_font', () => {
  it('flags an undeclared family in CSS, style objects and Tailwind font-[…]', () => {
    expect(ids(scan('a.css', '.a { font-family: "Comic Sans MS", sans-serif; }'))).toEqual(['off_token_font'])
    expect(ids(scan('a.tsx', `const s = { fontFamily: 'Roboto' }`))).toEqual(['off_token_font'])
    expect(ids(scan('a.tsx', `<p className="font-['Lobster']" />`))).toEqual(['off_token_font'])
  })
  it('accepts declared families, generic families and var()', () => {
    expect(scan('a.css', `.a { font-family: 'IBM Plex Sans Thai Looped', system-ui, sans-serif; } .b { font-family: var(--font-sans); }`)).toEqual([])
  })
})

describe('off_scale_spacing', () => {
  it('flags off-scale padding/margin/gap in CSS, style objects and Tailwind arbitrary values', () => {
    expect(scan('a.css', '.a { padding: 8px 13px; }').map((f) => f.value)).toEqual(['13px'])
    expect(scan('a.tsx', 'const s = { marginTop: 10 }').map((f) => f.value)).toEqual(['10px'])
    const tw = scan('a.tsx', '<div className="p-[13px] gap-[0.375rem]" />')
    expect(tw.map((f) => f.value)).toEqual(['13px', '0.375rem'])
    expect(tw[0].suggestion).toMatchObject({ token: 'space.4', distance: 3 })
  })
  it('accepts on-scale values (px or rem), zero and allowValues', () => {
    expect(scan('a.css', '.a { padding: 4px 0.5rem 16px 0; margin: 0; }')).toEqual([])
    expect(scan('a.css', '.a { gap: 6px; }', { off_scale_spacing: { allowValues: ['6px'] } })).toEqual([])
  })
})

describe('off_scale_radius', () => {
  it('flags off-scale radii in CSS, style objects and Tailwind rounded-[…]', () => {
    expect(scan('a.css', '.a { border-radius: 18px; }').map((f) => f.value)).toEqual(['18px'])
    expect(scan('a.tsx', 'const s = { borderRadius: 20 }').map((f) => f.value)).toEqual(['20px'])
    expect(scan('a.tsx', '<div className="rounded-[24px]" />').map((f) => f.value)).toEqual(['24px'])
  })
  it('accepts on-scale radii and the default 50% allowance', () => {
    expect(scan('a.css', '.a { border-radius: 12px; } .b { border-radius: 50%; } .c { border-radius: 9999px; }')).toEqual([])
  })
})

describe('raw_interactive_element (opt-in)', () => {
  const on = { raw_interactive_element: { enabled: true, primitives: { button: 'Button' } } }
  it('is off by default', () => {
    expect(scan('app/page.tsx', '<button onClick={go}>Go</button>')).toEqual([])
  })
  it('flags raw elements outside the declared component globs and names the primitive', () => {
    const f = scan('app/page.tsx', '<button onClick={go}>Go</button>\n<input value={v} />', on, ['design-system/**'])
    expect(f.map((x) => x.value)).toEqual(['<button>', '<input>'])
    expect(f[0]).toMatchObject({ line: 1, message: 'Raw <button> bypasses your Button primitive.' })
  })
  it('does not flag inside the primitives or in non-TSX files', () => {
    expect(scan('design-system/Button.tsx', '<button />', on, ['design-system/**'])).toEqual([])
    expect(scan('app/page.css', 'button { color: red; }', on, ['design-system/**'])).toEqual([])
  })
})

describe('maskComments', () => {
  it('keeps offsets and newlines, and does not treat // inside a string as a comment', () => {
    const src = 'const u = "https://x.io/#fff" // trailing #000\n/* #111 */ x'
    const masked = maskComments(src, 'js')
    expect(masked.length).toBe(src.length)
    expect(masked).toContain('"https://x.io/#fff"')
    expect(masked).not.toContain('#000')
    expect(masked).not.toContain('#111')
    expect(masked.split('\n')).toHaveLength(2)
  })
})

describe('contrast_below_aa', () => {
  it('passes a 13.93:1 pair, fails a low pair, honours large text (3:1), and reports unresolved tokens', () => {
    const results = evaluateContrast(TOKENS, [
      { fg: 'color.cotton', bg: 'color.canvas' },
      { fg: '{color.white}', bg: '{color.cotton}' },
      { fg: 'color.cta', bg: 'color.canvas', large: true },
      { fg: 'color.cta', bg: 'color.canvas' },
      { fg: 'color.missing', bg: 'color.canvas' },
    ])
    expect(results.map((r) => r.pass)).toEqual([true, false, true, false, null])
    expect(results[0].ratio).toBe(13.93)
    expect(results[2]).toMatchObject({ min: 3, ratio: 3.12 })
    expect(results[3].min).toBe(4.5)
    expect(results[4].problem).toMatch(/color.missing/)
    const findings = contrastFindings(results, TOKENS, rules().find((r) => r.id === 'contrast_below_aa'))
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ rule_id: 'contrast_below_aa', severity: 'error', file_path: 'tokens.json' })
  })
  it('produces nothing when disabled', () => {
    const results = evaluateContrast(TOKENS, [{ fg: 'color.white', bg: 'color.cotton' }])
    expect(contrastFindings(results, TOKENS, { ...rules()[4], enabled: false })).toEqual([])
  })
})

describe('computeDevianceScore', () => {
  const allApplicable = { off_token_color: true, off_token_font: true, off_scale_spacing: true, off_scale_radius: true, contrast_below_aa: true, raw_interactive_element: true }
  const base = { rules: rules(), counts: {}, scannedLines: 10_000, scannedFiles: 50, applicable: allApplicable, contrast: { declared: 4, failing: 0 } }

  it('is 0 when nothing deviates', () => {
    expect(computeDevianceScore(base).score).toBe(0)
  })
  it('follows the documented formula exactly', () => {
    // colour (warn, w2): 30 findings / 10 KLOC = 3 per KLOC → 1 − e^(−3/3) = 0.632
    // contrast (error, w3): 1 of 4 failing → 0.25
    // font (w2), spacing (w1), radius (w1): 0. raw element disabled by default → excluded.
    const { score, breakdown } = computeDevianceScore({ ...base, counts: { off_token_color: 30 }, contrast: { declared: 4, failing: 1 } })
    const expected = Math.round((100 * (2 * (1 - Math.exp(-3 / DEVIANCE_K)) + 3 * 0.25)) / (2 + 3 + 2 + 1 + 1))
    expect(score).toBe(expected)
    expect(score).toBe(22)
    expect(breakdown.find((b) => b.rule === 'off_token_color')).toMatchObject({ density: 3, penalty: 0.632, weight: 2 })
  })
  it('normalizes by size: the same density scores the same in a bigger codebase', () => {
    const small = computeDevianceScore({ ...base, counts: { off_token_color: 10 }, scannedLines: 2_000 }).score
    const big = computeDevianceScore({ ...base, counts: { off_token_color: 50 }, scannedLines: 10_000 }).score
    expect(small).toBe(big)
  })
  it('a rule with nothing to judge is excluded, and nothing to judge at all is null (never 0)', () => {
    const noPairs = computeDevianceScore({ ...base, contrast: { declared: 0, failing: 0 } })
    expect(noPairs.breakdown.find((b) => b.rule === 'contrast_below_aa')!.applicable).toBe(false)
    expect(computeDevianceScore({ ...base, scannedFiles: 0, scannedLines: 0, contrast: { declared: 0, failing: 0 } }).score).toBeNull()
  })
  it('severity changes the weight, so tightening a rule moves the score', () => {
    const counts = { off_scale_radius: 40 }
    const asInfo = computeDevianceScore({ ...base, counts }).score!
    const asError = computeDevianceScore({ ...base, counts, rules: rules({ off_scale_radius: { severity: 'error' } }) }).score!
    expect(asError).toBeGreaterThan(asInfo)
  })
  it('is bounded to 0..100', () => {
    const worst = computeDevianceScore({
      ...base,
      rules: rules({ raw_interactive_element: { enabled: true } }),
      counts: { off_token_color: 1e6, off_token_font: 1e6, off_scale_spacing: 1e6, off_scale_radius: 1e6, raw_interactive_element: 1e6 },
      contrast: { declared: 2, failing: 2 },
    })
    expect(worst.score).toBe(100)
  })
  it('gate status: info never fails', () => {
    expect(devianceStatus([{ severity: 'info' }])).toBe('pass')
    expect(devianceStatus([{ severity: 'info' }, { severity: 'warn' }])).toBe('warn')
    expect(devianceStatus([{ severity: 'error' }])).toBe('fail')
  })
})

describe('glot.it fixture', () => {
  it('Soi Signpaint (the active direction) + the extended fixture: contrast is computed per declared pair, and an off-token literal is caught', () => {
    const GLOT = resolve(__dirname, 'fixtures/recipe/glot')
    const parsed = parseRecipeManifest(readFileSync(resolve(__dirname, 'fixtures/recipe/glot-extended.recipe.json'), 'utf8'))
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    const files = parsed.manifest.design!.tokens!.filter((t) => t.role === 'source').map((t) => ({ path: t.path, role: 'source' as const, text: readFileSync(resolve(GLOT, t.path), 'utf8') }))
    const { tokens } = normalizeTokenSet(files)
    const contrast = evaluateContrast(tokens, parsed.manifest.design!.contrast!)
    const failing = contrast.filter((c) => c.pass !== true)
    // Mustard reward on the Soi canvas is 1.63:1, so the large-text pair fails.
    expect(failing.map((c) => [c.fg, c.bg, c.ratio])).toEqual([['color.feedback.reward', 'color.surface.base', 1.63]])
    expect(contrast.find((c) => c.fg === 'color.text.primary')!.ratio).toBe(15.5)
    expect(contrast.find((c) => c.fg === 'color.action.onPrimary')!.ratio).toBe(5.49)
    const ctx = buildDevianceContext(tokens, effectiveDesignRules(parsed.manifest), parsed.manifest.design!.components!.globs)
    const f = scanSourceFile('app/page.tsx', `export default () => <button className="bg-[#E8387F] rounded-[18px]">Go</button>`, ctx).findings
    expect(f.map((x) => x.rule_id).sort()).toEqual(['off_scale_radius', 'off_token_color', 'raw_interactive_element'])
    expect(f.find((x) => x.rule_id === 'off_token_color')!.suggestion).toMatchObject({ token: expect.stringMatching(/^color\./) })
  })
})
