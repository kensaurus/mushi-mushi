/**
 * FILE: packages/server/supabase/functions/_shared/design-change.ts
 * PURPOSE: Pure edit builders for design-plane changes (Plan 019 Phase 1b):
 *          rewrite a token's `$value` in a DTCG source file, rewrite
 *          `design.rules` in mushi.recipe.json, and render a unified diff.
 *          No I/O; the route fetches files, checks the allowlist, and opens
 *          the draft PR.
 */

import { parseCssColor, toHex } from './design-color.ts'
import type { DesignRuleConfig, DesignRuleId, TokenEdit } from './recipe-types.ts'
import { DESIGN_RULE_IDS } from './recipe-types.ts'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Indentation of a JSON document (2 spaces by default). */
function detectIndent(text: string): string | number {
  const m = /\n([ \t]+)"/.exec(text)
  return m ? m[1] : 2
}

function serialize(obj: unknown, original: string): string {
  const body = JSON.stringify(obj, null, detectIndent(original))
  return original.endsWith('\n') ? `${body}\n` : body
}

/**
 * Find the token node for a dot path, tolerating flat dotted keys: at each
 * level the longest key that matches the next segments wins.
 */
export function findTokenNode(root: Record<string, unknown>, path: string): Record<string, unknown> | null {
  const segs = path.split('.')
  let node: Record<string, unknown> = root
  let i = 0
  while (i < segs.length) {
    let advanced = false
    for (let j = segs.length; j > i; j--) {
      const key = segs.slice(i, j).join('.')
      const child = node[key]
      if (isPlainObject(child)) {
        node = child
        i = j
        advanced = true
        break
      }
    }
    if (!advanced) return null
  }
  return '$value' in node ? node : null
}

export type ValueBuild = { ok: true; value: unknown } | { ok: false; reason: string }

/** Turn an edit value into a 2025.10 `$value` for the token's type. */
export function buildTokenValue(type: string | null, input: TokenEdit['value'], previous: unknown): ValueBuild {
  switch (type) {
    case 'color': {
      if (typeof input !== 'string') return { ok: false, reason: 'a colour needs a CSS colour string' }
      const c = parseCssColor(input)
      if (!c) return { ok: false, reason: `"${input}" is not a colour Mushi can read (use #RRGGBB, rgb(), hsl() or oklch())` }
      const round = (n: number) => Math.round(n * 10000) / 10000
      const value: Record<string, unknown> = { colorSpace: 'srgb', components: [round(c.r), round(c.g), round(c.b)] }
      if (c.a < 1) value.alpha = round(c.a)
      value.hex = toHex({ ...c, a: 1 })
      // Keep a legacy string file legacy: write the same shape it had.
      if (typeof previous === 'string') return { ok: true, value: toHex(c) }
      return { ok: true, value }
    }
    case 'dimension':
    case 'duration': {
      const s = typeof input === 'number' ? `${input}${type === 'dimension' ? 'px' : 'ms'}` : String(input).trim()
      const m = /^(-?\d+(?:\.\d+)?)\s*(px|rem|ms|s)$/.exec(s)
      if (!m) return { ok: false, reason: `"${s}" needs a number and a unit (${type === 'dimension' ? 'px or rem' : 'ms or s'})` }
      const unit = m[2]
      if (type === 'dimension' && unit !== 'px' && unit !== 'rem') return { ok: false, reason: 'a dimension unit is px or rem' }
      if (type === 'duration' && unit !== 'ms' && unit !== 's') return { ok: false, reason: 'a duration unit is ms or s' }
      if (typeof previous === 'string') return { ok: true, value: `${m[1]}${unit}` }
      return { ok: true, value: { value: Number(m[1]), unit } }
    }
    case 'number':
    case 'fontWeight': {
      const n = typeof input === 'number' ? input : Number(input)
      if (!Number.isFinite(n)) return { ok: false, reason: `"${input}" is not a number` }
      return { ok: true, value: n }
    }
    case 'fontFamily': {
      const list = Array.isArray(input) ? input.map(String) : String(input).split(',')
      const clean = list.map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      if (clean.length === 0 || clean.some((s) => s.length > 80)) return { ok: false, reason: 'a font family list needs 1+ names of at most 80 characters' }
      return { ok: true, value: typeof previous === 'string' ? clean.join(', ') : clean }
    }
    default:
      return { ok: false, reason: `editing ${type ?? 'untyped'} tokens from the console is not supported yet` }
  }
}

export interface TokenFileEdit {
  path: string
  /** The token's resolved type from the snapshot. */
  type: string | null
  value: TokenEdit['value']
}

export type ApplyResult = { ok: true; text: string } | { ok: false; reason: string }

/** Apply several edits to one token file's text. */
export function applyTokenEdits(fileText: string, edits: readonly TokenFileEdit[]): ApplyResult {
  let doc: unknown
  try {
    doc = JSON.parse(fileText)
  } catch {
    return { ok: false, reason: 'the token file on the default branch is not valid JSON' }
  }
  if (!isPlainObject(doc)) return { ok: false, reason: 'the token file is not a JSON object' }
  for (const e of edits) {
    const node = findTokenNode(doc, e.path)
    if (!node) return { ok: false, reason: `${e.path} is not in this file on the default branch (it may have moved since the last refresh)` }
    const raw = node.$value
    if (typeof raw === 'string' && /^\{[^{}]+\}$/.test(raw.trim())) {
      return { ok: false, reason: `${e.path} is an alias of ${raw.trim()}; edit that token instead` }
    }
    const built = buildTokenValue(e.type, e.value, raw)
    if (!built.ok) return { ok: false, reason: `${e.path}: ${built.reason}` }
    node.$value = built.value
  }
  return { ok: true, text: serialize(doc, fileText) }
}

