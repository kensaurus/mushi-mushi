/**
 * FILE: packages/cli/src/recipe/manifest-shape.ts
 * PURPOSE: Read the design part of mushi.recipe.json into the shape the
 *          shared deviance engine takes (engine/design-scan.ts). The server
 *          validates the same fields with zod (recipe-schema.ts) and refuses
 *          a manifest that breaks them; here each such break is an `error`
 *          issue, so `mushi recipe check` fails where the push would.
 */

import type { DesignRuleDecl } from './engine/design-rules.ts'
import type { DesignScanManifest } from './engine/design-scan.ts'
import type { ContrastPairDecl, FindingSeverity } from './engine/design-engine-types.ts'
import type { DeclaredDirection } from './engine/design-set-plan.ts'

export interface LocalIssue {
  severity: 'info' | 'warn' | 'error'
  message: string
  path?: string
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)
const SEVERITIES: readonly FindingSeverity[] = ['info', 'warn', 'error']

/** `design.rules`, typed field by field; an unknown rule id is kept and ignored by the engine, as on the server. */
function readRules(raw: unknown, issues: LocalIssue[], where: string): Record<string, DesignRuleDecl> | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    issues.push({ severity: 'error', message: `${where} must be an object of rule settings.` })
    return undefined
  }
  const out: Record<string, DesignRuleDecl> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value)) {
      issues.push({ severity: 'error', message: `${where}.${id} must be an object.` })
      continue
    }
    const rule: DesignRuleDecl = {}
    if (value.enabled !== undefined) {
      if (typeof value.enabled === 'boolean') rule.enabled = value.enabled
      else issues.push({ severity: 'error', message: `${where}.${id}.enabled must be true or false.` })
    }
    if (value.severity !== undefined) {
      if (SEVERITIES.includes(value.severity as FindingSeverity)) rule.severity = value.severity as FindingSeverity
      else issues.push({ severity: 'error', message: `${where}.${id}.severity must be info, warn or error.` })
    }
    for (const key of ['allowValues', 'allowFiles'] as const) {
      if (value[key] === undefined) continue
      if (isStringList(value[key])) rule[key] = value[key] as string[]
      else issues.push({ severity: 'error', message: `${where}.${id}.${key} must be a list of strings.` })
    }
    if (value.primitives !== undefined) {
      if (isObject(value.primitives) && Object.values(value.primitives).every(isString)) rule.primitives = value.primitives as Record<string, string>
      else issues.push({ severity: 'error', message: `${where}.${id}.primitives must map element names to component names.` })
    }
    out[id] = rule
  }
  return out
}

function readContrast(raw: unknown, issues: LocalIssue[]): ContrastPairDecl[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    issues.push({ severity: 'error', message: 'design.contrast must be a list of { fg, bg } pairs.' })
    return undefined
  }
  const out: ContrastPairDecl[] = []
  raw.forEach((p, i) => {
    if (!isObject(p) || !isString(p.fg) || !isString(p.bg) || !p.fg || !p.bg) {
      issues.push({ severity: 'error', message: `design.contrast[${i}] needs fg and bg token paths.` })
      return
    }
    const pair: ContrastPairDecl = { fg: p.fg, bg: p.bg }
    if (typeof p.min === 'number' && p.min >= 1 && p.min <= 21) pair.min = p.min
    else if (p.min !== undefined) issues.push({ severity: 'error', message: `design.contrast[${i}].min must be a ratio from 1 to 21.` })
    if (typeof p.large === 'boolean') pair.large = p.large
    if (isString(p.use)) pair.use = p.use
    out.push(pair)
  })
  return out
}

/** The design fields the engine reads, with an error issue for each field the server would refuse. */
export function readScanManifest(manifest: Json): { manifest: DesignScanManifest; issues: LocalIssue[] } {
  const issues: LocalIssue[] = []
  if (manifest.design === undefined) return { manifest: {}, issues }
  if (!isObject(manifest.design)) {
    issues.push({ severity: 'error', message: '"design" must be an object.' })
    return { manifest: {}, issues }
  }
  const d = manifest.design
  const design: NonNullable<DesignScanManifest['design']> = {}

  if (d.tokens !== undefined) {
    const tokens: Array<{ path: string; role: 'source' | 'export'; generator?: string }> = []
    if (!Array.isArray(d.tokens)) issues.push({ severity: 'error', message: 'design.tokens must be a list.' })
    else d.tokens.forEach((t, i) => {
      if (!isObject(t) || !isString(t.path) || !t.path) {
        issues.push({ severity: 'error', message: `design.tokens[${i}] needs a path.` })
        return
      }
      if (t.role !== 'source' && t.role !== 'export') {
        issues.push({ severity: 'error', message: `design.tokens[${i}] (${t.path}) needs "role": "source" or "export".`, path: t.path })
        return
      }
      tokens.push({ path: t.path, role: t.role, ...(isString(t.generator) ? { generator: t.generator } : {}) })
    })
    design.tokens = tokens
  }

  if (d.directions !== undefined) {
    const dirs: DeclaredDirection[] = []
    if (!Array.isArray(d.directions)) issues.push({ severity: 'error', message: 'design.directions must be a list.' })
    else d.directions.forEach((x, i) => {
      if (!isObject(x) || !isString(x.name) || (x.status !== 'active' && x.status !== 'inactive') || !isStringList(x.tokens) || x.tokens.length === 0) {
        issues.push({ severity: 'error', message: `design.directions[${i}] needs a name, "status": "active" or "inactive", and its token paths.` })
        return
      }
      dirs.push({ name: x.name, status: x.status, tokens: x.tokens, ...(isString(x.note) ? { note: x.note } : {}) })
    })
    design.directions = dirs
  }

  if (d.components !== undefined) {
    if (isObject(d.components) && isStringList(d.components.globs)) design.components = { globs: d.components.globs }
    else issues.push({ severity: 'error', message: 'design.components needs "globs": a list of file globs.' })
  }

  if (d.literalScan !== undefined) {
    const ls = d.literalScan
    if (!isObject(ls) || (ls.globs !== undefined && !isStringList(ls.globs)) || (ls.ignore !== undefined && !isStringList(ls.ignore))) {
      issues.push({ severity: 'error', message: 'design.literalScan.globs and .ignore must be lists of file globs.' })
    } else {
      design.literalScan = { ...(ls.globs ? { globs: ls.globs as string[] } : {}), ...(ls.ignore ? { ignore: ls.ignore as string[] } : {}) }
    }
  }

  const contrast = readContrast(d.contrast, issues)
  if (contrast) design.contrast = contrast
  const rules = readRules(d.rules, issues, 'design.rules')
  if (rules) design.rules = rules
  return { manifest: { design }, issues }
}
