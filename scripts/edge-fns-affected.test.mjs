import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affectedFunctions } from './edge-fns-affected.mjs'

const F = 'packages/server/supabase/functions'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'edge-fns-'))
  const put = (p, text) => {
    mkdirSync(join(root, p, '..'), { recursive: true })
    writeFileSync(join(root, p), text)
  }
  put(`${F}/_shared/a.ts`, "import { b } from './b.ts'\nexport const a = b")
  put(`${F}/_shared/b.ts`, 'export const b = 1')
  put(`${F}/_shared/card.json`, '{}')
  put(`${F}/_shared/notes.md`, 'x')
  put(`${F}/api/index.ts`, "import { a } from '../_shared/a.ts'\nimport card from '../_shared/card.json' with { type: 'json' }")
  put(`${F}/mcp/index.ts`, "const m = await import('../_shared/card.json', { with: { type: 'json' } })")
  put(`${F}/healthz/index.ts`, 'Deno.serve(() => new Response("ok"))')
  return root
}

test('a function directory change deploys that function only', () => {
  assert.deepEqual(affectedFunctions({ root: fixture(), changed: [`${F}/healthz/index.ts`] }), { all: false, functions: ['healthz'] })
})

test('a shared file deploys every function that imports it, also through other shared files', () => {
  assert.deepEqual(affectedFunctions({ root: fixture(), changed: [`${F}/_shared/b.ts`] }).functions, ['api'])
  assert.deepEqual(affectedFunctions({ root: fixture(), changed: [`${F}/_shared/card.json`] }).functions, ['api', 'mcp'])
})

test('changes the graph cannot see deploy everything', () => {
  const root = fixture()
  for (const p of [`${F}/_shared/notes.md`, 'packages/server/supabase/config.toml', '.github/workflows/deploy-edge-functions.yml', 'scripts/deploy-edge-function.mjs']) {
    assert.equal(affectedFunctions({ root, changed: [p] }).all, true, p)
  }
})

test('unrelated files and deleted functions deploy nothing', () => {
  assert.deepEqual(affectedFunctions({ root: fixture(), changed: ['apps/admin/src/x.ts', `${F}/gone/index.ts`] }), { all: false, functions: [] })
})
