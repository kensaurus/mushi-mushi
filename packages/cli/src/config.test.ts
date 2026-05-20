import { describe, it, expect, afterEach, afterAll, beforeEach } from 'vitest'
import { loadConfig, saveConfig } from './config.js'
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Use mkdtempSync (not a predictable `${Date.now()}` path) so the test cannot
// be hijacked via symlink-race on a shared tmp dir. Each run gets its own
// private directory with mode 0o700.
const TEST_DIR = mkdtempSync(join(tmpdir(), 'mushirc-test-'))
const TEST_PATH = join(TEST_DIR, '.mushirc')

afterEach(() => {
  if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH)
})

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('loadConfig', () => {
  // Save and restore env vars so tests are hermetic.
  const WATCHED_VARS = ['MUSHI_API_KEY', 'MUSHI_PROJECT_ID', 'MUSHI_API_ENDPOINT'] as const
  let savedEnv: Partial<Record<typeof WATCHED_VARS[number], string | undefined>> = {}

  beforeEach(() => {
    savedEnv = {}
    for (const v of WATCHED_VARS) savedEnv[v] = process.env[v]
    for (const v of WATCHED_VARS) delete process.env[v]
  })

  afterEach(() => {
    for (const v of WATCHED_VARS) {
      if (savedEnv[v] === undefined) delete process.env[v]
      else process.env[v] = savedEnv[v]
    }
  })

  it('returns empty object when file does not exist and no env vars set', () => {
    expect(loadConfig('/tmp/nonexistent-mushirc')).toEqual({})
  })

  it('reads a valid config file', () => {
    saveConfig({ apiKey: 'test-key', endpoint: 'https://example.com' }, TEST_PATH)
    const config = loadConfig(TEST_PATH)
    expect(config.apiKey).toBe('test-key')
    expect(config.endpoint).toBe('https://example.com')
  })

  it('env vars overlay file values (env wins)', () => {
    saveConfig({ apiKey: 'from-file', endpoint: 'https://file.example.com' }, TEST_PATH)
    process.env['MUSHI_API_KEY'] = 'from-env'
    process.env['MUSHI_API_ENDPOINT'] = 'https://env.example.com'
    const config = loadConfig(TEST_PATH)
    expect(config.apiKey).toBe('from-env')
    expect(config.endpoint).toBe('https://env.example.com')
  })

  it('env vars work without a config file', () => {
    process.env['MUSHI_API_KEY'] = 'mushi_envkey123'
    process.env['MUSHI_PROJECT_ID'] = '542b34e0-019e-41fe-b900-7b637717bb86'
    process.env['MUSHI_API_ENDPOINT'] = 'https://xyz.supabase.co/functions/v1/api'
    const config = loadConfig('/tmp/nonexistent-mushirc')
    expect(config.apiKey).toBe('mushi_envkey123')
    expect(config.projectId).toBe('542b34e0-019e-41fe-b900-7b637717bb86')
    expect(config.endpoint).toBe('https://xyz.supabase.co/functions/v1/api')
  })

  it('file values survive when env vars are absent', () => {
    saveConfig({ apiKey: 'from-file', projectId: 'proj_fileonly' }, TEST_PATH)
    const config = loadConfig(TEST_PATH)
    expect(config.apiKey).toBe('from-file')
    expect(config.projectId).toBe('proj_fileonly')
  })

  it('tightens permissions of a world-readable legacy config on load', () => {
    if (process.platform === 'win32') return
    writeFileSync(TEST_PATH, JSON.stringify({ apiKey: 'legacy' }))
    chmodSync(TEST_PATH, 0o644)
    loadConfig(TEST_PATH)
    const mode = statSync(TEST_PATH).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('saveConfig', () => {
  it('writes and reads back config', () => {
    saveConfig({ apiKey: 'abc', projectId: 'proj_1' }, TEST_PATH)
    const loaded = loadConfig(TEST_PATH)
    expect(loaded.apiKey).toBe('abc')
    expect(loaded.projectId).toBe('proj_1')
  })

  it('overwrites existing config', () => {
    saveConfig({ apiKey: 'first' }, TEST_PATH)
    saveConfig({ apiKey: 'second' }, TEST_PATH)
    expect(loadConfig(TEST_PATH).apiKey).toBe('second')
  })

  it('writes the file with mode 0o600 on Unix', () => {
    if (process.platform === 'win32') return
    saveConfig({ apiKey: 'secret' }, TEST_PATH)
    const mode = statSync(TEST_PATH).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
