/**
 * SDK upgrade route gate logic — mirrors sdk-upgrade.ts POST handler guards.
 * Run: cd packages/server && deno test supabase/functions/api/__tests__/sdk-upgrade-gates.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  evaluateSdkUpgradePostGate,
  type SdkUpgradeProjectSettings,
  type SdkUpgradeInFlightJob,
} from '../../_shared/sdk-upgrade-gates.ts'

Deno.test('sdk-upgrade gate — rejects when github_repo_url missing', () => {
  const result = evaluateSdkUpgradePostGate(
    { github_repo_url: null, github_installation_token_ref: 'vault:abc' },
    [],
    null,
  )
  assertEquals(result.action, 'reject')
  if (result.action === 'reject') {
    assertEquals(result.code, 'GITHUB_NOT_CONNECTED')
    assertEquals(result.status, 400)
  }
})

Deno.test('sdk-upgrade gate — rejects when github token ref missing', () => {
  const result = evaluateSdkUpgradePostGate(
    { github_repo_url: 'https://github.com/acme/app', github_installation_token_ref: null },
    [],
    null,
  )
  assertEquals(result.action, 'reject')
  if (result.action === 'reject') {
    assertEquals(result.code, 'GITHUB_TOKEN_MISSING')
    assertEquals(result.status, 400)
  }
})

Deno.test('sdk-upgrade gate — dedupes in-flight queued/running jobs', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [{ id: 'job-123', status: 'running' }],
    null,
  )
  assertEquals(result.action, 'reject')
  if (result.action === 'reject') {
    assertEquals(result.code, 'ALREADY_IN_PROGRESS')
    assertEquals(result.status, 409)
    assertEquals(result.jobId, 'job-123')
  }
})

Deno.test('sdk-upgrade gate — allows enqueue when github connected and idle', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [],
    null,
  )
  assertEquals(result, { action: 'enqueue' })
})

Deno.test('sdk-upgrade gate — treats missing settings row as not connected', () => {
  const result = evaluateSdkUpgradePostGate(null, [], null)
  assertEquals(result.action, 'reject')
  if (result.action === 'reject') {
    assertEquals(result.code, 'GITHUB_NOT_CONNECTED')
  }
})

Deno.test('sdk-upgrade gate — reuses open upgrade PR instead of enqueueing', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [],
    {
      number: 42,
      url: 'https://github.com/acme/app/pull/42',
      headRef: 'mushi/sdk-upgrade-mqj867a3',
    },
  )
  assertEquals(result.action, 'reuse')
  if (result.action === 'reuse') {
    assertEquals(result.prNumber, 42)
    assertEquals(result.branch, 'mushi/sdk-upgrade-mqj867a3')
  }
})

Deno.test('sdk-upgrade gate — refresh bypasses open PR reuse', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [],
    {
      number: 42,
      url: 'https://github.com/acme/app/pull/42',
      headRef: 'mushi/sdk-upgrade-mqj867a3',
    },
    { refresh: true },
  )
  assertEquals(result, { action: 'enqueue' })
})

Deno.test('sdk-upgrade gate — force alias bypasses open PR reuse', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [],
    {
      number: 42,
      url: 'https://github.com/acme/app/pull/42',
      headRef: 'mushi/sdk-upgrade-mqj867a3',
    },
    { force: true },
  )
  assertEquals(result, { action: 'enqueue' })
})
