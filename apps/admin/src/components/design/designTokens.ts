/**
 * FILE: apps/admin/src/components/design/designTokens.ts
 * PURPOSE: Pure helpers for the Design system page (Plan 019 §1.2, Phase 1b):
 *          sort DTCG tokens into visual sections, decide which tokens may be
 *          edited (and say why not), parse edit input into the wire value,
 *          turn token values into inline CSS, and split unified diffs.
 *
 *          Every colour shown on the page comes from token DATA (`hex`), never
 *          from a literal in this source tree.
 */

import type {
  DesignEditability,
  DesignRuleConfig,
  DesignRuleId,
  DesignToken,
  FindingSeverity,
  TokenEdit,
  TokenType,
} from '../../lib/recipeTypes'

// ── Sections ────────────────────────────────────────────────────────────────

export type TokenSection = 'color' | 'type' | 'spacing' | 'radius' | 'motion' | 'other'

export const TOKEN_SECTION_LABEL: Record<TokenSection, string> = {
  color: 'Colour',
  type: 'Type scale',
  spacing: 'Spacing',
  radius: 'Radius',
  motion: 'Motion',
  other: 'Other tokens',
}

const TOKEN_SECTION_ORDER: readonly TokenSection[] = ['color', 'type', 'spacing', 'radius', 'motion', 'other']

const FONT_SIZE_HINT = /(^|\.)(font|fontsize|fontsizes|text|type|typography)(\.|$)|font-?size/i
const RADIUS_HINT = /radius|radii|rounded|corner/i
const SPACING_HINT = /space|spacing|gap|inset|gutter|size|sizes|padding|margin/i

/** @internal Exported for tests; the page uses `sectionTokens`. */
export function tokenSection(t: DesignToken): TokenSection {
  const type = t.type ?? null
  if (type === 'color' || (type === null && t.hex)) return 'color'
  if (type === 'fontFamily' || type === 'fontWeight' || type === 'typography') return 'type'
  if (type === 'duration' || type === 'cubicBezier' || type === 'transition') return 'motion'
  if (type === 'dimension') {
    const where = `${t.group}.${t.path}`
    if (RADIUS_HINT.test(where)) return 'radius'
    if (FONT_SIZE_HINT.test(where)) return 'type'
    if (SPACING_HINT.test(where)) return 'spacing'
    return 'spacing'
  }
  return 'other'
}

/** Section → group → tokens, preserving server order inside each group. */
export function sectionTokens(tokens: DesignToken[]): Array<{
  section: TokenSection
  groups: Array<{ group: string; tokens: DesignToken[] }>
}> {
  const bySection = new Map<TokenSection, Map<string, DesignToken[]>>()
  for (const t of tokens) {
    const section = tokenSection(t)
    let groups = bySection.get(section)
    if (!groups) {
      groups = new Map()
      bySection.set(section, groups)
    }
    const key = t.group || 'ungrouped'
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  return TOKEN_SECTION_ORDER.filter((s) => bySection.has(s)).map((section) => ({
    section,
    groups: [...(bySection.get(section) ?? new Map<string, DesignToken[]>()).entries()].map(([group, list]) => ({
      group,
      tokens: list,
    })),
  }))
}

// ── Editing ─────────────────────────────────────────────────────────────────

const EDITABLE_TYPES = new Set(['color', 'dimension', 'duration', 'number', 'fontFamily'])

/** Null when the token may be edited; otherwise the reason it may not. */
export function tokenEditBlocker(token: DesignToken, editable: DesignEditability): string | null {
  if (!editable.enabled) return editable.reason ?? 'Editing is off for this project.'
  if (!token.type || !EDITABLE_TYPES.has(token.type)) {
    return 'Only colour, dimension, duration, number and font-family tokens can be edited here.'
  }
  if (token.role === 'export') return 'This token lives in a generated file. Edit its source file instead.'
  if (!editable.tokenFiles.includes(token.file)) {
    return `${token.file} is not one of the files a change may write.`
  }
  return null
}

export function initialEditText(token: DesignToken): string {
  if (token.type === 'fontFamily' && Array.isArray(token.value)) {
    return token.value.filter((v): v is string => typeof v === 'string').join(', ')
  }
  if (token.type === 'color' && token.hex) return token.hex
  return token.display
}

export type ParsedEdit = { ok: true; value: TokenEdit['value'] } | { ok: false; error: string }

export function parseEditValue(type: TokenType | null, raw: string): ParsedEdit {
  const text = raw.trim()
  if (text.length === 0) return { ok: false, error: 'Enter a value.' }
  switch (type) {
    case 'color':
      return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)
        ? { ok: true, value: text.toUpperCase() }
        : { ok: false, error: 'Use #RRGGBB or #RRGGBBAA.' }
    case 'dimension':
      return /^-?\d+(?:\.\d+)?(?:px|rem)$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, error: 'Use a px or rem value, such as 12px or 0.75rem.' }
    case 'duration':
      return /^\d+(?:\.\d+)?(?:ms|s)$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, error: 'Use ms or s, such as 220ms.' }
    case 'number': {
      const n = Number(text)
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'Enter a number.' }
    }
    case 'fontFamily': {
      const families = text
        .split(',')
        .map((f) => f.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      return families.length > 0
        ? { ok: true, value: families }
        : { ok: false, error: 'Enter at least one family name.' }
    }
    default:
      return { ok: false, error: 'This token type cannot be edited here.' }
  }
}

