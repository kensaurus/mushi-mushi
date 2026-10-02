import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRecipe, starterManifest } from './local.js'

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

function repo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'mushi-recipe-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const TOKENS = JSON.stringify({ color: { $type: 'color', brand: { $value: '#E8387F' }, bg: { $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' } } } })

describe('starterManifest', () => {
  it('guesses kind, token files, migrations and workflows from the repo', () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'glot', dependencies: { '@capacitor/core': '7' } }),
      'capacitor.config.ts': 'export default {}',
      'packages/design-tokens/semantic.tokens.json': TOKENS,
      'supabase/migrations/20261001000000_a.sql': 'select 1;',
      '.github/workflows/ci.yml': 'on: push',
    })
    const m = starterManifest(root) as Record<string, any>
    expect(m).toMatchObject({ version: 1, app: { name: 'glot', kind: 'app' }, data: { provider: 'supabase', migrationsDir: 'supabase/migrations' } })
    expect(m.design.tokens).toEqual([{ path: 'packages/design-tokens/semantic.tokens.json', role: 'source', format: 'dtcg-2025.10' }])
    expect(m.ci.workflows).toEqual({ 'ci.yml': { role: 'ci' } })
    expect(m.change.allowPaths).toEqual(['mushi.recipe.json', 'packages/design-tokens/**'])
  })
})

describe('checkRecipe', () => {
  it('finds colour literals that match no token, and skips comments and tokens that exist', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }], literalScan: { globs: ['src/**/*.tsx'] } } }),
      'tokens.json': TOKENS,
      'src/Button.tsx': 'const a = "#e8387f"\n// const b = "#123456"\nconst c = "#ff0000"\nconst d = "#fff"\n',
    })
    const r = checkRecipe(root)
    expect(r.ok).toBe(true)
    expect(r.tokenCount).toBe(2)
    expect(r.findings).toEqual([{ ruleId: 'off_token_literal', filePath: 'src/Button.tsx', line: 3, value: '#ff0000' }])
    expect(Object.keys(r.files).sort()).toEqual(['mushi.recipe.json', 'tokens.json'])
  })

  it('fails on a missing manifest, a missing token file and an allowPaths entry that reaches workflows or env files', () => {
    expect(checkRecipe(repo({})).ok).toBe(false)
    const root = repo({ 'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'missing.json' }] }, change: { allowPaths: ['.github/**', '.env.local'] } }) })
    const r = checkRecipe(root)
    expect(r.ok).toBe(false)
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(3)
  })

  it('reads hex values from both $value strings and colour objects', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }], literalScan: { globs: ['src/**/*.ts'] } } }),
      'tokens.json': TOKENS,
      'src/a.ts': 'const x = "#E8387F"\nconst y = "#FFFFFF"\nconst z = "#000000"\n',
    })
    expect(checkRecipe(root).findings.map((f) => f.value)).toEqual(['#000000'])
  })
})