export type RulePatch = Partial<Pick<DesignRuleConfig, 'enabled' | 'severity' | 'allowValues' | 'allowFiles' | 'primitives'>>

/** Write rule overrides into `design.rules` of mushi.recipe.json. */
export function applyRulesEdit(manifestText: string, patch: Partial<Record<DesignRuleId, RulePatch>>): ApplyResult {
  let doc: unknown
  try {
    doc = JSON.parse(manifestText)
  } catch {
    return { ok: false, reason: 'mushi.recipe.json on the default branch is not valid JSON' }
  }
  if (!isPlainObject(doc)) return { ok: false, reason: 'mushi.recipe.json is not a JSON object' }
  const design = isPlainObject(doc.design) ? doc.design : (doc.design = {}) as Record<string, unknown>
  const rules = isPlainObject(design.rules) ? design.rules : (design.rules = {}) as Record<string, unknown>
  for (const [id, p] of Object.entries(patch)) {
    if (!(DESIGN_RULE_IDS as readonly string[]).includes(id)) return { ok: false, reason: `${id} is not a design rule` }
    if (!p) continue
    if (p.severity && !['info', 'warn', 'error'].includes(p.severity)) return { ok: false, reason: `${id}: severity must be info, warn or error` }
    for (const k of ['allowValues', 'allowFiles'] as const) {
      const list = p[k]
      if (list !== undefined && (!Array.isArray(list) || list.length > 200 || list.some((v) => typeof v !== 'string' || v.length > 300))) {
        return { ok: false, reason: `${id}: ${k} must be a list of short strings` }
      }
    }
    const cur = isPlainObject(rules[id]) ? (rules[id] as Record<string, unknown>) : {}
    const next: Record<string, unknown> = { ...cur }
    if (p.enabled !== undefined) next.enabled = Boolean(p.enabled)
    if (p.severity !== undefined) next.severity = p.severity
    if (p.allowValues !== undefined) next.allowValues = p.allowValues.map((v) => v.trim()).filter(Boolean)
    if (p.allowFiles !== undefined) next.allowFiles = p.allowFiles.map((v) => v.trim()).filter(Boolean)
    if (p.primitives !== undefined && id === 'raw_interactive_element') next.primitives = p.primitives
    rules[id] = next
  }
  return { ok: true, text: serialize(doc, manifestText) }
}

// ── Unified diff ─────────────────────────────────────────────────────────────

export interface UnifiedDiff {
  diff: string
  additions: number
  deletions: number
}

/**
 * A small line diff (common prefix/suffix trim, LCS on the middle) rendered
 * as unified hunks with 3 lines of context. Fine for token files; the middle
 * is capped so a pathological rewrite degrades to delete-all/add-all.
 */
export function unifiedDiff(path: string, before: string, after: string, context = 3): UnifiedDiff {
  const a = before.split('\n')
  const b = after.split('\n')
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const am = a.slice(pre, a.length - suf)
  const bm = b.slice(pre, b.length - suf)
  type Op = { t: ' ' | '-' | '+'; s: string }
  const ops: Op[] = []
  if (am.length * bm.length <= 4_000_000) {
    const n = am.length, m = bm.length
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0, j = 0
    while (i < n && j < m) {
      if (am[i] === bm[j]) { ops.push({ t: ' ', s: am[i] }); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: am[i++] })
      else ops.push({ t: '+', s: bm[j++] })
    }
    while (i < n) ops.push({ t: '-', s: am[i++] })
    while (j < m) ops.push({ t: '+', s: bm[j++] })
  } else {
    am.forEach((s) => ops.push({ t: '-', s }))
    bm.forEach((s) => ops.push({ t: '+', s }))
  }
  const full: Op[] = [...a.slice(0, pre).map((s) => ({ t: ' ' as const, s })), ...ops, ...a.slice(a.length - suf).map((s) => ({ t: ' ' as const, s }))]
  const additions = full.filter((o) => o.t === '+').length
  const deletions = full.filter((o) => o.t === '-').length
  if (additions + deletions === 0) return { diff: '', additions: 0, deletions: 0 }

  const lines = [`--- a/${path}`, `+++ b/${path}`]
  const changed = full.map((o, k) => (o.t !== ' ' ? k : -1)).filter((k) => k >= 0)
  let k = 0
  while (k < changed.length) {
    let start = Math.max(0, changed[k] - context)
    let end = Math.min(full.length, changed[k] + context + 1)
    while (k + 1 < changed.length && changed[k + 1] - context <= end) {
      k++
      end = Math.min(full.length, changed[k] + context + 1)
    }
    let aLine = 1, bLine = 1
    for (let x = 0; x < start; x++) {
      if (full[x].t !== '+') aLine++
      if (full[x].t !== '-') bLine++
    }
    const hunk = full.slice(start, end)
    const aCount = hunk.filter((o) => o.t !== '+').length
    const bCount = hunk.filter((o) => o.t !== '-').length
    lines.push(`@@ -${aLine},${aCount} +${bLine},${bCount} @@`)
    for (const o of hunk) lines.push(`${o.t}${o.s}`)
    k++
    start = end
  }
  return { diff: lines.join('\n'), additions, deletions }
}
