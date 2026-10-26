/**
 * Bounties leaderboard empty state must clear WCAG AA.
 *
 * The public marketplace is always dark (`html[data-mushi-theme="dark"]`).
 * Brand tokens leave `--mushi-paper-wash` at the light beige `#efe7da`, and
 * `.testers-panel` paints that wash behind inherited cream ink (`#f2ebdd`) —
 * about 1.03:1, so "No testers yet — be the first!" vanishes. The shell
 * retints the wash to an opaque srgb mix of ink into paper. This reads that
 * declaration and measures it with the design-plane contrast function.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor, type Rgba } from '../../supabase/functions/_shared/design-color.ts'

const ROOT = resolve(__dirname, '../../../..')
const BRAND = readFileSync(resolve(ROOT, 'packages/brand/src/editorial.css'), 'utf8')
const TESTERS = readFileSync(resolve(ROOT, 'apps/testers/app/globals.css'), 'utf8')
const LEADERBOARD = readFileSync(resolve(ROOT, 'apps/testers/app/leaderboard/page.tsx'), 'utf8')

function braceBlock(css: string, marker: string): string {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`missing ${marker}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unclosed ${marker}`)
}

function decls(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/(--mushi-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim())
  }
  return out
}

/** Dark-theme token map: :root, then `[data-mushi-theme="dark"]` overrides. */
function darkTokens(): Map<string, string> {
  const tokens = decls(braceBlock(BRAND, ':root {'))
  for (const [name, value] of decls(braceBlock(BRAND, '[data-mushi-theme="dark"] {'))) {
    tokens.set(name, value)
  }
  return tokens
}

function resolveToken(name: string, tokens: Map<string, string>, seen = new Set<string>()): Rgba {
  if (seen.has(name)) throw new Error(`cycle at ${name}`)
  seen.add(name)
  const raw = tokens.get(name)
  if (!raw) throw new Error(`missing ${name}`)
  const ref = /^var\((--mushi-[a-z0-9-]+)\)$/.exec(raw)
  const value = ref ? resolveToken(ref[1], tokens, seen) : parseCssColor(raw)
  if (!value) throw new Error(`unparsed ${name}: ${raw}`)
  return value
}

/** `color-mix(in srgb, var(--a) N%, var(--b))` — opaque srgb interpolation. */
function shellWash(): { ink: Rgba; paper: Rgba; wash: Rgba; muted: Rgba; faint: Rgba; vermillion: Rgba } {
  const shell = braceBlock(TESTERS, '.testers-shell {')
  const decl = shell.match(/--mushi-paper-wash\s*:\s*([^;]+);/)
  if (!decl) throw new Error('testers shell does not retint --mushi-paper-wash')
  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*var\((--mushi-[a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*var\((--mushi-[a-z0-9-]+)\)\s*\)$/.exec(decl[1].trim())
  if (!mix) throw new Error(`wash is not an srgb ink-into-paper mix: ${decl[1]}`)
  const tokens = darkTokens()
  const ink = resolveToken(mix[1], tokens)
  const paper = resolveToken(mix[3], tokens)
  const p = Number(mix[2]) / 100
  const q = 1 - p
  const wash = {
    r: ink.r * p + paper.r * q,
    g: ink.g * p + paper.g * q,
    b: ink.b * p + paper.b * q,
    a: 1,
  }
  return {
    ink,
    paper,
    wash,
    muted: resolveToken('--mushi-ink-muted', tokens),
    faint: resolveToken('--mushi-ink-faint', tokens),
    vermillion: resolveToken('--mushi-vermillion', tokens),
  }
}

describe('testers panel contrast', () => {
  const colors = shellWash()

  it('keeps the empty-state sentence on inherited ink inside a paper-wash panel', () => {
    expect(LEADERBOARD).toMatch(
      /<p className="font-medium">No testers yet — be the first!<\/p>/,
    )
    expect(braceBlock(TESTERS, '.testers-panel {')).toMatch(
      /background:\s*var\(--mushi-paper-wash\)/,
    )
  })

  it('paints the dark wash well above the light beige that hid the sentence', () => {
    const beige = parseCssColor('#efe7da')
    expect(beige).not.toBeNull()
    expect(contrastRatio(colors.ink, beige!)).toBeLessThan(1.2)
    expect(contrastRatio(colors.ink, colors.wash)).toBeGreaterThan(10)
  })

  it('clears WCAG AA (4.5:1) for ink, muted, faint, and vermillion on the panel', () => {
    expect(contrastRatio(colors.ink, colors.wash)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colors.muted, colors.wash)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colors.faint, colors.wash)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colors.vermillion, colors.wash)).toBeGreaterThanOrEqual(4.5)
  })
})
