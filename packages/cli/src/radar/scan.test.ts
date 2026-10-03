import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isClientSafeMatch, MAX_PUSH_FINDINGS, scanBuiltBundles, scanLocalRepo, toIngestBody, type BundleScan, type LocalRadarScan } from './scan.js'

const NO_BUNDLE: BundleScan = { roots: [], scannedFiles: 0, truncated: false, unreadable: 0, findings: [] }

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

function repo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'mushi-radar-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

describe('scanLocalRepo', () => {
  it('finds storage deletes done in SQL, skips node_modules, and gathers only build-config files', () => {
    const root = repo({
      'supabase/migrations/20260101_cleanup.sql': 'select 1;\n-- delete from storage.objects;\ndelete from storage.objects where bucket_id = \'old\';\n',
      'node_modules/pkg/x.sql': 'delete from storage.objects;\n',
      'android/variables.gradle': 'ext {\n  targetSdkVersion = 35\n}\n',
      '.github/workflows/ci.yml': 'jobs: {}\n',
      'src/secret.env.ts': 'export const k = 1\n',
    })
    const scan = scanLocalRepo(root)
    expect(scan.findings).toHaveLength(1)
    expect(scan.findings[0]).toMatchObject({ filePath: 'supabase/migrations/20260101_cleanup.sql', line: 3, ruleId: 'storage_sql_delete' })
    expect(Object.keys(scan.configFiles).sort()).toEqual(['.github/workflows/ci.yml', 'android/variables.gradle'])
  })

  it('pushes rule ids, paths and lines only, never the matched code', () => {
    const root = repo({ 'x.sql': 'DELETE FROM "storage"."objects" WHERE true;\n' })
    const body = toIngestBody(scanLocalRepo(root), 'abcdef1234')
    expect(body).toEqual({ commitSha: 'abcdef1234', scanned: ['storage_sql_delete'], findings: [{ ruleId: 'storage_sql_delete', filePath: 'x.sql', line: 1 }], files: {} })
    expect(toIngestBody(scanLocalRepo(root), 'not-a-sha')).not.toHaveProperty('commitSha')
    expect(body).not.toHaveProperty('partial')
  })

  it('marks the rule partial when the scan hit the file limit, so Mushi never records a pass', () => {
    const body = toIngestBody({ scannedFiles: 20_000, truncated: true, unreadable: 0, findings: [], configFiles: {}, bundle: NO_BUNDLE }, null)
    expect(body).toMatchObject({ scanned: ['storage_sql_delete'], partial: ['storage_sql_delete'] })
    expect(toIngestBody({ scannedFiles: 5, truncated: false, unreadable: 1, findings: [], configFiles: {}, bundle: NO_BUNDLE }, null)).toHaveProperty('partial')
    expect(toIngestBody({ scannedFiles: 0, truncated: false, unreadable: 0, findings: [], configFiles: {}, bundle: NO_BUNDLE }, null)).toHaveProperty('partial')
  })

  it('counts a file that cannot be read and marks the push partial, instead of aborting or passing', () => {
    const root = repo({ 'ok.sql': 'select 1;\n', 'locked.sql': 'delete from storage.objects;\n' })
    const scan = scanLocalRepo(root, (p) => { if (p.endsWith('locked.sql')) throw new Error('EACCES'); return readFileSync(p, 'utf8') })
    expect(scan).toMatchObject({ scannedFiles: 1, unreadable: 1, findings: [] })
    expect(toIngestBody(scan, null)).toMatchObject({ partial: ['storage_sql_delete'] })
  })

  it('throws on a --dir that does not exist instead of reporting nothing found', () => {
    expect(() => scanLocalRepo(join(tmpdir(), 'mushi-radar-does-not-exist-9f3c'))).toThrow()
  })
})

const jwt = (payload: Record<string, unknown>) =>
  ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.')

