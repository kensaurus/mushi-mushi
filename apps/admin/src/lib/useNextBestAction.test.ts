/**
 * FILE: apps/admin/src/lib/useNextBestAction.test.ts
 * PURPOSE: Rule-order and shape tests for the Next-Best-Action engine.
 *
 * These tests pin the *priority* of rules inside each scope so a careless
 * future edit doesn't quietly demote "FAIL" remediation below "WARN"
 * remediation (etc). We check that the returned action has the expected
 * tone + primary link shape, since PageHero / PageActionBar both key off
 * those fields. UI rendering is covered by the Playwright dogfood suite.
 */

import { describe, expect, it } from 'vitest'
import { computeNextBestAction } from './useNextBestAction'

describe('computeNextBestAction — rule priority', () => {
  describe('audit', () => {
    it('prioritises FAIL over WARN', () => {
      const action = computeNextBestAction({ scope: 'audit', failCount: 1, warnCount: 5 })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/FAIL/)
    })

    it('surfaces WARN when there are no FAILs', () => {
      const action = computeNextBestAction({ scope: 'audit', failCount: 0, warnCount: 3 })
      expect(action?.tone).toBe('check')
      expect(action?.title).toMatch(/WARN/)
    })

    it('returns null when all green', () => {
      expect(computeNextBestAction({ scope: 'audit', failCount: 0, warnCount: 0 })).toBeNull()
    })
  })

  describe('judge', () => {
    it('prioritises staleness > 48h over disagreement', () => {
      const action = computeNextBestAction({
        scope: 'judge',
        staleHoursAgo: 72,
        disagreementRate: 0.4,
        sampledCount: 50,
      })
      expect(action?.tone).toBe('plan')
      expect(action?.title).toMatch(/judge batch/i)
    })

    it('surfaces disagreement when fresh', () => {
      const action = computeNextBestAction({
        scope: 'judge',
        staleHoursAgo: 2,
        disagreementRate: 0.3,
        sampledCount: 50,
      })
      expect(action?.tone).toBe('check')
      expect(action?.title).toMatch(/30% judge disagreement/i)
    })

    it('returns null when fresh and aligned', () => {
      expect(
        computeNextBestAction({
          scope: 'judge',
          staleHoursAgo: 2,
          disagreementRate: 0.05,
          sampledCount: 50,
        }),
      ).toBeNull()
    })
  })

  describe('health', () => {
    it('prioritises red probes over amber', () => {
      const action = computeNextBestAction({ scope: 'health', redCount: 2, amberCount: 4 })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/failing/)
    })

    it('falls back to amber when no red', () => {
      const action = computeNextBestAction({ scope: 'health', redCount: 0, amberCount: 1 })
      expect(action?.tone).toBe('check')
    })
  })

  describe('dlq (Wave S)', () => {
    it('prioritises poisoned over oldest-pending over pending', () => {
      const action = computeNextBestAction({
        scope: 'dlq',
        poisonedCount: 1,
        oldestPendingMinutes: 120,
        pendingCount: 50,
      })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/poisoned/)
    })

    it('surfaces stalled retry worker when no poison but pending is old', () => {
      const action = computeNextBestAction({
        scope: 'dlq',
        poisonedCount: 0,
        oldestPendingMinutes: 60,
        pendingCount: 1,
      })
      expect(action?.tone).toBe('check')
      expect(action?.title).toMatch(/pending 60m/)
    })

    it('keeps calm for young pending rows', () => {
      const action = computeNextBestAction({
        scope: 'dlq',
        poisonedCount: 0,
        oldestPendingMinutes: 5,
        pendingCount: 3,
      })
      expect(action?.tone).toBe('check')
      expect(action?.title).toMatch(/3 pending DLQ rows/)
    })

    it('returns null when DLQ is empty', () => {
      expect(
        computeNextBestAction({
          scope: 'dlq',
          poisonedCount: 0,
          oldestPendingMinutes: null,
          pendingCount: 0,
        }),
      ).toBeNull()
    })
  })

  describe('prompt-lab (Wave S)', () => {
    it('prioritises untested drafts over eval freshness', () => {
      const action = computeNextBestAction({
        scope: 'prompt-lab',
        draftCount: 5,
        untestedDrafts: 2,
        lastRunHoursAgo: null,
      })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/untested/)
    })

    it('nudges to run evals when stale even if drafts are tested', () => {
      const action = computeNextBestAction({
        scope: 'prompt-lab',
        draftCount: 3,
        untestedDrafts: 0,
        lastRunHoursAgo: 24 * 8,
      })
      expect(action?.tone).toBe('check')
    })
  })

  describe('mcp (Wave S)', () => {
    it('prioritises expiring keys over unconfigured clients', () => {
      const action = computeNextBestAction({
        scope: 'mcp',
        expiringKeysIn7Days: 1,
        unconfiguredClients: 2,
      })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/MCP key expires this week/i)
    })
  })

  describe('billing (Wave S)', () => {
    it('prioritises past-due over projected overrun', () => {
      const action = computeNextBestAction({
        scope: 'billing',
        pastDueInvoices: 1,
        projectedOverrunPct: 30,
      })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/past-due/)
    })
  })

  describe('integrations (Wave S)', () => {
    it('prioritises disconnected over expiring', () => {
      const action = computeNextBestAction({
        scope: 'integrations',
        disconnectedCount: 1,
        expiringCount: 4,
      })
      expect(action?.tone).toBe('do')
      expect(action?.title).toMatch(/disconnected/)
    })
  })
})

describe('computeNextBestAction — shape contract', () => {
  it('every non-null action has a title + primary CTA', () => {
    const action = computeNextBestAction({ scope: 'audit', failCount: 2, warnCount: 0 })
    expect(action).toMatchObject({
      tone: expect.any(String),
      title: expect.any(String),
      primary: expect.objectContaining({
        kind: 'link',
        to: expect.stringContaining('/audit'),
        label: expect.any(String),
      }),
    })
  })

  it('secondary actions (if present) use the same kind discriminator', () => {
    const action = computeNextBestAction({ scope: 'audit', failCount: 2, warnCount: 0 })
    for (const s of action?.secondary ?? []) {
      expect(s.kind).toBe('link')
    }
  })
})
