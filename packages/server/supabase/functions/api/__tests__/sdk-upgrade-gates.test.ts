/**
 * SDK upgrade route gate logic — mirrors sdk-upgrade.ts POST handler guards.
 * Run: cd packages/server && deno test supabase/functions/api/__tests__/sdk-upgrade-gates.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

interface ProjectSettings {
  github_repo_url: string | null
  github_installation_token_ref: string | null
}

interface InFlightJob {
  id: string
  status: string
}

type GateResult =
  | { ok: true }
  | { ok: false; code: string; status: number; jobId?: string }

function evaluateSdkUpgradePostGate(
  settings: ProjectSettings | null,
  inFlight: InFlightJob[],
): GateResult {
  if (!settings?.github_repo_url) {
    return {
      ok: false,
      code: 'GITHUB_NOT_CONNECTED',
      status: 400,
    }
  }
  if (!settings.github_installation_token_ref) {
    return {
      ok: false,
      code: 'GITHUB_TOKEN_MISSING',
      status: 400,
    }
  }
  if (inFlight.length > 0) {
    return {
      ok: false,
      code: 'ALREADY_IN_PROGRESS',
      status: 409,
      jobId: inFlight[0].id,
    }
  }
  return { ok: true }
}

Deno.test('sdk-upgrade gate — rejects when github_repo_url missing', () => {
  const result = evaluateSdkUpgradePostGate(
    { github_repo_url: null, github_installation_token_ref: 'vault:abc' },
    [],
  )
  assertEquals(result, { ok: false, code: 'GITHUB_NOT_CONNECTED', status: 400 })
})

Deno.test('sdk-upgrade gate — rejects when github token ref missing', () => {
  const result = evaluateSdkUpgradePostGate(
    { github_repo_url: 'https://github.com/acme/app', github_installation_token_ref: null },
    [],
  )
  assertEquals(result, { ok: false, code: 'GITHUB_TOKEN_MISSING', status: 400 })
})

Deno.test('sdk-upgrade gate — dedupes in-flight queued/running jobs', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [{ id: 'job-123', status: 'running' }],
  )
  assertEquals(result, {
    ok: false,
    code: 'ALREADY_IN_PROGRESS',
    status: 409,
    jobId: 'job-123',
  })
})

Deno.test('sdk-upgrade gate — allows enqueue when github connected and idle', () => {
  const result = evaluateSdkUpgradePostGate(
    {
      github_repo_url: 'https://github.com/acme/app',
      github_installation_token_ref: 'vault:abc',
    },
    [],
  )
  assertEquals(result, { ok: true })
})

Deno.test('sdk-upgrade gate — treats missing settings row as not connected', () => {
  const result = evaluateSdkUpgradePostGate(null, [])
  assertEquals(result, { ok: false, code: 'GITHUB_NOT_CONNECTED', status: 400 })
})
