import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRecipe, pushPayload, starterManifest } from './local.js'

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
    const m = starterManifest(root) as { design: { tokens: unknown }; ci: { workflows: unknown }; change: { allowPaths: unknown } }
    expect(m).toMatchObject({ version: 1, app: { name: 'glot', kind: 'app' }, data: { provider: 'supabase', migrationsDir: 'supabase/migrations' } })
    expect(m.design.tokens).toEqual([{ path: 'packages/design-tokens/semantic.tokens.json', role: 'source', format: 'dtcg-2025.10' }])
    expect(m.ci.workflows).toEqual({ 'ci.yml': { role: 'ci' } })
    expect(m.change.allowPaths).toEqual(['mushi.recipe.json', 'packages/design-tokens/**'])
  })
})

describe('checkRecipe', () => {
  it('flags colours that match no token with the server rule id, skips comments and colours that exist, and scores', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }], literalScan: { globs: ['src/**/*.tsx'] } } }),
      'tokens.json': TOKENS,
      'src/Button.tsx': 'const a = "#e8387f"\n// const b = "#123456"\nconst c = "#ff0000"\nconst d = "#fff"\n',
    })
    const r = checkRecipe(root)
    expect(r.ok).toBe(true)
    expect(r.tokenCount).toBe(2)
    expect(r.findings.map((f) => [f.rule_id, f.file_path, f.line, f.value])).toEqual([['off_token_color', 'src/Button.tsx', 3, '#ff0000']])
    expect(r.findings[0].suggestion).toMatchObject({ token: 'color.brand', value: '#E8387F' })
    expect(r.design).toMatchObject({ scannedFiles: 1, scannedLines: 5, set: 'default' })
    expect(r.design?.score).toEqual(expect.any(Number))
    expect(Object.keys(r.files).sort()).toEqual(['mushi.recipe.json', 'tokens.json'])
  })

  it('scans the server default globs when literalScan is not declared', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }] } }),
      'tokens.json': TOKENS,
      'app/page.tsx': 'export const x = "#000000"\n',
      'dist/bundle.js': 'const y = "#000000"\n',
    })
    const r = checkRecipe(root)
    expect(r.findings.map((f) => f.file_path)).toEqual(['app/page.tsx'])
  })

  it('fails on a missing manifest, a missing token file, a token entry without a role and an allowPaths entry that reaches workflows or env files', () => {
    expect(checkRecipe(repo({})).ok).toBe(false)
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'missing.json', role: 'source' }, { path: 'x.json' }] }, change: { allowPaths: ['.github/**', '.env.local'] } }),
    })
    const r = checkRecipe(root)
    expect(r.ok).toBe(false)
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([
      'change.allowPaths entry ".github/**" points at files Mushi never writes (workflows, lockfiles).',
      'change.allowPaths entry ".env.local" would let a PR touch env files.',
      'design.tokens[1] (x.json) needs "role": "source" or "export".',
      'missing.json is listed but does not exist.',
    ])
  })

  it('refuses rule settings the server schema would refuse', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }], rules: { off_token_color: { severity: 'loud' } } } }),
      'tokens.json': TOKENS,
    })
    const r = checkRecipe(root)
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.message)).toContain('design.rules.off_token_color.severity must be info, warn or error.')
  })

  it('reads hex values from both $value strings and colour objects', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }], literalScan: { globs: ['src/**/*.ts'] } } }),
      'tokens.json': TOKENS,
      'src/a.ts': 'const x = "#E8387F"\nconst y = "#FFFFFF"\nconst z = "#000000"\n',
    })
    expect(checkRecipe(root).findings.map((f) => f.value)).toEqual(['#000000'])
  })

  it('in a git checkout, scans tracked files only (as the server reads the commit)', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source' }] } }),
      'tokens.json': TOKENS,
      'src/tracked.ts': 'export const a = "#000000"\n',
    })
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    try {
      git('init', '-q')
      git('add', '.')
    } catch {
      return // no git on this machine: the walk fallback is covered above
    }
    writeFileSync(join(root, 'src', 'untracked.ts'), 'export const b = "#111111"\n')
    expect(checkRecipe(root).findings.map((f) => f.file_path)).toEqual(['src/tracked.ts'])
  })
})

describe('pushPayload', () => {
  it('sends literal findings with true counts and leaves contrast to the server', () => {
    const root = repo({
      'mushi.recipe.json': JSON.stringify({
        version: 1,
        design: { tokens: [{ path: 'tokens.json', role: 'source' }], contrast: [{ fg: 'color.brand', bg: 'color.bg' }], literalScan: { globs: ['src/**/*.ts'] } },
      }),
      'tokens.json': TOKENS,
      'src/a.ts': 'const x = "#000000"\nconst y = "#111111"\n',
    })
    const check = checkRecipe(root)
    expect(check.findings.some((f) => f.rule_id === 'contrast_below_aa')).toBe(true)
    const p = pushPayload(check, 1)!
    expect(p).toMatchObject({ engine: 1, scannedFiles: 1, counts: { off_token_color: 2 }, score: check.design!.score })
    expect(p.counts).not.toHaveProperty('contrast_below_aa')
    expect(p.findings).toHaveLength(1)
    expect(p.findings[0]).toMatchObject({ ruleId: 'off_token_color', filePath: 'src/a.ts', line: 1, value: '#000000' })
  })

  it('sends nothing when there was no scan', () => {
    expect(pushPayload(checkRecipe(repo({ 'mushi.recipe.json': '{"version":1}' })))).toBeNull()
  })
})
