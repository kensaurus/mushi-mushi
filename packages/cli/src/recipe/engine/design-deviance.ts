/**
 * FILE: packages/server/supabase/functions/_shared/design-deviance.ts
 * PURPOSE: The `design_drift` deviance check (Plan 019 Phase 1b): pure rules
 *          that read source text against the app's own design tokens, the
 *          declared-contrast evaluator, and the 0–100 deviance score.
 *
 * Rules (ids are stable; they become gate_findings.rule_id):
 *   off_token_color         hex / rgb / hsl / hwb / oklab / oklch literals
 *                           (CSS, TS/TSX, Tailwind arbitrary values) whose
 *                           sRGB matches no colour token.
 *   off_token_font          font families not named by any fontFamily or
 *                           typography token (generic families are fine).
 *   off_scale_spacing       padding / margin / gap px|rem values not on the
 *                           space scale (CSS, style objects, Tailwind `p-[13px]`).
 *   off_scale_radius        border-radius values not on the radius scale.
 *   contrast_below_aa       declared fg/bg token pairs under their required ratio.
 *   raw_interactive_element <button>/<input>/<select>/<textarea> in TSX/JSX
 *                           outside the declared component globs (opt-in).
 *
 * Comments are masked before scanning, so `#123` in a comment or an issue
 * reference never counts. Tailwind scale classes (`p-3`) are not judged:
 * their pixel value depends on a config Mushi never executes.
 *
 * Score (documented in apps/docs/content/concepts/app-recipe.mdx):
 *   literal rules:  density = findings per 1,000 scanned lines
 *                   penalty = 1 − e^(−density / K),  K = 3
 *   contrast rule:  penalty = failing pairs / declared pairs
 *   weight          error 3, warn 2, info 1 (the rule's configured severity)
 *   score           round(100 × Σ weight·penalty / Σ weight) over enabled,
 *                   applicable rules. 0 = fully on-system; null when no rule
 *                   could judge anything (nothing scanned, no tokens).
 *
 * Engine file: kept byte-identical in packages/cli/src/recipe/engine/
 * (see design-engine-types.ts), so `mushi recipe check` finds exactly what
 * the server scan finds.
 */

import { colorDistance, contrastRatio, parseCssColor, sameRgb, type Rgba } from './design-color.ts'
import { declaredFontFamilies } from './dtcg.ts'
import { matchAny } from './recipe-glob.ts'
import type {
  ContrastPairDecl,
  ContrastPairResult,
  DesignRuleConfig,
  DesignRuleId,
  DesignToken,
  DevianceBreakdownEntry,
  DevianceFinding,
  DevianceSuggestion,
  FindingSeverity,
} from './design-engine-types.ts'

export const DEVIANCE_K = 3
export const SEVERITY_WEIGHT: Readonly<Record<FindingSeverity, number>> = { error: 3, warn: 2, info: 1 }

export const LITERAL_RULES: readonly DesignRuleId[] = [
  'off_token_color',
  'off_token_font',
  'off_scale_spacing',
  'off_scale_radius',
  'raw_interactive_element',
]

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont',
  'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none',
])

const SPACE_GROUP_RE = /^(space|spacing|spacer|gap|gutter|inset)$/i
const RADIUS_SEG_RE = /^(radius|radii|rounded|corner|corners|borderradius)$/i

// ── Context ──────────────────────────────────────────────────────────────────

export interface DevianceContext {
  rules: Map<DesignRuleId, DesignRuleConfig>
  colors: Array<{ token: DesignToken; rgba: Rgba }>
  families: Set<string>
  spacing: Array<{ token: DesignToken; px: number }>
  radius: Array<{ token: DesignToken; px: number }>
  componentGlobs: string[]
}

