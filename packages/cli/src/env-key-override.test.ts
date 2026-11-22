import { describe, expect, it } from 'vitest'
import { envKeyOverrideLines } from './env-key-override.js'

describe('envKeyOverrideLines', () => {
  it('says nothing without an environment key, or when it is the saved key', () => {
    expect(envKeyOverrideLines({}, 'mushi_saved_key_abc')).toEqual([])
    expect(envKeyOverrideLines({ MUSHI_API_KEY: 'mushi_saved_key_abc' }, 'mushi_saved_key_abc')).toEqual([])
  })

  it('warns when an environment key overrides the key just saved, with how to remove it per platform (2026-11-11)', () => {
    const win = envKeyOverrideLines({ MUSHI_API_KEY: 'mushi_old_ingest_key' }, 'mushi_new_full_key', 'win32')
    expect(win[0]).toContain('overrides the saved key (mushi_new_fu…)')
    expect(win[0]).toContain('mushi_old_in…')
    expect(win[1]).toContain('Environment Variables')
    const nix = envKeyOverrideLines({ MUSHI_API_KEY: 'mushi_old_ingest_key' }, undefined, 'linux')
    expect(nix[1]).toContain('unset MUSHI_API_KEY')
  })

  it('never prints a whole key', () => {
    const lines = envKeyOverrideLines({ MUSHI_API_KEY: 'mushi_example_one_hiddenpart' }, 'mushi_example_two_hiddenpart', 'linux').join(' ')
    expect(lines).not.toContain('hiddenpart')
  })
})
