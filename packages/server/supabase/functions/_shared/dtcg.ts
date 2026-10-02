/**
 * FILE: packages/server/supabase/functions/_shared/dtcg.ts
 * PURPOSE: Parse and normalize W3C DTCG design-token files (Plan 019 decision
 *          2) into one flat, alias-resolved token list per set.
 *
 * Accepts the 2025.10 format plus the shorthand real repos still ship, and
 * records an `info` issue for each non-conformance instead of rejecting it:
 *   - legacy colour strings (`"#FAFAF8"`, `"rgba(0,0,0,.12)"`) and hex
 *     shorthand (`#abc`, `#abcd`) → `{colorSpace, components, hex}`;
 *   - legacy dimension / duration strings (`"16px"`, `"0.2s"`) → `{value, unit}`;
 *   - flat dotted keys (`"color.bg"`), which the spec forbids, → path segments;
 *   - `$type` inherited from groups (leaves often carry none);
 *   - aliases as `{a.b}` or `{"$ref": "#/a/b"}`, including aliases nested in
 *     composite values (typography, border, shadow); cycles are detected.
 *
 * All files of one set are merged BEFORE aliases resolve, because component,
 * semantic and primitive files alias across each other.
 */

import { parseCssColor, toHex } from './design-color.ts'
import type { DesignToken, RecipeIssue } from './recipe-types.ts'

export const MUSHI_EXTENSION_KEY = 'us.kensaur.mushi'

export interface TokenFileInput {
  path: string
  role: 'source' | 'export'
  text: string
}

export interface NormalizedTokenSet {
  tokens: DesignToken[]
  issues: RecipeIssue[]
}

interface RawToken {
  segments: string[]
  path: string
  rawValue: unknown
  type: string | null
  description: string | null
  ext: Record<string, unknown> | null
  file: string
  role: 'source' | 'export'
}

const ALIAS_RE = /^\{([^{}]+)\}$/
const MAX_ISSUES = 200

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function aliasTarget(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = ALIAS_RE.exec(v.trim())
    return m ? m[1].trim() : null
  }
  if (isPlainObject(v) && typeof v.$ref === 'string' && Object.keys(v).length === 1) {
    const ref = v.$ref.replace(/^#\/?/, '').replace(/\/\$value$/, '')
    return ref.split('/').filter(Boolean).join('.') || null
  }
  return null
}

/** Collect raw tokens from one parsed file, splitting dotted keys. */
function collect(
  node: Record<string, unknown>,
  segments: string[],
  inheritedType: string | null,
  file: TokenFileInput,
  out: RawToken[],
  issues: RecipeIssue[],
): void {
  const groupType = typeof node.$type === 'string' ? node.$type : inheritedType
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    if (!isPlainObject(child)) continue
    const keySegs = key.split('.').filter((s) => s.length > 0)
    if (keySegs.length > 1 && issues.length < MAX_ISSUES) {
      issues.push({ severity: 'info', code: 'token_nonconformant', message: `"${key}" uses dots in a name (DTCG 2025.10 forbids it); read as ${keySegs.join(' › ')}.`, path: [...segments, ...keySegs].join('.'), file: file.path })
    }
    const next = [...segments, ...keySegs]
    if ('$value' in child) {
      const ext = isPlainObject(child.$extensions) && isPlainObject(child.$extensions[MUSHI_EXTENSION_KEY])
        ? (child.$extensions[MUSHI_EXTENSION_KEY] as Record<string, unknown>)
        : null
      out.push({
        segments: next,
        path: next.join('.'),
        rawValue: child.$value,
        type: typeof child.$type === 'string' ? child.$type : groupType,
        description: typeof child.$description === 'string' ? child.$description : null,
        ext,
        file: file.path,
        role: file.role,
      })
    } else {
      collect(child, next, groupType, file, out, issues)
    }
  }
}

