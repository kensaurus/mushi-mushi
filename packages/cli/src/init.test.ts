import { describe, expect, it, vi } from 'vitest'
import type { createProject, mintProjectKey } from './device-auth.js'
import {
  isEnvFileCoveredByGitignore,
  mintWizardKeys,
  planCliConfigUpdate,
  resolveSavedCredentials,
  sanitizeSecret,
  type WizardMintDeps,
} from './init.js'
import type { KeyScopeProbeResult, ProbeKeyScope } from './key-scopes.js'

const ENDPOINT = 'https://x.supabase.co/functions/v1/api'

type MintCall = { projectId: string; scopes: readonly string[] | undefined; label: string | undefined }

/** Fake device-auth mint API that records the scopes asked for and returns a key named after them. */
function fakeMintDeps(opts: { createReturnsKey?: boolean; cliMintFails?: boolean } = {}) {
  const createCalls: Array<{ name: string; scopes: readonly string[] | undefined }> = []
  const mintCalls: MintCall[] = []
  const create: typeof createProject = async (_endpoint, _token, name, o = {}) => {
    createCalls.push({ name, scopes: o.scopes })
    return {
      id: 'proj-new',
      name,
      slug: name,
      apiKey: opts.createReturnsKey === false ? null : `key[${(o.scopes ?? []).join('+')}]`,
    }
  }
  const mint: typeof mintProjectKey = async (_endpoint, _token, projectId, o = {}) => {
    mintCalls.push({ projectId, scopes: o.scopes, label: o.label })
    if (opts.cliMintFails && o.scopes?.includes('mcp:read')) throw new Error('HTTP 500')
    return `key[${(o.scopes ?? []).join('+')}]`
  }
  const deps: WizardMintDeps = { createProject: create, mintProjectKey: mint }
  return { deps, createCalls, mintCalls }
}

describe('mintWizardKeys — one key per destination', () => {
  it('new project: the auto-minted SDK key is report:write only; the CLI key adds mcp:read', async () => {
    const { deps, createCalls, mintCalls } = fakeMintDeps()
    const result = await mintWizardKeys(deps, {
      endpoint: ENDPOINT,
      cliToken: 'tok',
      target: { kind: 'new', name: 'My App' },
      withCliKey: true,
    })

    expect(createCalls).toEqual([{ name: 'My App', scopes: ['report:write'] }])
    expect(mintCalls).toEqual([{ projectId: 'proj-new', scopes: ['report:write', 'mcp:read'], label: 'cli-login' }])
    expect(result.sdkKey).toBe('key[report:write]')
    expect(result.cliKey).toBe('key[report:write+mcp:read]')
    expect(result.createdName).toBe('My App')
  })

  it('existing project: mints a report:write SDK key and a separate report:write+mcp:read CLI key', async () => {
    const { deps, createCalls, mintCalls } = fakeMintDeps()
    const result = await mintWizardKeys(deps, {
      endpoint: ENDPOINT,
      cliToken: 'tok',
      target: { kind: 'existing', projectId: 'proj-1' },
      withCliKey: true,
    })

    expect(createCalls).toEqual([])
    expect(mintCalls).toEqual([
      { projectId: 'proj-1', scopes: ['report:write'], label: 'sdk-ingest' },
      { projectId: 'proj-1', scopes: ['report:write', 'mcp:read'], label: 'cli-login' },
    ])
    expect(result).toMatchObject({ projectId: 'proj-1', sdkKey: 'key[report:write]', cliKey: 'key[report:write+mcp:read]' })
  })

  it('no mint call ever puts an mcp scope on the key that becomes the SDK key', async () => {
    for (const target of [{ kind: 'new', name: 'A' }, { kind: 'existing', projectId: 'p' }] as const) {
      const { deps } = fakeMintDeps({ createReturnsKey: false })
      const result = await mintWizardKeys(deps, { endpoint: ENDPOINT, cliToken: 'tok', target, withCliKey: true })
      expect(result.sdkKey).toBe('key[report:write]')
    }
  })

  it('skips the CLI key when the caller already has one', async () => {
    const { deps, mintCalls } = fakeMintDeps()
    const result = await mintWizardKeys(deps, {
      endpoint: ENDPOINT,
      cliToken: 'tok',
      target: { kind: 'existing', projectId: 'proj-1' },
      withCliKey: false,
    })
    expect(mintCalls.map((c) => c.scopes)).toEqual([['report:write']])
    expect(result.cliKey).toBeUndefined()
  })

  it('a failed CLI-key mint is reported, not thrown — the SDK install can still finish', async () => {
    const { deps } = fakeMintDeps({ cliMintFails: true })
    const result = await mintWizardKeys(deps, {
      endpoint: ENDPOINT,
      cliToken: 'tok',
      target: { kind: 'existing', projectId: 'proj-1' },
      withCliKey: true,
    })
    expect(result.sdkKey).toBe('key[report:write]')
    expect(result.cliKey).toBeUndefined()
    expect(result.cliKeyError).toBe('HTTP 500')
  })
})

