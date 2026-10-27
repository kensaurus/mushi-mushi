/**
 * @vitest-environment jsdom
 *
 * Audit log status: one sentence on the last 24 hours and three numbers that
 * open the filtered log. The "Actor mix 18/0/0" ratio is gone.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditSnapshotStrip, auditSentence } from './AuditSnapshotStrip'
import { EMPTY_AUDIT_STATS, type AuditStats } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const stats = (over: Partial<AuditStats>): AuditStats => ({ ...EMPTY_AUDIT_STATS, auditLogEntitlement: true, ...over })

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('auditSentence', () => {
  it('says who made the last day of changes, in words', () => {
    expect(auditSentence(stats({ events24h: 18, humanCount24h: 18, totalEvents: 65 }))).toBe('18 changes in the last 24 hours (18 by people). No failures.')
    expect(auditSentence(stats({ events24h: 3, humanCount24h: 1, agentCount24h: 2, failCount24h: 1 }))).toBe(
      '3 changes in the last 24 hours (1 by a person, 2 by agents). 1 failure to look at.',
    )
  })
  it('covers a quiet day, an empty log and a plan without the audit log', () => {
    expect(auditSentence(stats({ totalEvents: 4 }))).toBe('No changes in the last 24 hours.')
    expect(auditSentence(stats({}))).toMatch(/^Nothing recorded yet/)
    expect(auditSentence(stats({ auditLogEntitlement: false, planDisplayName: 'Hobby' }))).toMatch(/isn't part of the Hobby plan/)
  })
})

describe('AuditSnapshotStrip', () => {
  it('shows three linked numbers and no actor ratio', () => {
    act(() => {
      root.render(
        createElement(MemoryRouter, null, createElement(AuditSnapshotStrip, { stats: stats({ events24h: 18, humanCount24h: 18, totalEvents: 65, failCount24h: 2 }), statsFetchedAt: null })),
      )
    })
    const labels = Array.from(host.querySelectorAll('dt')).map((d) => d.textContent)
    expect(labels).toEqual(['Changes (24h)', 'Failures (24h)', 'All time'])
    expect(host.textContent).not.toContain('18/0/0')
    expect(host.querySelectorAll('dd a')).toHaveLength(3)
  })
})