function inferType(v: unknown): string | null {
  if (typeof v === 'string') {
    if (/^#[0-9a-f]{3,8}$/i.test(v.trim()) || /^(rgba?|hsla?|oklch|oklab|hwb)\(/i.test(v.trim())) return 'color'
    if (/^-?[\d.]+(px|rem|em)$/.test(v.trim())) return 'dimension'
    if (/^-?[\d.]+(ms|s)$/.test(v.trim())) return 'duration'
  }
  if (typeof v === 'number') return 'number'
  if (isPlainObject(v) && 'colorSpace' in v) return 'color'
  if (isPlainObject(v) && 'unit' in v && 'value' in v) return 'dimension'
  return null
}

interface NormalizedValue {
  value: unknown
  display: string
  hex: string | null
  px: number | null
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

function normalizeColor(v: unknown, note: (code: string, msg: string) => void): NormalizedValue {
  if (typeof v === 'string') {
    const s = v.trim()
    if (/^#([0-9a-f]{3}|[0-9a-f]{4})$/i.test(s)) note('hex_shorthand', `"${s}" is hex shorthand; read as ${toHex(parseCssColor(s)!)}.`)
    const c = parseCssColor(s)
    if (!c) {
      note('color_unparseable', `"${s}" is not a colour Mushi can read.`)
      return { value: v, display: s, hex: null, px: null }
    }
    note('legacy_color_string', 'colour given as a string; DTCG 2025.10 uses {colorSpace, components}.')
    const hex = toHex(c)
    return { value: { colorSpace: 'srgb', components: [c.r, c.g, c.b], alpha: c.a, hex }, display: hex, hex, px: null }
  }
  if (isPlainObject(v)) {
    const alpha = typeof v.alpha === 'number' ? v.alpha : 1
    if (typeof v.hex === 'string') {
      const c = parseCssColor(v.hex)
      if (c) {
        const hex = toHex({ ...c, a: alpha })
        return { value: v, display: hex, hex, px: null }
      }
    }
    const comps = Array.isArray(v.components) ? v.components : null
    const space = typeof v.colorSpace === 'string' ? v.colorSpace.toLowerCase() : 'srgb'
    if (comps && comps.length === 3 && comps.every((x) => typeof x === 'number')) {
      const [a, b, c] = comps as number[]
      let rgba = null
      if (space === 'srgb' || space === 'display-p3') {
        if (space === 'display-p3') note('color_space_approximated', 'display-p3 shown as sRGB.')
        rgba = { r: a, g: b, b: c, a: alpha }
      } else if (space === 'oklch') {
        rgba = parseCssColor(`oklch(${a} ${b} ${c})`)
      } else if (space === 'oklab') {
        rgba = parseCssColor(`oklab(${a} ${b} ${c})`)
      } else if (space === 'hsl') {
        rgba = parseCssColor(`hsl(${a} ${b}% ${c}%)`)
      }
      if (rgba) {
        const hex = toHex({ ...rgba, a: alpha })
        return { value: v, display: hex, hex, px: null }
      }
    }
  }
  note('color_unparseable', 'colour value is not readable.')
  return { value: v, display: JSON.stringify(v), hex: null, px: null }
}

function normalizeMeasure(v: unknown, kind: 'dimension' | 'duration', note: (code: string, msg: string) => void): NormalizedValue {
  let value: number | null = null
  let unit: string | null = null
  if (typeof v === 'string') {
    const m = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(v.trim())
    if (m) {
      value = Number(m[1])
      unit = m[2] || (kind === 'dimension' ? 'px' : 'ms')
      note(kind === 'dimension' ? 'legacy_dimension_string' : 'legacy_duration_string', `"${v}" is a string; DTCG 2025.10 uses {value, unit}.`)
    }
  } else if (typeof v === 'number') {
    value = v
    unit = kind === 'dimension' ? 'px' : 'ms'
    note('unitless_number', `${v} has no unit; read as ${unit}.`)
  } else if (isPlainObject(v) && typeof v.value === 'number' && typeof v.unit === 'string') {
    value = v.value
    unit = v.unit
  }
  if (value == null || unit == null || !Number.isFinite(value)) {
    note(`${kind}_unparseable`, `${kind} value is not readable.`)
    return { value: v, display: typeof v === 'string' ? v : JSON.stringify(v), hex: null, px: null }
  }
  if (kind === 'duration' && unit === 's') {
    value = value * 1000
    unit = 'ms'
  }
  const px = kind === 'dimension' ? (unit === 'px' ? value : unit === 'rem' || unit === 'em' ? value * 16 : null) : null
  return { value: { value, unit }, display: `${fmtNum(value)}${unit}`, hex: null, px }
}

function displayOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return fmtNum(v)
  if (Array.isArray(v)) return v.map(displayOf).join(', ')
  if (isPlainObject(v)) {
    if (typeof v.hex === 'string') return v.hex
    if (typeof v.value === 'number' && typeof v.unit === 'string') return `${fmtNum(v.value)}${v.unit}`
  }
  return JSON.stringify(v)
}

function normalizeByType(type: string | null, v: unknown, note: (code: string, msg: string) => void): NormalizedValue {
  switch (type) {
    case 'color':
      return normalizeColor(v, note)
    case 'dimension':
      return normalizeMeasure(v, 'dimension', note)
    case 'duration':
      return normalizeMeasure(v, 'duration', note)
    case 'fontFamily': {
      const list = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : []
      return { value: list, display: list.join(', '), hex: null, px: null }
    }
    case 'cubicBezier': {
      const ok = Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number')
      if (!ok) note('cubicBezier_unparseable', 'cubicBezier needs four numbers.')
      return { value: v, display: ok ? `cubic-bezier(${(v as number[]).map(fmtNum).join(', ')})` : displayOf(v), hex: null, px: null }
    }
    case 'typography': {
      if (isPlainObject(v)) {
        const fam = displayOf(v.fontFamily)
        const size = displayOf(v.fontSize)
        const lh = v.lineHeight != null ? `/${displayOf(v.lineHeight)}` : ''
        const w = v.fontWeight != null ? ` ${displayOf(v.fontWeight)}` : ''
        return { value: v, display: `${size}${lh}${w} ${fam}`.trim(), hex: null, px: null }
      }
      return { value: v, display: displayOf(v), hex: null, px: null }
    }
    default:
      return { value: v, display: displayOf(v), hex: null, px: null }
  }
}

/**
 * Normalize every file of one set. Files are merged first (a later file
 * overriding a path wins, with a warning), then aliases resolve across them.
 */
export function normalizeTokenSet(files: readonly TokenFileInput[]): NormalizedTokenSet {
  const issues: RecipeIssue[] = []
  const raws: RawToken[] = []
  for (const file of files) {
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch (err) {
      issues.push({ severity: 'error', code: 'token_file_invalid_json', message: `not valid JSON: ${String(err).slice(0, 160)}`, file: file.path })
      continue
    }
    if (!isPlainObject(parsed)) {
      issues.push({ severity: 'error', code: 'token_file_not_object', message: 'a token file must be a JSON object', file: file.path })
      continue
    }
    collect(parsed, [], null, file, raws, issues)
  }

  const byPath = new Map<string, RawToken>()
  for (const r of raws) {
    const prev = byPath.get(r.path)
    if (prev && issues.length < MAX_ISSUES) {
      issues.push({ severity: 'warn', code: 'token_duplicate', message: `${r.path} is defined in ${prev.file} and ${r.file}; the later file wins.`, path: r.path, file: r.file })
    }
    byPath.set(r.path, r)
  }

  // Resolve a raw value, following aliases (top-level and nested).
  const resolved = new Map<string, { value: unknown; type: string | null } | null>()
  const resolving = new Set<string>()
  const resolveToken = (path: string, from: RawToken): { value: unknown; type: string | null } | null => {
    if (resolved.has(path)) return resolved.get(path)!
    const tok = byPath.get(path)
    if (!tok) {
      if (issues.length < MAX_ISSUES) issues.push({ severity: 'warn', code: 'alias_unresolved', message: `${from.path} points at {${path}}, which does not exist.`, path: from.path, file: from.file })
      return null
    }
    if (resolving.has(path)) {
      if (issues.length < MAX_ISSUES) issues.push({ severity: 'error', code: 'alias_cycle', message: `alias cycle through ${path}.`, path: from.path, file: from.file })
      return null
    }
    resolving.add(path)
    const value = resolveValue(tok.rawValue, tok)
    resolving.delete(path)
    const targetType = aliasTarget(tok.rawValue) ? resolved.get(aliasTarget(tok.rawValue)!)?.type ?? null : null
    const out = value === undefined ? null : { value, type: tok.type ?? targetType ?? inferType(value) }
    resolved.set(path, out)
    return out
  }
  const resolveValue = (v: unknown, owner: RawToken): unknown => {
    const target = aliasTarget(v)
    if (target) {
      const r = resolveToken(target, owner)
      return r ? r.value : undefined
    }
    if (Array.isArray(v)) return v.map((x) => resolveValue(x, owner))
    if (isPlainObject(v)) {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) o[k] = resolveValue(x, owner)
      return o
    }
    return v
  }

  const tokens: DesignToken[] = []
  for (const tok of byPath.values()) {
    const r = resolveToken(tok.path, tok)
    const alias = aliasTarget(tok.rawValue)
    let type = r?.type ?? tok.type ?? null
    if (!tok.type && !alias) {
      const inferred = inferType(tok.rawValue)
      if (inferred && issues.length < MAX_ISSUES) {
        issues.push({ severity: 'info', code: 'token_missing_type', message: `${tok.path} has no $type; read as ${inferred}.`, path: tok.path, file: tok.file })
      }
      type = type ?? inferred
    }
    const noted = new Set<string>()
    const note = (code: string, msg: string) => {
      // Only the token that literally holds the value reports its shorthand;
      // an alias reporting it again would double-count one fix.
      if (alias || noted.has(code) || issues.length >= MAX_ISSUES) return
      noted.add(code)
      issues.push({ severity: code.endsWith('unparseable') ? 'warn' : 'info', code, message: `${tok.path}: ${msg}`, path: tok.path, file: tok.file })
    }
    const norm = r ? normalizeByType(type, r.value, note) : { value: null, display: alias ? `{${alias}} (unresolved)` : 'unresolved', hex: null, px: null }
    const ext = tok.ext
    const str = (k: string) => (ext && typeof ext[k] === 'string' ? (ext[k] as string) : null)
    tokens.push({
      path: tok.path,
      type,
      value: norm.value,
      display: norm.display,
      hex: norm.hex,
      px: norm.px,
      aliasOf: alias,
      cssVar: str('cssVar'),
      ts: str('ts'),
      rn: str('rn'),
      description: tok.description,
      file: tok.file,
      role: tok.role,
      group: tok.segments[0] ?? '',
    })
  }
  tokens.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { tokens, issues }
}

/** Every font family named by fontFamily tokens and typography composites, lower-cased. */
export function declaredFontFamilies(tokens: readonly DesignToken[]): Set<string> {
  const out = new Set<string>()
  const add = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(add)
    else if (typeof v === 'string') v.split(',').forEach((f) => out.add(f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()))
  }
  for (const t of tokens) {
    if (t.type === 'fontFamily') add(t.value)
    else if (t.type === 'typography' && isPlainObject(t.value)) add(t.value.fontFamily)
  }
  out.delete('')
  return out
}

/** Stable JSON for hashing (sorted keys). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (isPlainObject(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}
