import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validatePlatformBody, validateRoutingConfig } from '../../_shared/integration-validation.ts'

// Each rejected shape below was accepted before the 2026-09-23 security pass.

Deno.test('platform settings refuse client-supplied vault references', () => {
  const err = validatePlatformBody({
    langfuse_secret_key_ref: 'vault://mushi/integration/99999999-8888-4777-8666-555555555555/sentry/sentry_auth_token_ref',
  })
  assertEquals(err?.code, 'VAULT_REF_NOT_ALLOWED')
})

Deno.test('platform settings refuse a Langfuse host that is not public https', () => {
  for (const host of ['http://cloud.langfuse.com', 'https://169.254.169.254', 'https://localhost:3000', 'https://10.0.0.5']) {
    assertEquals(validatePlatformBody({ langfuse_host: host })?.code, 'UNSAFE_URL', host)
  }
})

Deno.test('platform settings accept raw secrets, masked hints and public hosts', () => {
  assertEquals(
    validatePlatformBody({
      langfuse_host: 'https://us.cloud.langfuse.com',
      langfuse_public_key_ref: 'pk-lf-abc',
      langfuse_secret_key_ref: '…abcd',
    }),
    null,
  )
  assertEquals(validatePlatformBody({ langfuse_host: '' }), null)
})

Deno.test('routing config refuses vault refs and private Jira hosts', () => {
  assertEquals(validateRoutingConfig('jira', { apiToken: 'vault://x' })?.code, 'VAULT_REF_NOT_ALLOWED')
  assertEquals(validateRoutingConfig('jira', { baseUrl: 'https://192.168.1.10' })?.code, 'UNSAFE_URL')
  assertEquals(validateRoutingConfig('jira', { baseUrl: 'https://acme.atlassian.net', apiToken: 'ATATT3x' }), null)
})

Deno.test('GitHub routing names cannot carry an owner prefix', () => {
  assertEquals(validateRoutingConfig('github', { owner: 'acme', repo: 'victim-org/private' })?.code, 'VALIDATION_ERROR')
  assertEquals(validateRoutingConfig('github', { owner: 'acme', repo: 'public-tracker' }), null)
})
