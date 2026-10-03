/**
 * FILE: apps/admin/src/components/recipe/recipeChangeEdits.ts
 * PURPOSE: Pure helpers behind the recipe side panel's Change tab (gap #8).
 *          Each form edits one or two fixed files read from
 *          GET /recipe/sources and turns the draft into whole-file edits for
 *          POST /recipe/changes:
 *            • gates  → mushi.recipe.json `gates.budgets` and `gates.cadence`
 *            • env    → mushi.recipe.json `env.required` (NAMES only, never a
 *                       value) and, optionally, the keys of `.env.example`
 *            • routes → inventory.yaml as text
 *          The manifest is re-serialized with its own indentation and final
 *          newline (the same rule the server uses for design-rule edits), so
 *          an untouched standard-format file produces no diff.
 */

import type { RecipeChangeEdit, RecipeSourceFile } from '../../lib/recipeTypes'

export const MANIFEST_PATH = 'mushi.recipe.json'
export const ENV_EXAMPLE_PATH = '.env.example'
export const INVENTORY_PATH = 'inventory.yaml'
const MAX_FILE_CHARS = 512 * 1024

export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/
const METRIC_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const GATE_RE = /^[a-z][a-z0-9_]{0,59}$/
const ISO_DURATION_RE = /^P(?=\d|T\d)(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?)?$/i
const GH_ENV_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/

type Json = Record<string, unknown>

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── Manifest JSON ────────────────────────────────────────────────────────────

export type ParsedManifest = { ok: true; doc: Json } | { ok: false; error: string }

export function parseManifest(text: string | null): ParsedManifest {
  if (text === null) return { ok: false, error: 'mushi.recipe.json could not be read.' }
  try {
    const doc: unknown = JSON.parse(text)
    return isObj(doc) ? { ok: true, doc } : { ok: false, error: 'mushi.recipe.json is not a JSON object.' }
  } catch {
    return { ok: false, error: 'mushi.recipe.json on the default branch is not valid JSON.' }
  }
}

/** Indentation of a JSON document (2 spaces by default), as the server detects it. */
export function detectIndent(text: string): string | number {
  const m = /\n([ \t]+)"/.exec(text)
  return m ? m[1] : 2
}

export function serializeLike(doc: unknown, original: string): string {
  const body = JSON.stringify(doc, null, detectIndent(original))
  return original.endsWith('\n') ? `${body}\n` : body
}

// ── gates: budgets and cadence ───────────────────────────────────────────────

export interface BudgetRow {
  metric: string
  /** Kept as the typed text so a half-typed number is not lost. */
  limit: string
}

export interface CadenceRow {
  gate: string
  /** ISO 8601 duration, e.g. P1D or P7D. */
  every: string
}

export interface GatesDraft {
  budgets: BudgetRow[]
  cadence: CadenceRow[]
}

export function gatesDraftFrom(doc: Json): GatesDraft {
  const gates = isObj(doc.gates) ? doc.gates : {}
  const budgets = isObj(gates.budgets) ? gates.budgets : {}
  const cadence = isObj(gates.cadence) ? gates.cadence : {}
  return {
    budgets: Object.entries(budgets).map(([metric, v]) => ({ metric, limit: typeof v === 'number' ? String(v) : '' })),
    cadence: Object.entries(cadence).map(([gate, v]) => ({ gate, every: typeof v === 'string' ? v : '' })),
  }
}

export type ValidatedGates = { ok: true; budgets: Record<string, number>; cadence: Record<string, string> } | { ok: false; errors: string[] }

export function validateGates(draft: GatesDraft): ValidatedGates {
  const errors: string[] = []
  const budgets: Record<string, number> = {}
  for (const row of draft.budgets) {
    const metric = row.metric.trim()
    if (!metric && !row.limit.trim()) continue
    if (!METRIC_RE.test(metric)) { errors.push(`"${metric || '(empty)'}" is not a metric name (letters, digits, . _ : -).`); continue }
    const n = Number(row.limit.trim())
    if (!row.limit.trim() || !Number.isFinite(n)) { errors.push(`${metric}: the budget must be a number.`); continue }
    if (metric in budgets) { errors.push(`${metric} is listed twice.`); continue }
    budgets[metric] = n
  }
  const cadence: Record<string, string> = {}
  for (const row of draft.cadence) {
    const gate = row.gate.trim()
    const every = row.every.trim().toUpperCase()
    if (!gate && !every) continue
    if (!GATE_RE.test(gate)) { errors.push(`"${gate || '(empty)'}" is not a gate name (lowercase, digits, _).`); continue }
    if (!ISO_DURATION_RE.test(every)) { errors.push(`${gate}: use a duration like P1D (daily) or P7D (weekly).`); continue }
    if (gate in cadence) { errors.push(`${gate} is listed twice.`); continue }
    cadence[gate] = every
  }
  return errors.length ? { ok: false, errors } : { ok: true, budgets, cadence }
}

