/**
 * FILE: setup-signals-sdk-heartbeat.test.ts
 * PURPOSE: The "Install the SDK" setup step is done only on an SDK-key
 *          check-in. A test or site-audit report (which carry a platform), a
 *          repo-scan observation or an MCP key's calls marked lets-talk and
 *          mushi-demo "4/4 setup" while the switcher said "SDK not seen yet"
 *          (2026-10-26), which hid Home's checklist and its Fix it.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

const { loadProjectSetupSignals } = await import('../../supabase/functions/_shared/setup-signals.ts')

const P = '1000000f-0000-4000-8000-000000000000'
const now = new Date().toISOString()

function seed(keys: Array<Record<string, unknown>>) {
  return makeFakeDb({
    project_api_keys: keys,
    reports: [{ id: 'r1', project_id: P, environment: { platform: 'web' }, created_at: now }],
    project_sdk_observations: [{ project_id: P, sdk_package: '@mushi-mushi/web', sdk_version: '1.33.1', source: 'repo_scan' }],
  })
}

describe('loadProjectSetupSignals hasSdk', () => {
  it('is false with reports, an observation and an MCP key heartbeat but no SDK-key check-in', async () => {
    const db = seed([
      { project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: null },
      { project_id: P, is_active: true, scopes: ['report:write', 'mcp:read'], last_seen_at: now },
    ])
    const sig = (await loadProjectSetupSignals(db as never, [P])).get(P)!
    expect(sig.hasKey).toBe(true)
    expect(sig.heartbeat).toBeNull()
    expect(sig.hasSdk).toBe(false)
  })

  it('is true once an SDK key checks in', async () => {
    const db = seed([{ project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: now }])
    const sig = (await loadProjectSetupSignals(db as never, [P])).get(P)!
    expect(sig.hasSdk).toBe(true)
    expect(sig.heartbeat?.last_seen_at).toBe(now)
  })
})
