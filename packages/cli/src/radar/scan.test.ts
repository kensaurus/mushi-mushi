import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanLocalRepo, toIngestBody } from './scan.js'

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
    const body = toIngestBody({ scannedFiles: 20_000, truncated: true, unreadable: 0, findings: [], configFiles: {} }, null)
    expect(body).toMatchObject({ scanned: ['storage_sql_delete'], partial: ['storage_sql_delete'] })
    expect(toIngestBody({ scannedFiles: 5, truncated: false, unreadable: 1, findings: [], configFiles: {} }, null)).toHaveProperty('partial')
    expect(toIngestBody({ scannedFiles: 0, truncated: false, unreadable: 0, findings: [], configFiles: {} }, null)).toHaveProperty('partial')
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
