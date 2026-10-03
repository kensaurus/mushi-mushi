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

  it('reads a monorepo: skips fixture tokens, scans app and package sources, finds nested migrations, tags deploy workflows', () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'mono' }),
      'packages/brand/tokens/brand.tokens.json': TOKENS,
      'packages/server/src/__tests__/fixtures/other/dtcg/tokens.json': TOKENS,
      'examples/demo/theme.tokens.json': TOKENS,
      'apps/admin/src/App.tsx': 'export const A = 1',
      'packages/ui/src/button.css': '.b{}',
      'packages/server/supabase/migrations/20261001000000_a.sql': 'select 1;',
      '.github/workflows/ci.yml': 'on: push',
      '.github/workflows/deploy-admin.yml': 'on: push',
      '.github/workflows/release.yml': 'on: push',
    })
    const m = starterManifest(root) as {
      design: { tokens: Array<{ path: string }>; literalScan: { globs: string[] } }
      data: { migrationsDir: string }
      ci: { defaultBranch: string; workflows: Record<string, { role: string }> }
    }
    expect(m.design.tokens.map((t) => t.path)).toEqual(['packages/brand/tokens/brand.tokens.json'])
    expect(m.design.literalScan.globs.sort()).toEqual(['apps/admin/src/**/*.{ts,tsx,css}', 'packages/ui/src/**/*.{ts,tsx,css}'])
    expect(m.data.migrationsDir).toBe('packages/server/supabase/migrations')
    expect(m.ci.workflows).toEqual({ 'ci.yml': { role: 'ci' }, 'deploy-admin.yml': { role: 'deploy' }, 'release.yml': { role: 'deploy' } })
  })

  it('takes the default branch from origin/HEAD when the clone records one', () => {
    const root = repo({ 'package.json': '{}', '.github/workflows/ci.yml': 'on: push' })
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    git('init', '-q')
    git('update-ref', 'refs/remotes/origin/master', '4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master')
    expect((starterManifest(root) as { ci: { defaultBranch: string } }).ci.defaultBranch).toBe('master')
  })

  it('sees the whole repo, not the first 5,000 files a walk reaches', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'big' }),
      'packages/design-tokens/dtcg/tokens.json': TOKENS,
      'supabase/migrations/20261001000000_a.sql': 'select 1;',
    }
    // Sorts before packages/ and supabase/, so a capped walk spends its budget here first.
    for (let i = 0; i < 5_001; i++) files[`aaa/f${i}.txt`] = ''
    const m = starterManifest(repo(files)) as { design?: { tokens: Array<{ path: string }> }; data?: { migrationsDir: string } }
    expect(m.design?.tokens.map((t) => t.path)).toEqual(['packages/design-tokens/dtcg/tokens.json'])
    expect(m.data?.migrationsDir).toBe('supabase/migrations')
  })

  it('in a git checkout, lists tracked files only, as recipe check and the server do', () => {
    const root = repo({ 'package.json': JSON.stringify({ name: 'g' }), 'tokens/brand.tokens.json': TOKENS })
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    try {
      git('init', '-q')
      git('add', '.')
    } catch {
      return // no git on this machine: the walk fallback is covered above
    }
    mkdirSync(join(root, 'scratch'), { recursive: true })
    writeFileSync(join(root, 'scratch', 'draft.tokens.json'), TOKENS)
    expect((starterManifest(root) as { design: { tokens: Array<{ path: string }> } }).design.tokens.map((t) => t.path)).toEqual(['tokens/brand.tokens.json'])
  })

  it('scans a root-level app and its declared workspaces, and skips archived folders', () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'glot.it', workspaces: ['packages/api', 'packages/core', 'packages/design-tokens'], scripts: { dev: 'next dev', build: 'next build' } }),
      'next.config.ts': 'export default {}',
      'app/page.tsx': 'export default function P() { return null }',
      'components/Button.tsx': 'export const B = 1',
      'features/learn/View.tsx': 'export const V = 1',
      'lib/util.ts': 'export const u = 1',
      'packages/api/package.json': '{}',
      'packages/api/src/index.ts': 'export const a = 1',
      'packages/core/package.json': '{}',
      'packages/core/src/Card.tsx': 'export const C = 1',
      'packages/design-tokens/package.json': '{}',
      'packages/design-tokens/src/cross-platform-tokens.css': ':root{}',
      'packages/design-tokens/dtcg/tokens.json': TOKENS,
      'apps/mobile/ARCHIVED.md': 'retired',
      'apps/mobile/package.json': '{}',
      'apps/mobile/src/App.tsx': 'export const A = 1',
      'apps/mobile/src/theme/old.tokens.json': TOKENS,
      'apps/mobile-v2/ARCHIVED.md': 'retired',
      'apps/mobile-v2/src/App.tsx': 'export const A = 1',
    })
    const m = starterManifest(root) as { design: { tokens: Array<{ path: string }>; literalScan: { globs: string[] } } }
    expect(m.design.tokens.map((t) => t.path)).toEqual(['packages/design-tokens/dtcg/tokens.json'])
    expect(m.design.literalScan.globs).toEqual([
      'app/**/*.{ts,tsx,css}',
      'components/**/*.{ts,tsx,css}',
      'features/**/*.{ts,tsx,css}',
      'lib/**/*.{ts,tsx,css}',
      'packages/core/src/**/*.{ts,tsx,css}',
      'packages/design-tokens/src/**/*.{ts,tsx,css}',
    ])
  })

  it('reads pnpm-workspace.yaml globs and their negations, and skips an archived workspace', () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'mono' }),
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"packages/*\"\n  - '!packages/legacy'\nonlyBuiltDependencies: []\n",
      'brand.tokens.json': TOKENS,
      'apps/site/package.json': '{}',
      'apps/site/pages/index.tsx': 'export const I = 1',
      'packages/ui/package.json': '{}',
      'packages/ui/src/button.css': '.b{}',
      'packages/legacy/package.json': '{}',
      'packages/legacy/src/old.tsx': 'export const O = 1',
      'packages/ui-mobile/package.json': '{}',
      'packages/ui-mobile/ARCHIVED.md': 'retired',
      'packages/ui-mobile/src/View.tsx': 'export const V = 1',
    })
    const m = starterManifest(root) as { design: { literalScan: { globs: string[] } } }
    expect(m.design.literalScan.globs).toEqual(['apps/site/**/*.{ts,tsx,css}', 'packages/ui/src/**/*.{ts,tsx,css}'])
  })

  it('marks a generated token export with its generator and keeps its folder out of change.allowPaths', () => {
    const generator = [
      'const OUT_PATH = join(ROOT, "packages/design-tokens/dtcg/tokens.json");',
      'if (process.argv.includes("--check")) process.exit(0);',
      'writeFileSync(OUT_PATH, json);',
    ].join('\n')
    const root = repo({
      'package.json': JSON.stringify({ name: 'glot.it', scripts: { 'tokens:dtcg': 'node scripts/export-dtcg-tokens.mjs', 'tokens:dtcg:check': 'node scripts/export-dtcg-tokens.mjs --check' } }),
      'scripts/export-dtcg-tokens.mjs': generator,
      // Mentions the path but only reads it: not a generator.
      'scripts/check-token-mirror.mjs': 'readFileSync("design/brand.tokens.json")',
      'packages/design-tokens/dtcg/tokens.json': TOKENS,
      'design/brand.tokens.json': TOKENS,
    })
    const m = starterManifest(root) as { design: { tokens: unknown[] }; change: { allowPaths: string[] } }
    expect(m.design.tokens).toEqual([
      { path: 'design/brand.tokens.json', role: 'source', format: 'dtcg-2025.10' },
      { path: 'packages/design-tokens/dtcg/tokens.json', role: 'export', generator: 'npm run tokens:dtcg', format: 'dtcg-2025.10' },
    ])
    expect(m.change.allowPaths).toEqual(['mushi.recipe.json', 'design/**'])
    // The manifest it writes passes recipe check's role validation.
    writeFileSync(join(root, 'mushi.recipe.json'), JSON.stringify(m))
    expect(checkRecipe(root).issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('names the generator with the lockfile’s package manager, and marks a token only a --check script references as an export', () => {
    const pnpmRoot = repo({
      'package.json': JSON.stringify({ name: 'p', scripts: { tokens: 'style-dictionary build --out tokens/dtcg/tokens.json' } }),
      'pnpm-lock.yaml': '',
      'tokens/dtcg/tokens.json': TOKENS,
    })
    expect((starterManifest(pnpmRoot) as { design: { tokens: unknown[] } }).design.tokens).toEqual([
      { path: 'tokens/dtcg/tokens.json', role: 'export', generator: 'pnpm tokens', format: 'dtcg-2025.10' },
    ])
    rmSync(pnpmRoot, { recursive: true, force: true })

    const checkRoot = repo({
      'package.json': JSON.stringify({ name: 'c', scripts: { 'verify:tokens': 'node scripts/verify-tokens.mjs --check' } }),
      'scripts/verify-tokens.mjs': 'const t = readFileSync("theme.tokens.json")',
      'theme.tokens.json': TOKENS,
    })
    const m = starterManifest(checkRoot) as { design: { tokens: unknown[] }; change: { allowPaths: string[] } }
    expect(m.design.tokens).toEqual([{ path: 'theme.tokens.json', role: 'export', format: 'dtcg-2025.10' }])
    expect(m.change.allowPaths).toEqual(['mushi.recipe.json'])
  })

  it('tags a workflow deploy when its steps upload or publish, whatever its name', () => {
    const root = repo({
      'package.json': '{}',
      '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      # npm publish happens in another workflow\n      - run: npm test\n',
      '.github/workflows/build-mobile-capacitor.yml': 'steps:\n  - uses: r0adkll/upload-google-play@v1\n',
      '.github/workflows/ios.yml': 'steps:\n  - run: xcrun altool --upload-app -f app.ipa\n',
      '.github/workflows/web.yml': 'steps:\n  - run: aws s3 sync out s3://bucket --delete\n',
      '.github/workflows/edge.yml': 'steps:\n  - run: supabase functions deploy api\n',
      '.github/workflows/ota.yml': 'steps:\n  - run: npx @capgo/cli bundle upload\n',
      '.github/workflows/pages.yml': 'steps:\n  - run: npx wrangler deploy\n',
      '.github/workflows/preview.yml': 'steps:\n  - run: npx vercel deploy --prebuilt\n',
      '.github/workflows/npm.yml': 'steps:\n  - run: pnpm changeset publish\n',
    })
    expect((starterManifest(root) as { ci: { workflows: Record<string, { role: string }> } }).ci.workflows).toEqual({
      'build-mobile-capacitor.yml': { role: 'deploy' },
      'ci.yml': { role: 'ci' },
      'edge.yml': { role: 'deploy' },
      'ios.yml': { role: 'deploy' },
      'npm.yml': { role: 'deploy' },
      'ota.yml': { role: 'deploy' },
      'pages.yml': { role: 'deploy' },
      'preview.yml': { role: 'deploy' },
      'web.yml': { role: 'deploy' },
    })
  })

  it('finds the env template under .env.local.example, .env.sample or .env.template, preferring .env.example', () => {
    for (const name of ['.env.local.example', '.env.sample', '.env.template']) {
      const m = starterManifest(repo({ 'package.json': '{}', [name]: 'API_URL=\n' })) as { env?: { example: string } }
      expect(m.env?.example).toBe(name)
      rmSync(dir!, { recursive: true, force: true })
    }
    const both = starterManifest(repo({ 'package.json': '{}', '.env.example': 'A=\n', '.env.local.example': 'A=\n' })) as { env?: { example: string } }
    expect(both.env?.example).toBe('.env.example')
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