function probeReturning(byKey: Record<string, KeyScopeProbeResult>): ProbeKeyScope & { calls: string[] } {
  const calls: string[] = []
  const probe = vi.fn(async (_endpoint: string, key: string) => {
    calls.push(key)
    return { result: byKey[key] ?? 'unknown' }
  }) as unknown as ProbeKeyScope & { calls: string[] }
  probe.calls = calls
  return probe
}

describe('resolveSavedCredentials', () => {
  it('uses the saved ingest key for the env and keeps the login key private', async () => {
    const probe = probeReturning({ mushi_sdk: 'ingest-only', mushi_cli: 'mcp' })
    const resolved = await resolveSavedCredentials(
      { projectId: 'proj-1', apiKey: 'mushi_cli', sdkKey: { projectId: 'proj-1', key: 'mushi_sdk' } },
      ENDPOINT,
      probe,
    )
    expect(resolved).toEqual({
      kind: 'ready',
      credentials: { projectId: 'proj-1', sdkKey: 'mushi_sdk', cliKey: 'mushi_cli' },
    })
  })

  it('never hands an mcp-scoped login key to the env — it asks for an SDK key instead', async () => {
    const probe = probeReturning({ mushi_cli: 'mcp' })
    const resolved = await resolveSavedCredentials({ projectId: 'proj-1', apiKey: 'mushi_cli' }, ENDPOINT, probe)
    expect(resolved).toEqual({ kind: 'needs-sdk-key', projectId: 'proj-1', cliKey: 'mushi_cli' })
  })

  it('ignores a saved SDK key bound to another project', async () => {
    const probe = probeReturning({ mushi_cli: 'mcp', mushi_other: 'ingest-only' })
    const resolved = await resolveSavedCredentials(
      { projectId: 'proj-1', apiKey: 'mushi_cli', sdkKey: { projectId: 'proj-2', key: 'mushi_other' } },
      ENDPOINT,
      probe,
    )
    expect(resolved.kind).toBe('needs-sdk-key')
    expect(probe.calls).toEqual(['mushi_cli'])
  })

  it('falls back to the login key when the saved SDK key was revoked', async () => {
    const probe = probeReturning({ mushi_sdk: 'invalid', mushi_cli: 'mcp' })
    const resolved = await resolveSavedCredentials(
      { projectId: 'proj-1', apiKey: 'mushi_cli', sdkKey: { projectId: 'proj-1', key: 'mushi_sdk' } },
      ENDPOINT,
      probe,
    )
    expect(resolved.kind).toBe('needs-sdk-key')
  })

  it('reuses a saved key that is itself ingest-only (e.g. pasted from the console)', async () => {
    const probe = probeReturning({ mushi_ingest: 'ingest-only' })
    const resolved = await resolveSavedCredentials({ projectId: 'proj-1', apiKey: 'mushi_ingest' }, ENDPOINT, probe)
    expect(resolved).toEqual({ kind: 'ready', credentials: { projectId: 'proj-1', sdkKey: 'mushi_ingest' } })
  })

  it('reports an unusable saved key instead of guessing', async () => {
    const probe = probeReturning({ mushi_cli: 'unreachable' })
    const resolved = await resolveSavedCredentials({ projectId: 'proj-1', apiKey: 'mushi_cli' }, ENDPOINT, probe)
    expect(resolved.kind).toBe('unusable')
  })
})

