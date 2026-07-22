/**
 * Tests for multi-profile config support (Phase 4).
 *
 * Critical invariant: single-profile (legacy flat) behaviour is UNCHANGED.
 * The v2 format only appears once a profile-scoped write happens.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadConfig,
  saveConfig,
  listProfiles,
  setActiveProfile,
  resolveProfileName,
  DEFAULT_PROFILE,
} from './config.js'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'mushi-profiles-'))
const TEST_PATH = join(TEST_DIR, 'config.json')

// Keep the profile env hermetic — a stray MUSHI_PROFILE would flip write shapes.
let savedProfile: string | undefined
beforeEach(() => {
  savedProfile = process.env['MUSHI_PROFILE']
  delete process.env['MUSHI_PROFILE']
})
afterEach(() => {
  if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH)
  if (savedProfile === undefined) delete process.env['MUSHI_PROFILE']
  else process.env['MUSHI_PROFILE'] = savedProfile
})

// ─── backward compatibility ───────────────────────────────────────────────────

describe('flat-format backward compatibility', () => {
  it('a no-profile save writes the legacy FLAT shape (no `profiles` key)', () => {
    saveConfig({ apiKey: 'flat-key', projectId: 'p1' }, TEST_PATH)
    const raw = JSON.parse(readFileSync(TEST_PATH, 'utf-8'))
    expect(raw).toEqual({ apiKey: 'flat-key', projectId: 'p1' })
    expect(raw).not.toHaveProperty('profiles')
  })

  it('reads a legacy flat file as the default profile', () => {
    saveConfig({ apiKey: 'flat-key' }, TEST_PATH)
    expect(loadConfig(TEST_PATH).apiKey).toBe('flat-key')
    expect(loadConfig(TEST_PATH, { profile: 'default' }).apiKey).toBe('flat-key')
  })
})

// ─── resolveProfileName precedence ─────────────────────────────────────────────

describe('resolveProfileName', () => {
  it('explicit arg wins over env and file', () => {
    process.env['MUSHI_PROFILE'] = 'from-env'
    expect(resolveProfileName('explicit', 'from-file')).toBe('explicit')
  })

  it('env wins over file active', () => {
    process.env['MUSHI_PROFILE'] = 'from-env'
    expect(resolveProfileName(undefined, 'from-file')).toBe('from-env')
  })

  it('file active wins over default', () => {
    expect(resolveProfileName(undefined, 'staging')).toBe('staging')
  })

  it('falls back to default', () => {
    expect(resolveProfileName()).toBe(DEFAULT_PROFILE)
  })
})

// ─── profile-scoped writes upgrade to v2 ───────────────────────────────────────

describe('profile-scoped writes', () => {
  it('a profile-scoped save upgrades a flat file to v2, preserving the flat data as default', () => {
    saveConfig({ apiKey: 'default-key' }, TEST_PATH) // flat
    saveConfig({ apiKey: 'staging-key' }, TEST_PATH, { profile: 'staging' }) // upgrades

    const raw = JSON.parse(readFileSync(TEST_PATH, 'utf-8'))
    expect(raw.version).toBe(2)
    expect(raw.profiles.default.apiKey).toBe('default-key')
    expect(raw.profiles.staging.apiKey).toBe('staging-key')
  })

  it('loads each profile independently', () => {
    saveConfig({ apiKey: 'default-key' }, TEST_PATH)
    saveConfig({ apiKey: 'staging-key' }, TEST_PATH, { profile: 'staging' })

    expect(loadConfig(TEST_PATH, { profile: 'default' }).apiKey).toBe('default-key')
    expect(loadConfig(TEST_PATH, { profile: 'staging' }).apiKey).toBe('staging-key')
  })

  it('a profile save preserves OTHER existing profiles', () => {
    saveConfig({ apiKey: 'a' }, TEST_PATH, { profile: 'alpha' })
    saveConfig({ apiKey: 'b' }, TEST_PATH, { profile: 'beta' })
    saveConfig({ apiKey: 'a2' }, TEST_PATH, { profile: 'alpha' }) // update alpha

    const raw = JSON.parse(readFileSync(TEST_PATH, 'utf-8'))
    expect(raw.profiles.alpha.apiKey).toBe('a2')
    expect(raw.profiles.beta.apiKey).toBe('b') // untouched
  })

  it('MUSHI_PROFILE env routes a plain saveConfig to that profile', () => {
    saveConfig({ apiKey: 'default-key' }, TEST_PATH)
    process.env['MUSHI_PROFILE'] = 'ci'
    saveConfig({ apiKey: 'ci-key' }, TEST_PATH)

    const raw = JSON.parse(readFileSync(TEST_PATH, 'utf-8'))
    expect(raw.version).toBe(2)
    expect(raw.profiles.ci.apiKey).toBe('ci-key')
    // env-driven load resolves it too
    expect(loadConfig(TEST_PATH).apiKey).toBe('ci-key')
  })
})

// ─── listProfiles / setActiveProfile ───────────────────────────────────────────

describe('listProfiles', () => {
  it('returns a synthetic default for a missing file', () => {
    const { active, profiles } = listProfiles(join(TEST_DIR, 'nope.json'))
    expect(active).toBe(DEFAULT_PROFILE)
    expect(profiles).toEqual([DEFAULT_PROFILE])
  })

  it('returns default for a flat file', () => {
    saveConfig({ apiKey: 'x' }, TEST_PATH)
    expect(listProfiles(TEST_PATH).profiles).toEqual([DEFAULT_PROFILE])
  })

  it('lists all v2 profiles and the active one', () => {
    saveConfig({ apiKey: 'a' }, TEST_PATH, { profile: 'alpha' })
    saveConfig({ apiKey: 'b' }, TEST_PATH, { profile: 'beta' })
    const { profiles } = listProfiles(TEST_PATH)
    expect(profiles.sort()).toEqual(['alpha', 'beta', 'default'])
  })
})

describe('setActiveProfile', () => {
  it('switches the active profile and it drives subsequent plain loads', () => {
    saveConfig({ apiKey: 'default-key' }, TEST_PATH)
    saveConfig({ apiKey: 'staging-key' }, TEST_PATH, { profile: 'staging' })

    setActiveProfile('staging', TEST_PATH)
    expect(listProfiles(TEST_PATH).active).toBe('staging')
    // A plain load (no explicit profile, no env) now resolves 'staging'.
    expect(loadConfig(TEST_PATH).apiKey).toBe('staging-key')
  })

  it('creates an empty profile when switching to a new name', () => {
    saveConfig({ apiKey: 'default-key' }, TEST_PATH)
    setActiveProfile('fresh', TEST_PATH)
    const { active, profiles } = listProfiles(TEST_PATH)
    expect(active).toBe('fresh')
    expect(profiles).toContain('fresh')
    expect(loadConfig(TEST_PATH, { profile: 'fresh' })).toEqual({})
  })

  it('upgrades a flat file to v2 preserving the flat data as default', () => {
    saveConfig({ apiKey: 'legacy' }, TEST_PATH)
    setActiveProfile('staging', TEST_PATH)
    const raw = JSON.parse(readFileSync(TEST_PATH, 'utf-8'))
    expect(raw.profiles.default.apiKey).toBe('legacy')
  })
})

afterEach(() => {
  rmSync(join(TEST_DIR, 'nope.json'), { force: true })
})