export function buildDevianceContext(
  tokens: readonly DesignToken[],
  rules: readonly DesignRuleConfig[],
  componentGlobs: readonly string[] = [],
): DevianceContext {
  const colors: DevianceContext['colors'] = []
  const spacing: DevianceContext['spacing'] = []
  const radius: DevianceContext['radius'] = []
  for (const t of tokens) {
    if (t.type === 'color' && t.hex) {
      const rgba = parseCssColor(t.hex)
      if (rgba) colors.push({ token: t, rgba })
    }
    if (t.type === 'dimension' && t.px != null) {
      const segs = t.path.split('.')
      // Any segment, so prefixed exports (`primitive.space.4`) count too.
      if (segs.some((s) => SPACE_GROUP_RE.test(s))) spacing.push({ token: t, px: t.px })
      if (segs.some((s) => RADIUS_SEG_RE.test(s))) radius.push({ token: t, px: t.px })
    }
  }
  return {
    rules: new Map(rules.map((r) => [r.id, r])),
    colors,
    families: declaredFontFamilies(tokens),
    spacing,
    radius,
    componentGlobs: [...componentGlobs],
  }
}

/** Whether a rule has anything to judge against (no tokens → not applicable). */
export function ruleApplicable(rule: DesignRuleId, ctx: DevianceContext, declaredPairs = 0): boolean {
  switch (rule) {
    case 'off_token_color': return ctx.colors.length > 0
    case 'off_token_font': return ctx.families.size > 0
    case 'off_scale_spacing': return ctx.spacing.length > 0
    case 'off_scale_radius': return ctx.radius.length > 0
    case 'contrast_below_aa': return declaredPairs > 0
    case 'raw_interactive_element': return true
  }
}

// ── Comment masking ──────────────────────────────────────────────────────────

export type SourceLang = 'css' | 'js' | 'other'

export function langOf(path: string): SourceLang {
  if (/\.(css|scss|sass|less|pcss)$/i.test(path)) return 'css'
  if (/\.(tsx?|jsx?|mjs|cjs|mts|cts|vue|svelte|astro)$/i.test(path)) return 'js'
  return 'other'
}

/**
 * Replace comments with spaces, keeping offsets and newlines, so line numbers
 * stay true. JS mode skips over string and template literals so `//` inside a
 * URL string is not taken as a comment.
 */
export function maskComments(text: string, lang: SourceLang): string {
  const out = text.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (lang === 'js') {
      if (c === '/' && d === '/') {
        let end = text.indexOf('\n', i)
        if (end === -1) end = n
        blank(i, end)
        i = end
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1
        while (j < n && text[j] !== c) {
          if (text[j] === '\\') j++
          else if (c !== '`' && text[j] === '\n') break
          j++
        }
        i = j + 1
        continue
      }
    }
    i++
  }
  return out.join('')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function lineIndex(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

function position(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0, hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 }
}

function toPx(raw: string): number | null {
  const m = /^(-?[\d.]+)(px|rem)?$/.exec(raw.trim())
  if (!m) return null
  const v = Math.abs(Number(m[1]))
  if (!Number.isFinite(v)) return null
  return m[2] === 'rem' ? v * 16 : v
}

function allowedValue(rule: DesignRuleConfig, raw: string): boolean {
  const v = raw.trim().toLowerCase()
  return rule.allowValues.some((a) => a.trim().toLowerCase() === v)
}

function nearestScale(scale: Array<{ token: DesignToken; px: number }>, px: number): DevianceSuggestion | null {
  let best: { token: DesignToken; px: number } | null = null
  for (const s of scale) {
    if (!best || Math.abs(s.px - px) < Math.abs(best.px - px) || (Math.abs(s.px - px) === Math.abs(best.px - px) && s.token.path < best.token.path)) best = s
  }
  return best
    ? { token: best.token.path, cssVar: best.token.cssVar, ts: best.token.ts, value: best.token.display, distance: Math.round(Math.abs(best.px - px) * 100) / 100 }
    : null
}