describe('key_in_client_bundle', () => {
  it('scans built output only, flags real secrets and skips keys that are public by design', () => {
    const openai = 'sk-' + 'Q'.repeat(30)
    const root = repo({
      'src/config.ts': `export const k = "${'sk-' + 'S'.repeat(30)}"\n`,
      'dist/assets/index-abc.js': `var a=1;\nvar o="${openai}",anon="${jwt({ role: 'anon' })}",m="mushi_${'x'.repeat(30)}";\n`,
      'apps/web/.next/static/chunks/main.js': `const s="${jwt({ role: 'service_role' })}"\n`,
      'apps/web/.next/server/app.js': `const s="${'sk_live_' + 'z'.repeat(20)}"\n`,
      'dist/server/index.js': `const k="${'sk_live_' + 'y'.repeat(20)}"\n`,
      'dist/assets/index-abc.js.map': `"${openai}"`,
      'node_modules/pkg/dist/x.js': `"${openai}"`,
    })
    const b = scanBuiltBundles(root)
    expect(b.roots).toEqual(['apps/web/.next/static', 'dist'])
    expect(b.findings).toEqual([
      { filePath: 'apps/web/.next/static/chunks/main.js', line: 1, label: 'JWT' },
      { filePath: 'dist/assets/index-abc.js', line: 2, label: 'OpenAI-style key' },
    ])
  })

  it('pushes where and which kind of key, never the key, and leaves the rule out when nothing is built', () => {
    const secret = 'sk_live_' + 'k'.repeat(20)
    const built = toIngestBody(scanLocalRepo(repo({ 'build/static/js/main.js': `x="${secret}"\n`, 'a.sql': 'select 1;\n' })), null)
    expect(built.scanned).toEqual(['storage_sql_delete', 'key_in_client_bundle'])
    expect(built.findings).toEqual([{ ruleId: 'key_in_client_bundle', filePath: 'build/static/js/main.js', line: 1, kind: 'Stripe live key' }])
    expect(JSON.stringify(built)).not.toContain(secret)
    rmSync(dir!, { recursive: true, force: true })
    const unbuilt = toIngestBody(scanLocalRepo(repo({ 'a.sql': 'select 1;\n' })), null)
    expect(unbuilt.scanned).toEqual(['storage_sql_delete'])
  })

  it('marks the bundle check partial when a built file could not be read', () => {
    const root = repo({ 'dist/a.js': 'x', 'dist/b.js': 'y' })
    const b = scanBuiltBundles(root, (p) => { if (p.endsWith('b.js')) throw new Error('EACCES'); return readFileSync(p, 'utf8') })
    expect(b).toMatchObject({ scannedFiles: 1, unreadable: 1 })
    expect(toIngestBody({ scannedFiles: 1, truncated: false, unreadable: 0, findings: [], configFiles: {}, bundle: b }, null)).toMatchObject({ partial: ['key_in_client_bundle'] })
  })

  it('finds the client output of Nuxt, SvelteKit and the Vercel build output, never their server folders', () => {
    const leak = `x="${'sk_live_' + 'n'.repeat(20)}"\n`
    const root = repo({
      'apps/nuxt/.output/public/_nuxt/entry.js': leak,
      'apps/nuxt/.output/server/index.mjs': leak,
      'apps/kit/.svelte-kit/output/client/_app/start.js': leak,
      'apps/kit/.svelte-kit/output/server/index.js': leak,
      '.vercel/output/static/assets/app.js': leak,
      '.vercel/output/functions/api.func/index.js': leak,
    })
    const b = scanBuiltBundles(root)
    expect(b.roots).toEqual(['.vercel/output/static', 'apps/kit/.svelte-kit/output/client', 'apps/nuxt/.output/public'])
    expect(b.findings.map((f) => f.filePath).sort()).toEqual([
      '.vercel/output/static/assets/app.js',
      'apps/kit/.svelte-kit/output/client/_app/start.js',
      'apps/nuxt/.output/public/_nuxt/entry.js',
    ])
  })

  it('--bundle-dir replaces discovery (a server dist stays out), and a missing or outside folder is an error', () => {
    const leak = `x="${'sk_live_' + 'm'.repeat(20)}"\n`
    const root = repo({ 'api/dist/server.js': leak, 'web/dist/app.js': leak })
    expect(scanBuiltBundles(root).roots).toEqual(['api/dist', 'web/dist'])
    const only = scanLocalRepo(root, undefined, { bundleDirs: ['web/dist', './web/dist'] }).bundle
    expect(only.roots).toEqual(['web/dist'])
    expect(only.findings.map((f) => f.filePath)).toEqual(['web/dist/app.js'])
    expect(() => scanBuiltBundles(root, undefined, ['web/missing'])).toThrow()
    expect(() => scanBuiltBundles(root, undefined, ['../elsewhere'])).toThrow(/inside/)
    expect(() => scanBuiltBundles(root, undefined, ['web/dist/app.js'])).toThrow(/not a folder/)
  })

  it('isClientSafeMatch: anon and signed-in JWTs and the Mushi SDK key are public; a service-role JWT is not', () => {
    expect(isClientSafeMatch({ label: 'JWT', value: jwt({ role: 'anon' }) })).toBe(true)
    expect(isClientSafeMatch({ label: 'JWT', value: jwt({ role: 'service_role' }) })).toBe(false)
    expect(isClientSafeMatch({ label: 'Mushi API key', value: 'mushi_' + 'a'.repeat(30) })).toBe(true)
    expect(isClientSafeMatch({ label: 'Stripe live key', value: 'sk_live_x' })).toBe(false)
  })
})

