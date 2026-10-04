/**
 * FILE: packages/server/src/__tests__/routing-secrets.test.ts
 * PURPOSE: Routing-destination tokens (Jira, Linear, GitHub Issues,
 *          PagerDuty) go to Vault on write and are resolved on read;
 *          project_integrations.config keeps only `vault://` refs.
 */
import { describe, expect, it } from 'vitest'
import {
  isSecretRoutingKey,
  resolveRoutingSecrets,
  vaultRoutingSecrets,
} from '../../supabase/functions/_shared/routing-secrets.ts'

function fakeVault(opts: { failStore?: boolean } = {}) {
  const store = new Map<string, string>()
  return {
    store,
    rpc: async (fn: string, args: Record<string, string>) => {
      if (fn === 'vault_store_secret') {
        if (opts.failStore) return { data: null, error: { message: 'vault down' } }
        store.set(args.secret_name, args.secret_value)
        return { data: 'id', error: null }
      }
      if (fn === 'vault_get_secret') return { data: store.get(args.secret_id) ?? null, error: null }
      return { data: null, error: { message: `unexpected ${fn}` } }
    },
  }
}

describe('isSecretRoutingKey', () => {
  it('matches credential keys and leaves the rest', () => {
    for (const k of ['apiToken', 'token', 'routingKey', 'apiKey', 'signingSecret']) expect(isSecretRoutingKey(k)).toBe(true)
    for (const k of ['email', 'baseUrl', 'projectKey'.replace('Key', ''), 'repo', 'teamId']) expect(isSecretRoutingKey(k)).toBe(false)
  })
})

describe('vaultRoutingSecrets', () => {
  it('stores tokens in Vault and keeps refs; other fields stay as typed', async () => {
    const db = fakeVault()
    const out = await vaultRoutingSecrets(db as never, 'p1', 'jira', {
      email: 'me@x.dev',
      baseUrl: 'https://x.atlassian.net',
      apiToken: 'jira-token-value',
    })
    expect(out.email).toBe('me@x.dev')
    expect(out.baseUrl).toBe('https://x.atlassian.net')
    expect(String(out.apiToken)).toMatch(/^vault:\/\//)
    expect(JSON.stringify(out)).not.toContain('jira-token-value')
    expect([...db.store.values()]).toContain('jira-token-value')
  })

  it('leaves existing refs and empty values alone', async () => {
    const db = fakeVault()
    const out = await vaultRoutingSecrets(db as never, 'p1', 'pagerduty', { routingKey: 'vault://already', token: null })
    expect(out).toEqual({ routingKey: 'vault://already', token: null })
    expect(db.store.size).toBe(0)
  })

  it('throws when Vault refuses, so the route never saves the raw token', async () => {
    const db = fakeVault({ failStore: true })
    await expect(vaultRoutingSecrets(db as never, 'p1', 'github', { token: 'ghp_x' })).rejects.toThrow(/vault_store_secret failed/)
  })
})

describe('resolveRoutingSecrets', () => {
  it('gives the provider the token back, and reads pre-Vault plaintext rows as-is', async () => {
    const db = fakeVault()
    const stored = await vaultRoutingSecrets(db as never, 'p1', 'linear', { apiKey: 'lin_value', teamId: 't1' })
    expect(await resolveRoutingSecrets(db as never, stored)).toEqual({ apiKey: 'lin_value', teamId: 't1' })
    expect(await resolveRoutingSecrets(db as never, { apiToken: 'legacy-plain' })).toEqual({ apiToken: 'legacy-plain' })
  })
})
