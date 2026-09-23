import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { isProjectStorageSecretRef, isVaultRef, storageSecretPrefix } from './vault-ref.ts'

const PROJECT = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

Deno.test('isVaultRef catches every spelling a client could send', () => {
  for (const v of ['vault://x', ' vault://x', 'VAULT://x', 'Vault://mushi/integration/abc/sentry/t']) {
    assert(isVaultRef(v), v)
  }
  for (const v of ['sntrys_abc', '', null, undefined, 42, 'https://vault.example.com']) {
    assertFalse(isVaultRef(v), String(v))
  }
})

Deno.test('storage secret refs must sit under the project prefix', () => {
  assertEquals(storageSecretPrefix(PROJECT), `mushi/storage/${PROJECT}/`)
  assert(isProjectStorageSecretRef(`mushi/storage/${PROJECT}/access-key`, PROJECT))
  assert(isProjectStorageSecretRef(`vault://mushi/storage/${PROJECT}/access-key`, PROJECT))
  // Another project's secret, a bare prefix, traversal and unrelated names.
  assertFalse(isProjectStorageSecretRef(`mushi/storage/${OTHER}/access-key`, PROJECT))
  assertFalse(isProjectStorageSecretRef(`mushi/storage/${PROJECT}/`, PROJECT))
  assertFalse(isProjectStorageSecretRef(`mushi/storage/${PROJECT}/../${OTHER}/k`, PROJECT))
  assertFalse(isProjectStorageSecretRef(`mushi/integration/${PROJECT}/github/github_installation_token_ref`, PROJECT))
  assertFalse(isProjectStorageSecretRef('mushi-github-installation-token', PROJECT))
})