/** Nearest colour token; among equal colours prefer one with a CSS var or TS name. */
export function nearestColor(ctx: DevianceContext, c: Rgba): DevianceSuggestion | null {
  let best: { token: DesignToken; d: number } | null = null
  const rank = (t: DesignToken) => (t.cssVar ? 0 : t.ts ? 1 : 2)
  for (const { token, rgba } of ctx.colors) {
    const d = colorDistance({ ...c, a: 1 }, { ...rgba, a: 1 })
    if (
      !best ||
      d < best.d - 1e-9 ||
      (Math.abs(d - best.d) < 1e-9 && (rank(token) < rank(best.token) || (rank(token) === rank(best.token) && token.path < best.token.path)))
    ) best = { token, d }
  }
  return best ? { token: best.token.path, cssVar: best.token.cssVar, ts: best.token.ts, value: best.token.display, distance: best.d } : null
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g
const COLOR_FN_RE = /\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color)\((?:[^()]|\([^()]*\))*\)/gi
/** Attribute or key contexts where `#abc` is an anchor or id, not a colour. */
const ANCHOR_CONTEXT_RE = /(?:href|to|id|htmlFor|hash|anchor|target|selector|querySelector\(|getElementById\()\s*[=:]?\s*\{?\s*$/i
const HEX_PREV_OK = /[\s(\[,:='"`{]/
const SHORT_HEX_AFTER = /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none|transparent|-?[\d.]+(?:px|rem|em|%)?)$/i

// ── What a flagged literal says ──────────────────────────────────────────────

/** A literal a rule flags: the value, the finding text and the token to use. Built here only, never taken from a caller. */
export interface LiteralVerdict {
  value: string
  message: string
  suggestion: DevianceSuggestion | null
}

function judgeColorLiteral(ctx: DevianceContext, rule: DesignRuleConfig, literal: string): LiteralVerdict | null {
  if (allowedValue(rule, literal) || /var\(|\bfrom\b/i.test(literal)) return null
  const c = parseCssColor(literal)
  if (c && ctx.colors.some((t) => sameRgb(t.rgba, c))) return null
  return {
    value: literal,
    message: c ? `Colour ${literal} is not in your tokens.` : `Colour ${literal} could not be read as sRGB, so it cannot match a token.`,
    suggestion: c ? nearestColor(ctx, c) : null,
  }
}

function judgeFontName(ctx: DevianceContext, rule: DesignRuleConfig, name: string): LiteralVerdict | null {
  if (!name || /^\d+$/.test(name) || GENERIC_FAMILIES.has(name.toLowerCase())) return null
  if (ctx.families.has(name.toLowerCase()) || allowedValue(rule, name)) return null
  const body = [...ctx.families][0] ?? null
  return { value: name, message: `Font family "${name}" is not in your tokens.`, suggestion: body ? { token: 'font.family', cssVar: null, ts: null, value: body, distance: null } : null }
}

function judgeScaleValue(rule: DesignRuleConfig, scale: Array<{ token: DesignToken; px: number }>, raw: string, what: 'Spacing' | 'Radius'): LiteralVerdict | null {
  if (allowedValue(rule, raw)) return null
  const px = toPx(raw)
  if (px == null || px === 0) return null
  if (scale.some((s) => Math.abs(s.px - px) < 0.01)) return null
  if (allowedValue(rule, `${px}px`)) return null
  return { value: raw.trim(), message: `${what} ${raw.trim()} is off your ${what.toLowerCase()} scale.`, suggestion: nearestScale(scale, px) }
}

function judgeRawElement(rule: DesignRuleConfig, tag: string): LiteralVerdict {
  const prim = rule.primitives?.[tag] ?? null
  return {
    value: `<${tag}>`,
    message: prim ? `Raw <${tag}> bypasses your ${prim} primitive.` : `Raw <${tag}> outside your component primitives.`,
    suggestion: prim ? { token: prim, cssVar: null, ts: null, value: prim, distance: null } : null,
  }
}

const HEX_ONLY_RE = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})$/
const COLOR_FN_ONLY_RE = /^(?:rgba?|hsla?|hwb|oklab|oklch)\((?:[\d\s.,%/+-]|deg|turn|g?rad|none)*\)$/i
const FONT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .-]{0,63}$/u
const SCALE_VALUE_RE = /^-?\d+(?:\.\d+)?(?:px|rem)$/
const RAW_ELEMENT_RE = /^<(button|input|select|textarea)>$/

/**
 * Judge again one literal finding reported from elsewhere (the CI push of
 * `mushi recipe check`). Null unless the rule is on and applies to `path`, the
 * value has the exact shape this rule's scanner extracts (a hex or a numeric
 * colour function that parses, a short font name, a px/rem length, a raw
 * element tag), and it really is off the tokens. The value, message and
 * suggestion all come from here, so no reporter text reaches a finding.
 */
export function rejudgeLiteral(path: string, ruleId: DesignRuleId, value: string, ctx: DevianceContext): LiteralVerdict | null {
  const rule = ctx.rules.get(ruleId)
  if (!rule || !rule.enabled || langOf(path) === 'other') return null
  if (rule.allowFiles.length > 0 && matchAny(path, rule.allowFiles)) return null
  switch (ruleId) {
    case 'off_token_color': {
      const shaped = HEX_ONLY_RE.test(value) || (COLOR_FN_ONLY_RE.test(value) && parseCssColor(value) !== null)
      return ctx.colors.length > 0 && shaped ? judgeColorLiteral(ctx, rule, value) : null
    }
    case 'off_token_font':
      return ctx.families.size > 0 && FONT_NAME_RE.test(value) && value.trim() === value ? judgeFontName(ctx, rule, value) : null
    case 'off_scale_spacing':
      return ctx.spacing.length > 0 && SCALE_VALUE_RE.test(value) ? judgeScaleValue(rule, ctx.spacing, value, 'Spacing') : null
    case 'off_scale_radius':
      return ctx.radius.length > 0 && SCALE_VALUE_RE.test(value) ? judgeScaleValue(rule, ctx.radius, value, 'Radius') : null
    case 'raw_interactive_element': {
      const tag = RAW_ELEMENT_RE.exec(value)?.[1]
      return tag && /\.(tsx|jsx)$/i.test(path) && !matchAny(path, ctx.componentGlobs) ? judgeRawElement(rule, tag) : null
    }
    case 'contrast_below_aa':
      return null
  }
}

// ── The scanner ──────────────────────────────────────────────────────────────

export interface ScanFileResult {
  findings: DevianceFinding[]
  lines: number
}

/** Run every enabled literal rule over one file. */
export function scanSourceFile(path: string, text: string, ctx: DevianceContext): ScanFileResult {
  const lang = langOf(path)
  const lines = text.length === 0 ? 0 : text.split('\n').length
  if (lang === 'other') return { findings: [], lines }
  const masked = maskComments(text, lang)
  const starts = lineIndex(text)
  const findings: DevianceFinding[] = []
  const active = (id: DesignRuleId): DesignRuleConfig | null => {
    const r = ctx.rules.get(id)
    if (!r || !r.enabled) return null
    if (r.allowFiles.length > 0 && matchAny(path, r.allowFiles)) return null
    return r
  }
  const push = (rule: DesignRuleConfig, offset: number, verdict: LiteralVerdict | null) => {
    if (!verdict) return
    const { line, col } = position(starts, offset)
    findings.push({ rule_id: rule.id, severity: rule.severity, file_path: path, line, col, value: verdict.value, message: verdict.message, suggestion: verdict.suggestion })
  }

  // Colours
  const colorRule = active('off_token_color')
  if (colorRule && ctx.colors.length > 0) {
    const seen = new Set<number>()
    const judge = (offset: number, literal: string) => {
      if (seen.has(offset)) return
      seen.add(offset)
      push(colorRule, offset, judgeColorLiteral(ctx, colorRule, literal))
    }
    // In JS/TS only literals inside a string count (`rgb(` in code is a call).
    // In CSS only literals in a value position count (`#add {` is a selector).
    const inValue = (at: number): boolean => {
      const before = masked.slice(Math.max(0, at - 80), at)
      if (lang === 'js') {
        if (!/['"`][^'"`\n]*$/.test(before)) return false
        return !ANCHOR_CONTEXT_RE.test(before.replace(/['"`][^'"`\n]*$/, ''))
      }
      if (/url\(\s*['"]?$/i.test(before)) return false
      const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
      return /[:(,]/.test(lineBefore)
    }
    for (const m of masked.matchAll(HEX_RE)) {
      const at = m.index ?? 0
      const prev = at > 0 ? masked[at - 1] : ' '
      if (!HEX_PREV_OK.test(prev) || !inValue(at)) continue
      // `#123` / `#1234` in prose is usually an issue number; in JS strings a
      // short hex only counts at the start of a value or after a CSS word.
      if (lang === 'js' && m[0].length <= 5 && /\s/.test(prev)) {
        const word = /([\w.%-]+)\s+$/.exec(masked.slice(Math.max(0, at - 30), at))?.[1] ?? ''
        if (!SHORT_HEX_AFTER.test(word)) continue
      }
      judge(at, m[0])
    }
    for (const m of masked.matchAll(COLOR_FN_RE)) {
      if (inValue(m.index ?? 0)) judge(m.index ?? 0, m[0])
    }
  }

  // Fonts
  const fontRule = active('off_token_font')
  if (fontRule && ctx.families.size > 0) {
    const check = (offset: number, list: string) => {
      if (/var\(|\$\{/.test(list)) return
      for (const fam of list.split(',')) {
        const name = fam.trim().replace(/^['"]|['"]$/g, '').replace(/_/g, ' ').trim()
        push(fontRule, offset, judgeFontName(ctx, fontRule, name))
      }
    }
    const re = lang === 'css' ? /font-family\s*:\s*([^;{}]+)/gi : /fontFamily\s*:\s*(['"`])([^'"`]+)\1/g
    for (const m of masked.matchAll(re)) check(m.index ?? 0, lang === 'css' ? m[1] : m[2])
    if (lang === 'js') {
      for (const m of masked.matchAll(/(?<![\w-])font-\[([^\]\s]+)\]/g)) check(m.index ?? 0, m[1].replace(/^['"]|['"]$/g, ''))
    }
  }

  // Spacing and radius share one shape: a property, a value list, a scale.
  const scaleRule = (
    id: 'off_scale_spacing' | 'off_scale_radius',
    scale: Array<{ token: DesignToken; px: number }>,
    cssProp: RegExp,
    jsProp: RegExp,
    twClass: RegExp,
    what: 'Spacing' | 'Radius',
  ) => {
    const rule = active(id)
    if (!rule || scale.length === 0) return
    const judge = (offset: number, raw: string) => push(rule, offset, judgeScaleValue(rule, scale, raw, what))
    if (lang === 'css') {
      for (const m of masked.matchAll(cssProp)) {
        const valueStart = (m.index ?? 0) + m[0].length - m[m.length - 1].length
        let local = 0
        for (const part of m[m.length - 1].split(/(\s+)/)) {
          if (/^-?[\d.]+(px|rem)$/.test(part)) judge(valueStart + local, part)
          local += part.length
        }
      }
    } else {
      for (const m of masked.matchAll(jsProp)) {
        const raw = m[2]
        judge((m.index ?? 0) + m[0].length - raw.length, /^-?[\d.]+$/.test(raw) ? `${raw}px` : raw)
      }
      for (const m of masked.matchAll(twClass)) judge(m.index ?? 0, m[m.length - 1])
    }
  }
  scaleRule(
    'off_scale_spacing',
    ctx.spacing,
    /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?\s*:\s*([^;{}]+)/gi,
    /\b(padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|paddingInline|paddingBlock|paddingStart|paddingEnd|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|marginInline|marginBlock|marginStart|marginEnd|gap|rowGap|columnGap)\s*:\s*['"]?(-?\d+(?:\.\d+)?(?:px|rem)?)(?![\w.%])/g,
    /(?<![\w-])-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-\[(-?[\d.]+(?:px|rem))\]/g,
    'Spacing',
  )
  scaleRule(
    'off_scale_radius',
    ctx.radius,
    /(?<![\w-])border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;{}]+)/gi,
    /\b(borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\s*:\s*['"]?(\d+(?:\.\d+)?(?:px|rem)?)(?![\w.%])/g,
    /(?<![\w-])rounded(?:-(?:t|r|b|l|tl|tr|bl|br|s|e|ss|se|es|ee))?-\[([\d.]+(?:px|rem))\]/g,
    'Radius',
  )

  // Raw interactive elements
  const rawRule = active('raw_interactive_element')
  if (rawRule && /\.(tsx|jsx)$/i.test(path) && !matchAny(path, ctx.componentGlobs)) {
    for (const m of masked.matchAll(/<(button|input|select|textarea)\b/g)) push(rawRule, m.index ?? 0, judgeRawElement(rawRule, m[1]))
  }

  return { findings, lines }
}

// ── Contrast ─────────────────────────────────────────────────────────────────

function stripBraces(ref: string): string {
  return ref.trim().replace(/^\{|\}$/g, '')
}

export function evaluateContrast(tokens: readonly DesignToken[], pairs: readonly ContrastPairDecl[]): ContrastPairResult[] {
  const byPath = new Map(tokens.map((t) => [t.path, t]))
  return pairs.map((p) => {
    const fgPath = stripBraces(p.fg)
    const bgPath = stripBraces(p.bg)
    const min = p.min ?? (p.large ? 3 : 4.5)
    const fg = byPath.get(fgPath)
    const bg = byPath.get(bgPath)
    const base = { fg: fgPath, bg: bgPath, min, use: p.use ?? null }
    const fc = fg?.hex ? parseCssColor(fg.hex) : null
    const bc = bg?.hex ? parseCssColor(bg.hex) : null
    if (!fc || !bc) {
      const missing = !fg ? fgPath : !bg ? bgPath : !fc ? fgPath : bgPath
      return { ...base, fgHex: fg?.hex ?? null, bgHex: bg?.hex ?? null, ratio: null, pass: null, problem: `${missing} is not a resolvable colour token` }
    }
    const ratio = contrastRatio(fc, bc)
    return { ...base, fgHex: fg!.hex, bgHex: bg!.hex, ratio, pass: ratio >= min, problem: null }
  })
}

/** Contrast failures as findings, pinned to the fg token's file. */
export function contrastFindings(results: readonly ContrastPairResult[], tokens: readonly DesignToken[], rule: DesignRuleConfig | undefined): DevianceFinding[] {
  if (!rule?.enabled) return []
  const byPath = new Map(tokens.map((t) => [t.path, t]))
  return results
    .filter((r) => r.pass === false)
    .map((r) => ({
      rule_id: 'contrast_below_aa' as const,
      severity: rule.severity,
      file_path: byPath.get(r.fg)?.file ?? null,
      line: null,
      col: null,
      value: `${r.fg} on ${r.bg}`,
      message: `${r.fg} on ${r.bg} is ${r.ratio}:1; it needs ${r.min}:1${r.use ? ` (${r.use})` : ''}.`,
      suggestion: null,
    }))
}

// ── Score ────────────────────────────────────────────────────────────────────

export interface ScoreInput {
  rules: readonly DesignRuleConfig[]
  counts: Partial<Record<DesignRuleId, number>>
  scannedLines: number
  scannedFiles: number
  applicable: Partial<Record<DesignRuleId, boolean>>
  contrast: { declared: number; failing: number }
}

export function computeDevianceScore(input: ScoreInput): { score: number | null; breakdown: DevianceBreakdownEntry[] } {
  const kloc = Math.max(1, input.scannedLines / 1000)
  let num = 0
  let den = 0
  const breakdown: DevianceBreakdownEntry[] = input.rules.map((r) => {
    const count = input.counts[r.id] ?? 0
    const weight = SEVERITY_WEIGHT[r.severity]
    let applicable = input.applicable[r.id] ?? false
    let density: number | null = null
    let penalty = 0
    if (r.id === 'contrast_below_aa') {
      applicable = applicable && input.contrast.declared > 0
      if (applicable) {
        density = input.contrast.failing / input.contrast.declared
        penalty = density
      }
    } else {
      // A literal rule cannot judge anything when no file was scanned.
      applicable = applicable && input.scannedFiles > 0
      if (applicable) {
        density = Math.round((count / kloc) * 1000) / 1000
        penalty = 1 - Math.exp(-(count / kloc) / DEVIANCE_K)
      }
    }
    if (r.enabled && applicable) {
      num += weight * penalty
      den += weight
    }
    return { rule: r.id, enabled: r.enabled, applicable, severity: r.severity, weight, count, density, penalty: Math.round(penalty * 1000) / 1000 }
  })
  return { score: den === 0 ? null : Math.round((100 * num) / den), breakdown }
}

/** Gate status from the findings that count (info never fails a gate). */
export function devianceStatus(findings: readonly Pick<DevianceFinding, 'severity'>[]): 'pass' | 'warn' | 'fail' {
  if (findings.some((f) => f.severity === 'error')) return 'fail'
  if (findings.some((f) => f.severity === 'warn')) return 'warn'
  return 'pass'
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warn: 1, info: 2 }

/** Stable ordering for storage and display: severity, then file, then line. */
export function sortFindings<T extends DevianceFinding>(findings: T[]): T[] {
  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.file_path ?? '').localeCompare(b.file_path ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.col ?? 0) - (b.col ?? 0),
  )
}