/** Replace `gates.budgets` / `gates.cadence`, dropping a key (and `gates`) that ends up empty. */
export function applyGates(text: string, budgets: Record<string, number>, cadence: Record<string, string>): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = parseManifest(text)
  if (!parsed.ok) return parsed
  const doc = parsed.doc
  const gates: Json = isObj(doc.gates) ? { ...doc.gates } : {}
  if (Object.keys(budgets).length) gates.budgets = budgets
  else delete gates.budgets
  if (Object.keys(cadence).length) gates.cadence = cadence
  else delete gates.cadence
  if (Object.keys(gates).length) doc.gates = gates
  else delete doc.gates
  return { ok: true, text: serializeLike(doc, text) }
}

// ── env: names only ──────────────────────────────────────────────────────────

export interface EnvRow {
  name: string
  /** Checked in the repo's Actions secrets and variables. */
  actions: boolean
  /** Read at runtime by the app (not checked by Mushi). */
  runtime: boolean
  /** GitHub deployment environments, comma-separated as typed. */
  githubEnvironments: string
  /**
   * The entry as the manifest has it, or null for a new row. Fields Mushi does
   * not edit (`environments`, notes…) and the key order are carried through.
   */
  original: Json | null
}

const GH_ENV_PREFIX = 'github-environment:'
/** What the GitHub connector assumes when an entry has no `in`. */
const DEFAULT_IN = ['github-actions']

export function envRowsFrom(doc: Json): EnvRow[] {
  const env = isObj(doc.env) ? doc.env : {}
  const required = Array.isArray(env.required) ? env.required : []
  return required.filter((e): e is Json => isObj(e) && typeof e.name === 'string').map((e) => {
    const where = Array.isArray(e.in) ? e.in.filter((x): x is string => typeof x === 'string') : DEFAULT_IN
    return {
      name: String(e.name),
      actions: where.includes('github-actions'),
      runtime: where.includes('runtime'),
      githubEnvironments: where.filter((w) => w.startsWith(GH_ENV_PREFIX)).map((w) => w.slice(GH_ENV_PREFIX.length)).join(', '),
      original: e,
    }
  })
}

export function newEnvRow(): EnvRow {
  return { name: '', actions: true, runtime: false, githubEnvironments: '', original: null }
}

export type ValidatedEnv = { ok: true; required: Json[]; names: string[] } | { ok: false; errors: string[] }

export function validateEnv(rows: readonly EnvRow[]): ValidatedEnv {
  const errors: string[] = []
  const required: Json[] = []
  const names: string[] = []
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    if (!ENV_NAME_RE.test(name)) { errors.push(`"${name}" is not an env name: use CAPITALS, digits and _ (a name, never a value).`); continue }
    if (names.includes(name)) { errors.push(`${name} is listed twice.`); continue }
    const envs = row.githubEnvironments.split(',').map((s) => s.trim()).filter(Boolean)
    const badEnv = envs.find((e) => !GH_ENV_RE.test(e))
    if (badEnv) { errors.push(`${name}: "${badEnv}" is not a GitHub environment name.`); continue }
    const where = [...(row.actions ? ['github-actions'] : []), ...(row.runtime ? ['runtime'] : []), ...envs.map((e) => `${GH_ENV_PREFIX}${e}`)]
    if (where.length === 0) { errors.push(`${name}: pick at least one place it must be set.`); continue }
    names.push(name)
    const next: Json = row.original ? { ...row.original, name, in: where } : { name, in: where }
    // An entry that relied on the default location keeps relying on it: no churn in the diff.
    const unchangedDefault = row.original && !('in' in row.original) && where.length === DEFAULT_IN.length && where.every((w, i) => w === DEFAULT_IN[i])
    if (unchangedDefault) delete next.in
    required.push(next)
  }
  return errors.length ? { ok: false, errors } : { ok: true, required, names }
}