export function editKey(edit: Pick<TokenEdit, 'path' | 'set'>): string {
  return `${edit.set ?? ''}::${edit.path}`
}

export function formatEditValue(value: TokenEdit['value']): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

// ── Values → CSS ────────────────────────────────────────────────────────────

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

function quoteFamily(f: string): string {
  const name = f.trim().replace(/^["']|["']$/g, '')
  if (GENERIC_FAMILIES.has(name)) return name
  return `"${name.replace(/"/g, '')}"`
}

/** A safe CSS `font-family` list from a token value (string, list, or display). */
export function cssFontFamily(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    if (parts.length > 0) return parts.map(quoteFamily).join(', ')
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(',').map(quoteFamily).join(', ')
  }
  return fallback ? fallback.split(',').map(quoteFamily).join(', ') : 'inherit'
}

/** px from a number, `"16px"`, `"1rem"`, or a DTCG 2025.10 `{ value, unit }`. */
export function dimensionPx(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)(px|rem|em)?$/.exec(v.trim())
    if (!m) return null
    const n = Number(m[1])
    return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n
  }
  if (v && typeof v === 'object' && 'value' in v) {
    const o = v as { value: unknown; unit?: unknown }
    if (typeof o.value !== 'number') return null
    return o.unit === 'rem' || o.unit === 'em' ? o.value * 16 : o.value
  }
  return null
}

export interface TypographyParts {
  family: string
  sizePx: number | null
  weight: string | number | null
  lineHeight: number | null
}

export function typographyParts(token: DesignToken): TypographyParts {
  const v = token.value
  if (token.type === 'typography' && v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const weight = typeof o.fontWeight === 'number' || typeof o.fontWeight === 'string' ? o.fontWeight : null
    const lh = typeof o.lineHeight === 'number' ? o.lineHeight : null
    return { family: cssFontFamily(o.fontFamily), sizePx: dimensionPx(o.fontSize), weight, lineHeight: lh }
  }
  if (token.type === 'fontFamily') {
    return { family: cssFontFamily(v, token.display), sizePx: null, weight: null, lineHeight: null }
  }
  if (token.type === 'fontWeight') {
    const w = typeof v === 'number' || typeof v === 'string' ? v : null
    return { family: 'inherit', sizePx: null, weight: w, lineHeight: null }
  }
  return { family: 'inherit', sizePx: token.px ?? dimensionPx(v), weight: null, lineHeight: null }
}

export function cubicBezierString(token: DesignToken): string {
  const v = token.value
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')) {
    return `cubic-bezier(${v.join(', ')})`
  }
  return token.display
}

