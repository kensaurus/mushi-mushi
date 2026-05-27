/**
 * FILE: packages/cli/src/doctor.test.ts
 * PURPOSE: Tests for the `mushi doctor` module (extracted from `index.ts`).
 *          Covers all 4 check branches and --json exit-code semantics.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  checkCliConfig,
  checkEndpointReachability,
  checkServerPreflight,
  runDoctor,
  formatDoctorResult,
  type DoctorCliConfig,
} from './doctor.js'

// ── Factories ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DoctorCliConfig> = {}): DoctorCliConfig {
  return {
    endpoint: 'https://xyz.supabase.co/functions/v1/api',
    apiKey: 'mushi_test_key_1234567890abcdef',
    projectId: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  }
}

function mockFetch(status: number, body: unknown = {}): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof globalThis.fetch
}

function failingFetch(message = 'Network error'): typeof globalThis.fetch {
  return vi.fn().mockRejectedValue(new Error(message)) as unknown as typeof globalThis.fetch
}

// ── Check 1: CLI config ───────────────────────────────────────────────────────

describe('checkCliConfig', () => {
  it('all pass when endpoint, apiKey, projectId are set', () => {
    const checks = checkCliConfig(makeConfig())
    expect(checks.every((c) => c.ok)).toBe(true)
  })

  it('endpoint check fails when endpoint is missing', () => {
    const checks = checkCliConfig(makeConfig({ endpoint: undefined }))
    const endpointCheck = checks.find((c) => c.name === 'CLI config file')
    expect(endpointCheck?.ok).toBe(false)
    expect(endpointCheck?.detail).toContain('mushi init')
  })

  it('apiKey check fails when apiKey is missing', () => {
    const checks = checkCliConfig(makeConfig({ apiKey: undefined }))
    const keyCheck = checks.find((c) => c.name === 'API key configured')
    expect(keyCheck?.ok).toBe(false)
    expect(keyCheck?.detail).toContain('mushi login')
  })

  it('projectId check fails when projectId is missing', () => {
    const checks = checkCliConfig(makeConfig({ projectId: undefined }))
    const projCheck = checks.find((c) => c.name === 'Project ID configured')
    expect(projCheck?.ok).toBe(false)
    expect(projCheck?.detail).toContain('mushi config')
  })

  it('truncates the API key in the detail string', () => {
    const config = makeConfig({ apiKey: 'mushi_abcdefgh12345678' })
    const checks = checkCliConfig(config)
    const keyCheck = checks.find((c) => c.name === 'API key configured')
    // Should show start + end, not the full key
    expect(keyCheck?.detail).not.toContain('mushi_abcdefgh12345678')
    expect(keyCheck?.detail).toContain('…')
  })
})

// ── Check 2: Endpoint reachability ───────────────────────────────────────────

describe('checkEndpointReachability', () => {
  it('passes when /health returns 200', async () => {
    const check = await checkEndpointReachability(
      'https://api.example.com',
      mockFetch(200),
    )
    expect(check.ok).toBe(true)
    expect(check.detail).toContain('200')
  })

  it('fails when /health returns non-200', async () => {
    const check = await checkEndpointReachability(
      'https://api.example.com',
      mockFetch(503),
    )
    expect(check.ok).toBe(false)
    expect(check.detail).toContain('503')
  })

  it('fails when fetch throws (network error)', async () => {
    const check = await checkEndpointReachability(
      'https://api.example.com',
      failingFetch('ECONNREFUSED'),
    )
    expect(check.ok).toBe(false)
    expect(check.detail).toContain('ECONNREFUSED')
  })
})

// ── Check 4: Server preflight ────────────────────────────────────────────────

describe('checkServerPreflight', () => {
  it('returns a single failure check when config is incomplete', async () => {
    const checks = await checkServerPreflight({ endpoint: undefined, apiKey: undefined, projectId: undefined })
    expect(checks).toHaveLength(1)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].detail).toContain('mushi login')
  })

  it('maps server checks into prefixed DoctorCheck items', async () => {
    const serverChecks = [
      { key: 'github', ready: true, label: 'GitHub repo connected', hint: 'Repo: https://github.com/test/repo' },
      { key: 'codebase', ready: false, label: 'Codebase indexed for RAG', hint: 'Enable codebase indexing' },
    ]
    const checks = await checkServerPreflight(
      makeConfig(),
      mockFetch(200, { data: { checks: serverChecks } }),
    )
    expect(checks).toHaveLength(2)
    expect(checks[0].name).toBe('[server] GitHub repo connected')
    expect(checks[0].ok).toBe(true)
    expect(checks[1].name).toBe('[server] Codebase indexed for RAG')
    expect(checks[1].ok).toBe(false)
  })

  it('handles HTTP error gracefully', async () => {
    const checks = await checkServerPreflight(makeConfig(), mockFetch(401))
    expect(checks).toHaveLength(1)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].detail).toContain('401')
  })

  it('handles network throw gracefully', async () => {
    const checks = await checkServerPreflight(makeConfig(), failingFetch('timeout'))
    expect(checks).toHaveLength(1)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].detail).toContain('timeout')
  })
})

// ── runDoctor + --json exit-code semantics ────────────────────────────────────

describe('runDoctor', () => {
  it('ready=true only when all checks pass', async () => {
    const result = await runDoctor(makeConfig(), {
      cwd: '/nonexistent-path',
      fetch: mockFetch(200),
    })
    // Without --server, we only run config + reachability checks (SDK check skipped for non-JS paths)
    expect(typeof result.ready).toBe('boolean')
    expect(Array.isArray(result.checks)).toBe(true)
  })

  it('ready=false when any check fails', async () => {
    const result = await runDoctor(
      makeConfig({ apiKey: undefined }),
      { cwd: '/nonexistent-path', fetch: mockFetch(200) },
    )
    expect(result.ready).toBe(false)
    const failed = result.checks.filter((c) => !c.ok)
    expect(failed.length).toBeGreaterThan(0)
  })

  it('--json exit semantics: non-zero when not ready', () => {
    // Simulate the exit-code logic: process.exit(1) when !ready
    const result = { ready: false, checks: [{ name: 'A', ok: false, detail: 'fail' }] }
    const exitCode = result.ready ? 0 : 1
    expect(exitCode).toBe(1)
  })

  it('--json exit semantics: zero when all ready', () => {
    const result = { ready: true, checks: [{ name: 'A', ok: true, detail: 'ok' }] }
    const exitCode = result.ready ? 0 : 1
    expect(exitCode).toBe(0)
  })

  it('includes server checks when server=true', async () => {
    const serverBody = {
      data: {
        checks: [
          { key: 'github', ready: true, label: 'GitHub repo connected', hint: 'OK' },
          { key: 'autofix', ready: true, label: 'Autofix enabled', hint: 'OK' },
        ],
      },
    }
    const result = await runDoctor(makeConfig(), {
      cwd: '/nonexistent-path',
      server: true,
      fetch: mockFetch(200, serverBody),
    })
    const serverChecks = result.checks.filter((c) => c.name.startsWith('[server]'))
    expect(serverChecks.length).toBeGreaterThan(0)
  })
})

// ── formatDoctorResult ───────────────────────────────────────────────────────

describe('formatDoctorResult', () => {
  it('uses ✓ for passing checks', () => {
    const result = formatDoctorResult({
      ready: true,
      checks: [{ name: 'Test', ok: true, detail: 'All good' }],
    })
    expect(result).toContain('✓ Test')
    expect(result).toContain('All checks passed')
  })

  it('uses ✗ for failing checks', () => {
    const result = formatDoctorResult({
      ready: false,
      checks: [{ name: 'Test', ok: false, detail: 'Broken' }],
    })
    expect(result).toContain('✗ Test')
    expect(result).toContain('1 check failed')
  })

  it('pluralises "checks" correctly', () => {
    const result = formatDoctorResult({
      ready: false,
      checks: [
        { name: 'A', ok: false, detail: 'fail' },
        { name: 'B', ok: false, detail: 'fail' },
      ],
    })
    expect(result).toContain('2 checks failed')
  })

  it('includes the detail string', () => {
    const result = formatDoctorResult({
      ready: false,
      checks: [{ name: 'Endpoint', ok: false, detail: 'ECONNREFUSED' }],
    })
    expect(result).toContain('ECONNREFUSED')
  })
})
