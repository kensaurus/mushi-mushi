/**
 * The plugin SDK promises `newStatus` on report.status_changed and
 * `fix.pullRequestUrl` on fix events; the server sent `report.status` and
 * `fix.prUrl`. Jira transitions, the Linear state map and PagerDuty resolve
 * never ran, Discord printed "→ undefined", and no plugin showed a PR link
 * (2026-10-29). dispatchPluginEvent now fills the documented fields.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})

const { normalizePluginEventData } = await import('../../supabase/functions/_shared/plugins.ts')

describe('normalizePluginEventData', () => {
  it('adds newStatus to report.status_changed from report.status', () => {
    const out = normalizePluginEventData('report.status_changed', {
      report: { id: 'r1', status: 'fixed' },
      previousStatus: 'fixing',
    }) as Record<string, unknown>
    expect(out.newStatus).toBe('fixed')
    expect(out.previousStatus).toBe('fixing')
  })

  it('keeps a newStatus the caller already sent', () => {
    const out = normalizePluginEventData('report.status_changed', { report: { id: 'r1', status: 'fixed' }, newStatus: 'dismissed' }) as Record<string, unknown>
    expect(out.newStatus).toBe('dismissed')
  })

  it('adds fix.pullRequestUrl from fix.prUrl and keeps prUrl', () => {
    const out = normalizePluginEventData('fix.applied', { fix: { id: 'f1', prUrl: 'https://github.com/o/r/pull/7' } }) as { fix: Record<string, unknown> }
    expect(out.fix.pullRequestUrl).toBe('https://github.com/o/r/pull/7')
    expect(out.fix.prUrl).toBe('https://github.com/o/r/pull/7')
  })

  it('fills fix.status from the event name when the caller sent none', () => {
    const applied = normalizePluginEventData('fix.applied', { fix: { id: 'f1' } }) as { fix: Record<string, unknown> }
    expect(applied.fix.status).toBe('applied')
    const failed = normalizePluginEventData('fix.failed', { fix: { id: 'f1', status: 'error' } }) as { fix: Record<string, unknown> }
    expect(failed.fix.status).toBe('error')
  })

  it('does not touch other events, and passes non-objects through', () => {
    const data = { report: { id: 'r1', status: 'new' } }
    expect(normalizePluginEventData('report.created', data)).toEqual(data)
    expect(normalizePluginEventData('fix.applied', null)).toBeNull()
  })
})
