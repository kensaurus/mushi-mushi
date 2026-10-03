/**
 * FILE: apps/admin/src/components/recipe/recipeChangeEdits.test.ts
 * PURPOSE: The Change tab's file edits: an untouched manifest produces no
 *          diff, only the edited key moves, indentation and the final newline
 *          survive, env edits carry names only, and every edit carries the
 *          SHA it was read at.
 */

import { describe, expect, it } from 'vitest'
import type { RecipeSourceFile } from '../../lib/recipeTypes'
import {
  applyGates,
  buildEnvEdits,
  buildGatesEdits,
  buildRoutesEdits,
  envRowsFrom,
  exampleKeys,
  gatesDraftFrom,
  newEnvRow,
  parseManifest,
  syncEnvExample,
  validateEnv,
  validateGates,
} from './recipeChangeEdits'

const doc = {
  version: 1,
  app: { name: 'glot.it' },
  gates: { budgets: { 'bundle.web.gzip_kb': 300 }, cadence: { dead_handler: 'P1D' } },
  env: { required: [{ name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', environments: ['production'] }, { name: 'SENTRY_DSN', in: ['runtime'], note: 'host only' }] },
  change: { allowPaths: ['mushi.recipe.json', '.env.example'] },
}
const STANDARD = `${JSON.stringify(doc, null, 2)}\n`

function file(path: string, content: string | null, extra: Partial<RecipeSourceFile> = {}): RecipeSourceFile {
  return { path, exists: content !== null, content, sha: content === null ? null : `sha-${path}`, writable: true, reason: null, ...extra }
}

function manifestOnly(text = STANDARD): RecipeSourceFile[] {
  return [file('mushi.recipe.json', text)]
}

function changedLines(a: string, b: string): string[] {
  const x = a.split('\n')
  const y = b.split('\n')
  return y.filter((l, i) => l !== x[i])
}

describe('gates', () => {
  it('an untouched standard-format manifest produces no edit', () => {
    const parsed = parseManifest(STANDARD)
    if (!parsed.ok) throw new Error('fixture')
    const built = buildGatesEdits(manifestOnly(), gatesDraftFrom(parsed.doc))
    expect(built).toEqual({ ok: true, edits: [] })
  })

  it('changing one budget changes only that line, keeps the newline, and sends the base SHA', () => {
    const built = buildGatesEdits(manifestOnly(), { budgets: [{ metric: 'bundle.web.gzip_kb', limit: '250' }], cadence: [{ gate: 'dead_handler', every: 'P1D' }] })
    if (!built.ok) throw new Error(built.errors.join())
    expect(built.edits).toHaveLength(1)
    const edit = built.edits[0]
    expect(edit).toMatchObject({ path: 'mushi.recipe.json', baseSha: 'sha-mushi.recipe.json' })
    expect(changedLines(STANDARD, edit.content)).toEqual(['      "bundle.web.gzip_kb": 250'])
    expect(edit.content.endsWith('}\n')).toBe(true)
  })

  it('keeps a 4-space indent and no final newline when the file had none', () => {
    const four = JSON.stringify(doc, null, 4)
    const r = applyGates(four, { 'bundle.web.gzip_kb': 280 }, { dead_handler: 'P1D' })
    if (!r.ok) throw new Error(r.error)
    expect(r.text).toBe(four.replace('300', '280'))
  })

  it('removing every budget and cadence drops the gates key', () => {
    const r = applyGates(STANDARD, {}, {})
    if (!r.ok) throw new Error(r.error)
    expect(JSON.parse(r.text)).not.toHaveProperty('gates')
  })

  it('refuses a metric that is not a name, a budget that is not a number, a duration it cannot read, and duplicates', () => {
    const v = validateGates({
      budgets: [{ metric: 'bad metric', limit: '1' }, { metric: 'ok.metric', limit: 'lots' }, { metric: 'a', limit: '1' }, { metric: 'a', limit: '2' }],
      cadence: [{ gate: 'dead_handler', every: 'daily' }, { gate: '', every: '' }],
    })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.errors).toHaveLength(4)
    expect(validateGates({ budgets: [{ metric: '', limit: '' }], cadence: [{ gate: 'crawl', every: 'p7d' }] })).toEqual({ ok: true, budgets: {}, cadence: { crawl: 'P7D' } })
  })

  it('says why when the manifest is not JSON', () => {
    expect(buildGatesEdits(manifestOnly('{ nope'), { budgets: [], cadence: [] })).toEqual({ ok: false, errors: [expect.stringMatching(/not valid JSON/)] })
  })
})

describe('env (names only)', () => {
  const parsed = parseManifest(STANDARD)
  if (!parsed.ok) throw new Error('fixture')
  const rows = envRowsFrom(parsed.doc)

  it('reads where each name must be set, with no value anywhere', () => {
    expect(rows.map(({ original: _o, ...r }) => r)).toEqual([
      { name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', actions: true, runtime: false, githubEnvironments: '' },
      { name: 'SENTRY_DSN', actions: false, runtime: true, githubEnvironments: '' },
    ])
    expect(Object.keys(newEnvRow())).not.toContain('value')
  })

  it('an untouched env produces no edit, and an entry that relied on the default location keeps relying on it', () => {
    const built = buildEnvEdits(manifestOnly(), rows, { syncExample: false })
    expect(built).toEqual({ ok: true, edits: [] })
  })

  it('adding a GitHub environment writes it into `in` and keeps the entry’s other fields and key order', () => {
    const next = rows.map((r, i) => (i === 0 ? { ...r, githubEnvironments: 'production, preview' } : r))
    const v = validateEnv(next)
    if (!v.ok) throw new Error(v.errors.join())
    expect(Object.keys(v.required[0])).toEqual(['name', 'environments', 'in'])
    expect(v.required[0].in).toEqual(['github-actions', 'github-environment:production', 'github-environment:preview'])
    expect(v.required[1]).toEqual({ name: 'SENTRY_DSN', in: ['runtime'], note: 'host only' })
  })

  it('refuses a lower-case name, a duplicate, and a name set nowhere', () => {
    const v = validateEnv([
      { ...newEnvRow(), name: 'api_key' },
      { ...newEnvRow(), name: 'A' },
      { ...newEnvRow(), name: 'A' },
      { ...newEnvRow(), name: 'B', actions: false },
    ])
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.errors).toHaveLength(3)
  })

  it('also lists new names in .env.example without values, keeps existing placeholder lines, and drops removed names', () => {
    const example = file('.env.example', '# app\nSENTRY_DSN=https://example.invalid\nNEXT_PUBLIC_MUSHI_PROJECT_ID=\n')
    const next = [rows[0], { ...newEnvRow(), name: 'NEW_FLAG' }]
    const built = buildEnvEdits([...manifestOnly(), example], next, { syncExample: true })
    if (!built.ok) throw new Error(built.errors.join())
    expect(built.edits.map((e) => e.path)).toEqual(['mushi.recipe.json', '.env.example'])
    const ex = built.edits[1]
    expect(ex.content).toBe('# app\nNEXT_PUBLIC_MUSHI_PROJECT_ID=\nNEW_FLAG=\n')
    expect(ex.baseSha).toBe('sha-.env.example')
  })

  it('creates .env.example when the repo has none, with baseSha null', () => {
    const built = buildEnvEdits([...manifestOnly(), file('.env.example', null)], [...rows, { ...newEnvRow(), name: 'X' }], { syncExample: true })
    if (!built.ok) throw new Error(built.errors.join())
    expect(built.edits[1]).toMatchObject({ path: '.env.example', baseSha: null, content: 'NEXT_PUBLIC_MUSHI_PROJECT_ID=\nSENTRY_DSN=\nX=\n' })
  })

  it('syncEnvExample keeps CRLF files CRLF and reads export lines', () => {
    expect(syncEnvExample('export A=1\r\n', ['A', 'B'], [])).toBe('export A=1\r\nB=\r\n')
    expect(exampleKeys('export A=1\n# B=2\nC =3')).toEqual(['A', 'C'])
  })
})

describe('routes', () => {
  it('an unchanged inventory produces no edit; a change carries the SHA; a new file carries null', () => {
    const inv = file('inventory.yaml', 'schema_version: 2\n')
    expect(buildRoutesEdits([inv], 'schema_version: 2\n')).toEqual({ ok: true, edits: [] })
    const built = buildRoutesEdits([inv], 'schema_version: 2\npages: []\n')
    expect(built).toMatchObject({ ok: true, edits: [{ path: 'inventory.yaml', baseSha: 'sha-inventory.yaml' }] })
    expect(buildRoutesEdits([file('inventory.yaml', null)], 'pages: []\n')).toMatchObject({ ok: true, edits: [{ baseSha: null }] })
    expect(buildRoutesEdits([inv], '   ')).toEqual({ ok: false, errors: ['inventory.yaml cannot be empty.'] })
  })
})
