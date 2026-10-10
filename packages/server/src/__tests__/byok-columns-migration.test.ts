/**
 * resolveLlmKey (_shared/byok.ts) selects project_settings byok_* columns by
 * name. byok_openai_base_url and the anthropic/openai test-status columns
 * existed only on the hosted project, so self-host and Helm databases built
 * from the migrations errored on that select until 20261010133000.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = resolve(__dirname, '../../supabase/migrations')
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(resolve(dir, f), 'utf8').replace(/--[^\n]*/g, ''))
  .join('\n')
  .toLowerCase()
const byok = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/byok.ts'), 'utf8')

describe('project_settings BYOK columns', () => {
  it('every byok_* column byok.ts names is created by a migration', () => {
    const columns = [...new Set([...byok.matchAll(/'(byok_[a-z]+_(?:key_ref|base_url|test_status|tested_at))'/g)].map((m) => m[1]))]
    expect(columns).toEqual(expect.arrayContaining(['byok_openai_base_url', 'byok_anthropic_test_status', 'byok_openai_test_status']))
    const missing = columns.filter((c) => !new RegExp(`add column (if not exists )?${c}\\b`).test(migrations))
    expect(missing).toEqual([])
  })

  it('adds the tested_at columns the key-test route writes', () => {
    for (const c of ['byok_openai_tested_at', 'byok_anthropic_tested_at']) {
      expect(migrations).toMatch(new RegExp(`add column if not exists ${c}\\s+timestamptz`))
    }
  })
})