/** Clamp a sample size so one huge token cannot break the layout. */
export function clampPx(px: number | null, max: number): { px: number | null; clamped: boolean } {
  if (px === null || !Number.isFinite(px)) return { px: null, clamped: false }
  if (px > max) return { px: max, clamped: true }
  return { px: Math.max(px, 0), clamped: false }
}

// ── Diffs ───────────────────────────────────────────────────────────────────

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

export function parseUnifiedDiff(diff: string): Array<{ kind: DiffLineKind; text: string }> {
  return diff.split('\n').map((text) => {
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index ')) {
      return { kind: 'meta' as const, text }
    }
    if (text.startsWith('@@')) return { kind: 'hunk' as const, text }
    if (text.startsWith('+')) return { kind: 'add' as const, text }
    if (text.startsWith('-')) return { kind: 'del' as const, text }
    return { kind: 'ctx' as const, text }
  })
}

// ── Contrast + deviance formatting ──────────────────────────────────────────

export function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—'
  return `${ratio.toFixed(2)}:1`
}

// ── Rules ───────────────────────────────────────────────────────────────────

export interface RuleDraft {
  enabled: boolean
  severity: FindingSeverity
  allowValues: string
  allowFiles: string
  primitives: string
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function serializePrimitives(p: Record<string, string> | undefined): string {
  if (!p) return ''
  return Object.entries(p)
    .map(([el, comp]) => `${el}=${comp}`)
    .join(', ')
}

function parsePrimitives(text: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {}
  for (const part of splitList(text)) {
    const [el, comp, ...rest] = part.split('=').map((s) => s.trim())
    if (!el || !comp || rest.length > 0) {
      return { ok: false, error: `"${part}" should look like element=Component, e.g. button=Btn.` }
    }
    out[el] = comp
  }
  return { ok: true, value: out }
}

export function ruleToDraft(rule: DesignRuleConfig): RuleDraft {
  return {
    enabled: rule.enabled,
    severity: rule.severity,
    allowValues: rule.allowValues.join(', '),
    allowFiles: rule.allowFiles.join(', '),
    primitives: serializePrimitives(rule.primitives),
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export type RuleChange = Partial<Pick<DesignRuleConfig, 'enabled' | 'severity' | 'allowValues' | 'allowFiles' | 'primitives'>>

/** Only the fields that changed; `null` when nothing did. Throws nothing — invalid primitives return an error. */
export function diffRuleDraft(
  rule: DesignRuleConfig,
  draft: RuleDraft,
): { ok: true; change: RuleChange | null } | { ok: false; error: string } {
  const change: RuleChange = {}
  if (draft.enabled !== rule.enabled) change.enabled = draft.enabled
  if (draft.severity !== rule.severity) change.severity = draft.severity
  const values = splitList(draft.allowValues)
  if (!sameList(values, rule.allowValues)) change.allowValues = values
  const files = splitList(draft.allowFiles)
  if (!sameList(files, rule.allowFiles)) change.allowFiles = files
  if (rule.id === 'raw_interactive_element') {
    const parsed = parsePrimitives(draft.primitives)
    if (!parsed.ok) return parsed
    if (serializePrimitives(parsed.value) !== serializePrimitives(rule.primitives)) {
      change.primitives = parsed.value
    }
  }
  return { ok: true, change: Object.keys(change).length > 0 ? change : null }
}

const RULE_LABEL: Record<DesignRuleId, string> = {
  off_token_color: 'Off-token colour',
  off_token_font: 'Off-token font',
  off_scale_spacing: 'Off-scale spacing',
  off_scale_radius: 'Off-scale radius',
  contrast_below_aa: 'Contrast below AA',
  raw_interactive_element: 'Raw interactive element',
}

export function ruleLabel(id: string): string {
  return Object.prototype.hasOwnProperty.call(RULE_LABEL, id) ? RULE_LABEL[id as DesignRuleId] : id
}