describe('the push stays under the ingest limit without hiding a rule', () => {
  const scanWith = (storage: number, bundle: Array<{ filePath: string; line: number }>): LocalRadarScan => ({
    scannedFiles: 10, truncated: false, unreadable: 0, configFiles: {},
    findings: Array.from({ length: storage }, (_, i) => ({
      ruleId: 'storage_sql_delete' as const, severity: 'warn' as const, message: 'x', target: `${i}.sql`,
      filePath: `supabase/migrations/${i}.sql`, line: 1, fix: 'x', evidence: { snippet: '' },
    })),
    bundle: { roots: ['dist'], scannedFiles: 5, truncated: false, unreadable: 0, findings: bundle.map((b) => ({ ...b, label: 'Stripe live key' as const })) },
  })
  const rules = (body: Record<string, unknown>) => (body.findings as Array<{ ruleId: string }>).map((f) => f.ruleId)

  it('a leaky build repeating a key across 300 chunks cannot push the storage finding out', () => {
    const bundle = Array.from({ length: 300 }, (_, i) => ({ filePath: `dist/assets/chunk-${i}.js`, line: 1 }))
    const body = toIngestBody(scanWith(1, bundle), null)
    expect((body.findings as unknown[]).length).toBeLessThanOrEqual(MAX_PUSH_FINDINGS)
    expect(rules(body)).toContain('storage_sql_delete')
    // The bundle rule was cut: it is partial, and the storage rule is not.
    expect(body.partial).toEqual(['key_in_client_bundle'])
  })

  it('both rules flooding: each keeps its share and both are marked partial', () => {
    const bundle = Array.from({ length: 300 }, (_, i) => ({ filePath: `dist/c-${i}.js`, line: 1 }))
    const body = toIngestBody(scanWith(300, bundle), null)
    expect(rules(body).filter((r) => r === 'storage_sql_delete')).toHaveLength(150)
    expect(rules(body).filter((r) => r === 'key_in_client_bundle')).toHaveLength(50)
    expect(body.partial).toEqual(['storage_sql_delete', 'key_in_client_bundle'])
  })

  it('one finding per file and kind of key: repeats in one chunk do not use up the push', () => {
    const bundle = Array.from({ length: 60 }, (_, i) => ({ filePath: 'dist/app.js', line: i + 1 }))
    const body = toIngestBody(scanWith(0, bundle), null)
    expect(body.findings).toEqual([{ ruleId: 'key_in_client_bundle', filePath: 'dist/app.js', line: 1, kind: 'Stripe live key' }])
    expect(body).not.toHaveProperty('partial', expect.arrayContaining(['key_in_client_bundle']))
  })
})