describe('planCliConfigUpdate', () => {
  it('saves the CLI key privately and binds the SDK key to its project', () => {
    const next = planCliConfigUpdate(
      { clientId: 'cli_abc', apiKey: 'mushi_old', projectId: 'proj-0' },
      { projectId: 'proj-1', sdkKey: 'mushi_sdk', cliKey: 'mushi_cli' },
      ENDPOINT,
    )
    expect(next).toEqual({
      clientId: 'cli_abc',
      apiKey: 'mushi_cli',
      projectId: 'proj-1',
      endpoint: ENDPOINT,
      sdkKey: { projectId: 'proj-1', key: 'mushi_sdk' },
    })
  })

  it('keeps a saved key for the same project when this run only learned an ingest key', () => {
    const next = planCliConfigUpdate(
      { apiKey: 'mushi_saved_cli', projectId: 'proj-1' },
      { projectId: 'proj-1', sdkKey: 'mushi_sdk' },
      ENDPOINT,
    )
    expect(next.apiKey).toBe('mushi_saved_cli')
  })

  it('uses the ingest key as the CLI key rather than keep another project\'s key', () => {
    const next = planCliConfigUpdate(
      { apiKey: 'mushi_other_project', projectId: 'proj-0' },
      { projectId: 'proj-1', sdkKey: 'mushi_sdk' },
      ENDPOINT,
    )
    expect(next.apiKey).toBe('mushi_sdk')
  })
})

describe('sanitizeSecret', () => {
  it('strips surrounding double quotes', () => {
    expect(sanitizeSecret('"mushi_abcdef12345"')).toBe('mushi_abcdef12345')
  })

  it('strips surrounding single quotes', () => {
    expect(sanitizeSecret("'mushi_abcdef12345'")).toBe('mushi_abcdef12345')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeSecret('  mushi_abcdef12345 \t')).toBe('mushi_abcdef12345')
  })

  it('removes CR / LF / NUL to prevent env-file injection', () => {
    expect(sanitizeSecret('mushi_abc\nEVIL_VAR=1')).toBe('mushi_abcEVIL_VAR=1')
    expect(sanitizeSecret('mushi_abc\r\nEVIL')).toBe('mushi_abcEVIL')
    expect(sanitizeSecret('mushi_abc\0foo')).toBe('mushi_abcfoo')
  })

  it('is a no-op on a clean secret', () => {
    expect(sanitizeSecret('mushi_abcdef12345')).toBe('mushi_abcdef12345')
  })
})

describe('isEnvFileCoveredByGitignore', () => {
  describe('when target is .env.local', () => {
    it('matches literal .env.local', () => {
      expect(isEnvFileCoveredByGitignore('.env.local', '.env.local')).toBe(true)
    })

    it('matches the .env* glob', () => {
      expect(isEnvFileCoveredByGitignore('.env*', '.env.local')).toBe(true)
    })

    it('matches the *.local glob', () => {
      expect(isEnvFileCoveredByGitignore('*.local', '.env.local')).toBe(true)
    })

    it('matches .env*.local', () => {
      expect(isEnvFileCoveredByGitignore('.env*.local', '.env.local')).toBe(true)
    })

    it('does NOT treat a literal .env as covering .env.local', () => {
      // the original bug: `.env` in .gitignore does not cover `.env.local`
      expect(isEnvFileCoveredByGitignore('.env', '.env.local')).toBe(false)
    })

    it('does NOT treat *.env as covering .env.local', () => {
      expect(isEnvFileCoveredByGitignore('*.env', '.env.local')).toBe(false)
    })

    it('ignores comment lines', () => {
      const content = '# comment about env\n.env.local\n'
      expect(isEnvFileCoveredByGitignore(content, '.env.local')).toBe(true)
    })

    it('ignores blank lines', () => {
      expect(isEnvFileCoveredByGitignore('\n\n.env.local\n', '.env.local')).toBe(true)
    })

    it('respects negations (!.env.local) by un-covering', () => {
      const content = '*.local\n!.env.local\n'
      expect(isEnvFileCoveredByGitignore(content, '.env.local')).toBe(false)
    })

    it('does not match directory-only patterns', () => {
      expect(isEnvFileCoveredByGitignore('.env.local/', '.env.local')).toBe(false)
    })

    it('strips the leading / anchor', () => {
      expect(isEnvFileCoveredByGitignore('/.env.local', '.env.local')).toBe(true)
    })
  })

  describe('when target is .env', () => {
    it('matches literal .env', () => {
      expect(isEnvFileCoveredByGitignore('.env', '.env')).toBe(true)
    })

    it('matches .env*', () => {
      expect(isEnvFileCoveredByGitignore('.env*', '.env')).toBe(true)
    })

    it('does not match *.local', () => {
      expect(isEnvFileCoveredByGitignore('*.local', '.env')).toBe(false)
    })
  })
})
