import { describe, expect, it } from 'vitest'
import { assertNotCliKey, defaultRunnerKeyLabel, keyFromMintResponse, resolveRunnerKey } from './key.js'

const CLI = 'mushi_cli_key_fake_0001' // gitleaks:allow — fake key
const RUNNER = 'mushi_runner_key_fake_0001' // gitleaks:allow — fake key

describe('runner key', () => {
  it('reads the plaintext key from the mint response', () => {
    expect(keyFromMintResponse({ key: RUNNER })).toBe(RUNNER)
    expect(keyFromMintResponse({ apiKey: RUNNER })).toBe(RUNNER)
    expect(keyFromMintResponse({ id: 'x' })).toBeNull()
    expect(keyFromMintResponse(null)).toBeNull()
  })

  it('never accepts the CLI key as a runner key', () => {
    expect(() => assertNotCliKey(CLI, CLI)).toThrow(/That is your CLI key/)
    expect(() => assertNotCliKey(RUNNER, CLI)).not.toThrow()
  })

  it('labels the key with the short host (the server adds runner:)', () => {
    expect(defaultRunnerKeyLabel('NUC.local')).toBe('nuc')
    expect(defaultRunnerKeyLabel('Kenji_Alienware')).toBe('kenji-alienware')
  })

  it('prefers MUSHI_RUNNER_KEY and needs a project only to mint', async () => {
    const config = { apiKey: CLI, endpoint: 'https://api.test' }
    await expect(resolveRunnerKey(config, { projectId: undefined, label: 'runner-x', env: { MUSHI_RUNNER_KEY: RUNNER } })).resolves.toEqual({ key: RUNNER, source: 'env' })
    await expect(resolveRunnerKey(config, { projectId: undefined, label: 'runner-x', env: { MUSHI_RUNNER_KEY: CLI } })).rejects.toThrow(/CLI key/)
    await expect(resolveRunnerKey(config, { projectId: undefined, label: 'runner-x', env: {} })).rejects.toThrow(/Which project/)
    await expect(resolveRunnerKey({}, { projectId: 'p', label: 'runner-x', env: {} })).rejects.toThrow(/No runner key/)
  })
})

describe('assertRunnerKeyShape', () => {
  it('writes only text shaped like a Mushi key', async () => {
    const { assertRunnerKeyShape } = await import('./key.js')
    expect(assertRunnerKeyShape('mushi_0123456789abcdef0123456789abcdef')).toBe('mushi_0123456789abcdef0123456789abcdef')
    for (const bad of ['', 'mushi_short', 'sk-ant-api03-xyz', 'mushi_0123456789abcdef0123456789abcdef\nExecStart=/bin/sh', 'mushi_../../etc/passwd0000000000000000']) {
      expect(() => assertRunnerKeyShape(bad), bad).toThrow(/does not look like a Mushi key/)
    }
  })
})

