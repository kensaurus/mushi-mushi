import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from './config.js'
import { resolveSdkEnvKey, runConnect } from './connect.js'
import type { KeyScopeProbeResult, ProbeKeyScope } from './key-scopes.js'

// runConnect persists credentials; never let a test write the developer's
// real CLI config.
const saved = vi.hoisted(() => [] as ConfigModule.CliConfig[])
vi.mock('./config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    saveConfig: vi.fn((config: ConfigModule.CliConfig) => {
      saved.push(config)
    }),
  }
})

const ENDPOINT = 'https://x.supabase.co/functions/v1/api'
const PROJECT_ID = '11111111-2222-4333-8444-555555555555'

function probeReturning(byKey: Record<string, KeyScopeProbeResult>): ProbeKeyScope {
  return async (_endpoint, key) => ({ result: byKey[key] ?? 'unknown', status: 500 })
}

describe('resolveSdkEnvKey', () => {
  it('prefers an explicit --sdk-key once it proves ingest-only', async () => {
    const result = await resolveSdkEnvKey({
      sdkKey: 'mushi_sdk',
      apiKey: 'mushi_cli',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      baseConfig: {},
      probe: probeReturning({ mushi_sdk: 'ingest-only', mushi_cli: 'mcp' }),
    })
    expect(result).toEqual({ ok: true, key: 'mushi_sdk' })
  })

  it('uses the ingest key saved for this project before the CLI key', async () => {
    const result = await resolveSdkEnvKey({
      apiKey: 'mushi_cli',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      baseConfig: { sdkKey: { projectId: PROJECT_ID, key: 'mushi_saved_sdk' } },
      probe: probeReturning({ mushi_saved_sdk: 'ingest-only', mushi_cli: 'mcp' }),
    })
    expect(result).toEqual({ ok: true, key: 'mushi_saved_sdk' })
  })

  it('refuses an mcp-scoped key for the env', async () => {
    const result = await resolveSdkEnvKey({
      apiKey: 'mushi_cli',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      baseConfig: {},
      probe: probeReturning({ mushi_cli: 'mcp' }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('can read your bug reports')
  })

  it('refuses when the scope cannot be confirmed', async () => {
    const result = await resolveSdkEnvKey({
      apiKey: 'mushi_cli',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      baseConfig: {},
      probe: probeReturning({}),
    })
    expect(result.ok).toBe(false)
  })
})

describe('runConnect --write-env', () => {
  let cwd: string

  beforeEach(async () => {
    saved.length = 0
    cwd = await mkdtemp(join(tmpdir(), 'mushi-connect-'))
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0', vite: '^7.0.0' } }))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('writes only the ingest-only key into VITE_ env and binds it in the CLI config', async () => {
    const result = await runConnect({
      apiKey: 'mushi_cli_reads_reports',
      sdkKey: 'mushi_sdk_ingest_only',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      cwd,
      writeEnv: true,
      wireIde: false,
      probeKeyScope: probeReturning({ mushi_sdk_ingest_only: 'ingest-only', mushi_cli_reads_reports: 'mcp' }),
    })

    expect(result.ok).toBe(true)
    const env = await readFile(join(cwd, '.env.local'), 'utf8')
    expect(env).toContain('VITE_MUSHI_API_KEY=mushi_sdk_ingest_only')
    expect(env).not.toContain('mushi_cli_reads_reports')
    expect(saved.at(-1)).toMatchObject({
      apiKey: 'mushi_cli_reads_reports',
      sdkKey: { projectId: PROJECT_ID, key: 'mushi_sdk_ingest_only' },
    })
  })

  it('does not write an mcp-scoped key into the env and reports failure', async () => {
    const result = await runConnect({
      apiKey: 'mushi_cli_reads_reports',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      cwd,
      writeEnv: true,
      wireIde: false,
      probeKeyScope: probeReturning({ mushi_cli_reads_reports: 'mcp' }),
    })

    expect(result.ok).toBe(false)
    expect(result.envPath).toBeNull()
    await expect(readFile(join(cwd, '.env.local'), 'utf8')).rejects.toThrow()
    expect(result.messages.join('\n')).toContain('--sdk-key')
    expect(saved.at(-1)?.sdkKey).toBeUndefined()
  })

  it('never probes or writes env with --no-env', async () => {
    const probe = vi.fn(probeReturning({}))
    const result = await runConnect({
      apiKey: 'mushi_cli_reads_reports',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      cwd,
      writeEnv: false,
      wireIde: false,
      probeKeyScope: probe,
    })
    expect(result.ok).toBe(true)
    expect(probe).not.toHaveBeenCalled()
  })

  it('wires Cursor with the ${env:} placeholder, not the key', async () => {
    await runConnect({
      apiKey: 'mushi_cli_reads_reports',
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      cwd,
      writeEnv: false,
      wireIde: true,
    })
    const mcp = await readFile(join(cwd, '.cursor', 'mcp.json'), 'utf8')
    expect(mcp).toContain('${env:MUSHI_API_KEY}')
    expect(mcp).not.toContain('mushi_cli_reads_reports')
  })
})
