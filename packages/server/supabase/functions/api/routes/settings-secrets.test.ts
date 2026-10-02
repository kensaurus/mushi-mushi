import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  dereferenceMaybeVault,
  planSecretSettingWrite,
  settingsSecretName,
  storeSettingsSecret,
  type VaultRpcClient,
} from '../../_shared/settings-secrets.ts'

const PROJECT = '11111111-2222-4333-8444-555555555555'

/** In-memory stand-in for vault_store_secret / vault_get_secret (lookup by name). */
function fakeVault(opts: { failStore?: boolean; failGet?: boolean } = {}) {
  const secrets = new Map<string, string>()
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const db: VaultRpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args })
      if (fn === 'vault_store_secret') {
        if (opts.failStore) return Promise.resolve({ data: null, error: { message: 'denied' } })
        secrets.set(String(args.secret_name), String(args.secret_value))
        return Promise.resolve({ data: 'uuid', error: null })
      }
      if (fn === 'vault_get_secret') {
        if (opts.failGet) return Promise.resolve({ data: null, error: { message: 'denied' } })
        return Promise.resolve({ data: secrets.get(String(args.secret_id)) ?? null, error: null })
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } })
    },
  }
  return { db, secrets, calls }
}

Deno.test('secret names match the integrations PUT convention', () => {
  assertEquals(
    settingsSecretName(PROJECT, 'github', 'github_webhook_secret'),
    `mushi/integration/${PROJECT}/github/github_webhook_secret`,
  )
})

Deno.test('storeSettingsSecret writes Vault and returns a vault:// ref that resolves back', async () => {
  const { db, secrets } = fakeVault()
  const ref = await storeSettingsSecret(db, PROJECT, 'sentry', 'sentry_webhook_secret', 'whsec_live')
  assertEquals(ref, `vault://mushi/integration/${PROJECT}/sentry/sentry_webhook_secret`)
  assertEquals(secrets.get(`mushi/integration/${PROJECT}/sentry/sentry_webhook_secret`), 'whsec_live')
  assertEquals(await dereferenceMaybeVault(db, ref), 'whsec_live')
})

Deno.test('storeSettingsSecret throws instead of handing back the raw value when Vault refuses', async () => {
  const { db } = fakeVault({ failStore: true })
  await assertRejects(() => storeSettingsSecret(db, PROJECT, 'github', 'github_webhook_secret', 'raw'))
})

Deno.test('dereferenceMaybeVault still accepts a legacy raw value without touching Vault', async () => {
  const { db, calls } = fakeVault()
  assertEquals(await dereferenceMaybeVault(db, 'legacy-plaintext'), 'legacy-plaintext')
  assertEquals(calls.length, 0)
})

Deno.test('dereferenceMaybeVault fails closed on empty, missing or unreadable refs', async () => {
  assertEquals(await dereferenceMaybeVault(fakeVault().db, null), null)
  assertEquals(await dereferenceMaybeVault(fakeVault().db, ''), null)
  assertEquals(await dereferenceMaybeVault(fakeVault().db, 'vault://mushi/integration/x/github/missing'), null)
  assertEquals(await dereferenceMaybeVault(fakeVault({ failGet: true }).db, 'vault://anything'), null)
})

Deno.test('planSecretSettingWrite: clear, skip round-trips, reject foreign refs, store raw', () => {
  const stored = `vault://mushi/integration/${PROJECT}/sentry/sentry_webhook_secret`
  assertEquals(planSecretSettingWrite(null, stored), { action: 'clear' })
  assertEquals(planSecretSettingWrite('', stored), { action: 'clear' })
  assertEquals(planSecretSettingWrite('   ', stored), { action: 'skip' })
  assertEquals(planSecretSettingWrite('…cret', stored), { action: 'skip' })
  // The General panel saves the whole row: its own stored ref comes back unchanged.
  assertEquals(planSecretSettingWrite(stored, stored), { action: 'skip' })
  // A ref the server did not store for this row is never accepted from a client.
  assertEquals(
    planSecretSettingWrite('vault://mushi/integration/99999999-8888-4777-8666-555555555555/sentry/sentry_webhook_secret', stored),
    { action: 'reject' },
  )
  assertEquals(planSecretSettingWrite('vault://x', null), { action: 'reject' })
  assertEquals(planSecretSettingWrite(42, stored), { action: 'skip' })
  assertEquals(planSecretSettingWrite('  whsec_new  ', stored), { action: 'store', value: 'whsec_new' })
})