export function applyEnv(text: string, required: Json[]): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = parseManifest(text)
  if (!parsed.ok) return parsed
  const doc = parsed.doc
  const env: Json = isObj(doc.env) ? { ...doc.env } : {}
  if (required.length) env.required = required
  else delete env.required
  if (Object.keys(env).length) doc.env = env
  else delete doc.env
  return { ok: true, text: serializeLike(doc, text) }
}

const EXAMPLE_KEY_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

export function exampleKeys(text: string | null): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => EXAMPLE_KEY_RE.exec(l)?.[1]).filter((k): k is string => Boolean(k))
}

/**
 * `.env.example` with a `NAME=` line for every declared name it lacks, and the
 * lines of names removed from the recipe dropped. Existing lines (and their
 * placeholder values) are kept as they are; Mushi never writes a value.
 */
export function syncEnvExample(text: string | null, names: readonly string[], removed: readonly string[]): string {
  const original = text ?? ''
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original === '' ? [] : original.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const drop = new Set(removed.filter((n) => !names.includes(n)))
  const kept = lines.filter((l) => {
    const k = EXAMPLE_KEY_RE.exec(l)?.[1]
    return !k || !drop.has(k)
  })
  const have = new Set(exampleKeys(kept.join('\n')))
  for (const n of names) if (!have.has(n)) kept.push(`${n}=`)
  return kept.length ? `${kept.join(eol)}${eol}` : ''
}

// ── Edits for POST /recipe/changes ───────────────────────────────────────────

export type BuiltEdits = { ok: true; edits: RecipeChangeEdit[] } | { ok: false; errors: string[] }

function fileOf(files: readonly RecipeSourceFile[], path: string): RecipeSourceFile | null {
  return files.find((f) => f.path === path) ?? null
}

function editFor(file: RecipeSourceFile, content: string, reason: string): RecipeChangeEdit | null {
  if (file.exists && file.content === content) return null
  return { path: file.path, content, reason, baseSha: file.exists ? file.sha : null }
}

export function buildGatesEdits(files: readonly RecipeSourceFile[], draft: GatesDraft): BuiltEdits {
  const manifest = fileOf(files, MANIFEST_PATH)
  if (!manifest?.content) return { ok: false, errors: ['mushi.recipe.json could not be read.'] }
  const v = validateGates(draft)
  if (!v.ok) return v
  const applied = applyGates(manifest.content, v.budgets, v.cadence)
  if (!applied.ok) return { ok: false, errors: [applied.error] }
  const edit = editFor(manifest, applied.text, 'update gate budgets and cadence')
  return { ok: true, edits: edit ? [edit] : [] }
}

export function buildEnvEdits(files: readonly RecipeSourceFile[], rows: readonly EnvRow[], opts: { syncExample: boolean }): BuiltEdits {
  const manifest = fileOf(files, MANIFEST_PATH)
  if (!manifest?.content) return { ok: false, errors: ['mushi.recipe.json could not be read.'] }
  const parsed = parseManifest(manifest.content)
  if (!parsed.ok) return { ok: false, errors: [parsed.error] }
  const before = envRowsFrom(parsed.doc).map((r) => r.name)
  const v = validateEnv(rows)
  if (!v.ok) return v
  const applied = applyEnv(manifest.content, v.required)
  if (!applied.ok) return { ok: false, errors: [applied.error] }
  const edits: RecipeChangeEdit[] = []
  const m = editFor(manifest, applied.text, 'update the declared env names')
  if (m) edits.push(m)
  const example = fileOf(files, ENV_EXAMPLE_PATH)
  if (opts.syncExample && example && example.writable && (example.content !== null || !example.exists)) {
    const removed = before.filter((n) => !v.names.includes(n))
    const next = syncEnvExample(example.content, v.names, removed)
    const e = editFor(example, next, 'list the declared env names (no values)')
    if (e && (example.exists || next !== '')) edits.push(e)
  }
  return { ok: true, edits }
}

export function buildRoutesEdits(files: readonly RecipeSourceFile[], text: string): BuiltEdits {
  const inv = fileOf(files, INVENTORY_PATH)
  if (!inv) return { ok: false, errors: ['inventory.yaml is not available.'] }
  if (!text.trim()) return { ok: false, errors: ['inventory.yaml cannot be empty.'] }
  if (text.length > MAX_FILE_CHARS) return { ok: false, errors: ['inventory.yaml is over 512 KB.'] }
  const edit = editFor(inv, text, 'update inventory.yaml (pages, stories, actions)')
  return { ok: true, edits: edit ? [edit] : [] }
}
