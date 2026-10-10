import * as fsp from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeProjectBootstrapFiles } from './project-bootstrap.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

const opts = { endpoint: 'https://api.example.test', projectId: 'proj_1', apiKey: 'mushi_key_1' }

describe('writeProjectBootstrapFiles', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })
  async function tempDir(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'mushi-bootstrap-'))
    dirs.push(d)
    return d
  }

  it('creates .env.local when none exists', async () => {
    const cwd = await tempDir()
    const res = await writeProjectBootstrapFiles({ cwd, ...opts })
    expect(res.envUpdated).toBe(false)
    const env = await readFile(join(cwd, '.env.local'), 'utf8')
    expect(env).toContain('MUSHI_PROJECT_ID=proj_1')
    expect(env).toContain('MUSHI_API_KEY=mushi_key_1')
  })

  it('keeps unrelated vars and replaces prior Mushi lines, comment included', async () => {
    const cwd = await tempDir()
    await writeFile(
      join(cwd, '.env.local'),
      [
        'DATABASE_URL=postgres://x',
        '# Mushi MCP — old comment',
        'MUSHI_API_KEY=old',
        'NEXT_PUBLIC_MUSHI_PROJECT_ID=old_proj',
        'STRIPE_SECRET_KEY=sk_test',
      ].join('\n'),
      'utf8',
    )
    const res = await writeProjectBootstrapFiles({ cwd, ...opts })
    expect(res.envUpdated).toBe(true)
    const env = await readFile(join(cwd, '.env.local'), 'utf8')
    expect(env).toContain('DATABASE_URL=postgres://x')
    expect(env).toContain('STRIPE_SECRET_KEY=sk_test')
    expect(env).not.toContain('MUSHI_API_KEY=old')
    expect(env).not.toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID=old_proj')
    expect(env).not.toContain('old comment')
    expect(env.match(/^# Mushi MCP/gm)).toHaveLength(1)
  })

  it('is idempotent across re-runs', async () => {
    const cwd = await tempDir()
    await writeFile(join(cwd, '.env.local'), 'DATABASE_URL=postgres://x\n', 'utf8')
    await writeProjectBootstrapFiles({ cwd, ...opts })
    const first = await readFile(join(cwd, '.env.local'), 'utf8')
    await writeProjectBootstrapFiles({ cwd, ...opts })
    const second = await readFile(join(cwd, '.env.local'), 'utf8')
    expect(second).toBe(first)
  })

  it('rethrows a read error other than ENOENT instead of overwriting', async () => {
    const cwd = await tempDir()
    const envPath = join(cwd, '.env.local')
    await writeFile(envPath, 'DATABASE_URL=postgres://x\n', 'utf8')
    vi.mocked(fsp.readFile).mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    )
    await expect(writeProjectBootstrapFiles({ cwd, ...opts })).rejects.toMatchObject({ code: 'EACCES' })
    expect(await readFile(envPath, 'utf8')).toBe('DATABASE_URL=postgres://x\n')
  })
})
