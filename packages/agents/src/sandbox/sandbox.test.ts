/**
 * FILE: packages/agents/src/sandbox/sandbox.test.ts
 * PURPOSE: Coverage for the sandbox abstraction (V5.3 §2.10, M6).
 *          - resolveSandboxProvider: env safety + unsupported providers
 *          - buildSandboxConfig: deny-by-default + allowlist construction
 *          - LocalNoopSandbox: lifecycle + audit emission + path policy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveSandboxProvider, buildSandboxConfig, LocalNoopSandboxProvider, SandboxError } from './index.js'
import type { SandboxAuditEvent } from './types.js'
import type { FixContext } from '../types.js'

const baseContext: FixContext = {
  reportId: 'rep-12345678',
  projectId: 'proj-1',
  report: { description: 'd', category: 'BUG', severity: 'P3' },
  reproductionSteps: [],
  relevantCode: [],
  config: {
    maxLines: 200,
    scopeRestriction: 'component',
    repoUrl: 'https://github.com/example/repo.git',
  },
}

describe('resolveSandboxProvider (V5.3 §2.10)', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('returns local-noop in non-production', () => {
    process.env.NODE_ENV = 'test'
    const p = resolveSandboxProvider({ name: 'local-noop' })
    expect(p.name).toBe('local-noop')
  })

  it('refuses local-noop in production by default', () => {
    process.env.NODE_ENV = 'production'
    expect(() => resolveSandboxProvider({ name: 'local-noop' })).toThrow(SandboxError)
  })

  it('allows local-noop in production when explicitly opted in', () => {
    process.env.NODE_ENV = 'production'
    expect(() => resolveSandboxProvider({ name: 'local-noop', allowLocalInProduction: true })).not.toThrow()
  })

  it('refuses providers not yet implemented', () => {
    expect(() => resolveSandboxProvider({ name: 'modal' as never })).toThrow(/not yet implemented/)
  })
})

describe('buildSandboxConfig (V5.3 §2.10)', () => {
  it('enables deny-by-default network and allowlists the repo host', () => {
    const cfg = buildSandboxConfig(baseContext)
    expect(cfg.network.denyByDefault).toBe(true)
    expect(cfg.network.allowedHosts).toContain('github.com')
    expect(cfg.network.allowedHosts).toContain('registry.npmjs.org')
  })

  it('caps timeout at 600s even if a higher value is requested', () => {
    const cfg = buildSandboxConfig(baseContext, { timeoutSec: 9999 })
    expect(cfg.resources.timeoutSec).toBe(600)
  })

  it('blocks sensitive host paths via filesystem.blocked', () => {
    const cfg = buildSandboxConfig(baseContext)
    expect(cfg.filesystem.blocked).toEqual(expect.arrayContaining(['/etc', '/proc', '/sys']))
  })

  it('injects git env only when a token is provided', () => {
    const withToken = buildSandboxConfig(baseContext, { gitToken: 'ghs_abcdef' })
    const without = buildSandboxConfig(baseContext)
    expect(withToken.credentials?.env?.MUSHI_GIT_TOKEN).toBe('ghs_abcdef')
    expect(without.credentials?.env).toBeUndefined()
  })

  it('dedupes extra allowed hosts', () => {
    const cfg = buildSandboxConfig(baseContext, { extraAllowedHosts: ['registry.npmjs.org', 'private.example.com'] })
    const npmCount = cfg.network.allowedHosts.filter(h => h === 'registry.npmjs.org').length
    expect(npmCount).toBe(1)
    expect(cfg.network.allowedHosts).toContain('private.example.com')
  })
})

describe('LocalNoopSandbox lifecycle (V5.3 §2.10)', () => {
  let events: SandboxAuditEvent[]
  let onAudit: (e: SandboxAuditEvent) => void

  beforeEach(() => {
    events = []
    onAudit = e => events.push(e)
  })

  it('emits spawn -> exec -> destroy with redacted secrets', async () => {
    const cfg = buildSandboxConfig(baseContext, { gitToken: 'ghs_supersecret_value_xyz' })
    const sb = await LocalNoopSandboxProvider.createSandbox(cfg, onAudit)
    await sb.exec('git push origin HEAD MUSHI_GIT_TOKEN=ghs_supersecret_value_xyz')
    await sb.destroy()

    expect(events.map(e => e.type)).toEqual(['spawn', 'exec', 'destroy'])
    const execEvent = events.find(e => e.type === 'exec')!
    expect(JSON.stringify(execEvent.payload)).toContain('[REDACTED]')
    expect(JSON.stringify(execEvent.payload)).not.toContain('ghs_supersecret_value_xyz')
  })

  it('refuses operations after destroy', async () => {
    const sb = await LocalNoopSandboxProvider.createSandbox(buildSandboxConfig(baseContext), onAudit)
    await sb.destroy()
    await expect(sb.exec('echo hi')).rejects.toThrow(/destroyed/)
  })

  it('destroy is idempotent', async () => {
    const sb = await LocalNoopSandboxProvider.createSandbox(buildSandboxConfig(baseContext), onAudit)
    await sb.destroy()
    await expect(sb.destroy()).resolves.not.toThrow()
  })

  it('write+read roundtrip emits audit and returns bytes', async () => {
    const sb = await LocalNoopSandboxProvider.createSandbox(buildSandboxConfig(baseContext), onAudit)
    await sb.writeFile({ path: '/workspace/foo.ts', content: 'export const x = 1' })
    const bytes = await sb.readFile('/workspace/foo.ts')
    expect(new TextDecoder().decode(bytes)).toBe('export const x = 1')
    expect(events.some(e => e.type === 'file_write')).toBe(true)
    expect(events.some(e => e.type === 'file_read')).toBe(true)
    await sb.destroy()
  })
})

describe('SandboxAuditWriter buffering', () => {
  it('flushes on demand and re-buffers on insert error', async () => {
    const { SandboxAuditWriter } = await import('./persistence.js')
    let firstAttempt = true
    const fakeDb = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => {
          if (firstAttempt) {
            firstAttempt = false
            return { error: { message: 'transient' } }
          }
          return { error: null }
        }),
      })),
    } as unknown as ConstructorParameters<typeof SandboxAuditWriter>[0]

    const writer = new SandboxAuditWriter(fakeDb, 'run-1', 'proj-1')
    writer.push({ ts: new Date().toISOString(), type: 'exec', payload: {} })
    await expect(writer.flush()).rejects.toThrow(/transient/)
    // event should still be in buffer; second flush succeeds
    await expect(writer.flush()).resolves.not.toThrow()
  })
})
