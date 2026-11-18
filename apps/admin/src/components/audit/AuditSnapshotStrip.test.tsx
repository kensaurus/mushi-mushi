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
  it('names the latest change instead of repeating the numbers', () => {
    const s = auditSentence(stats({ events24h: 18, humanCount24h: 18, totalEvents: 65, latestAction: 'settings.updated', latestActorEmail: 'kenji@example.com' }))
    expect(s).toBe('Latest: settings.updated by kenji@example.com.')
    expect(s).not.toMatch(/18/)
    expect(auditSentence(stats({ events24h: 3, failCount24h: 1, totalEvents: 3 }))).toBe('Failed actions in the last 24 hours need a look.')
  })
  it('covers a quiet day, an empty log and a plan without the audit log', () => {
    expect(auditSentence(stats({ totalEvents: 4 }))).toBe('No changes in the last 24 hours.')
    expect(auditSentence(stats({ totalEvents: 4, latestAction: 'api_key.created' }))).toBe(
      'No changes in the last 24 hours. Latest: api_key.created by Mushi Mushi.',
    )
    expect(auditSentence(stats({}))).toMatch(/^Nothing recorded yet/)
    expect(auditSentence(stats({ auditLogEntitlement: false, planDisplayName: 'Hobby' }))).toMatch(/isn't part of the Hobby plan/)
  })
})

describe('AuditSnapshotStrip', () => {
  it('shows two linked 24h numbers; the all-time total lives on the Log tab only', () => {
    act(() => {
      root.render(
        createElement(MemoryRouter, null, createElement(AuditSnapshotStrip, { stats: stats({ events24h: 18, humanCount24h: 18, totalEvents: 65, failCount24h: 2 }), statsFetchedAt: null })),
      )
    })
    const labels = Array.from(host.querySelectorAll('dt')).map((d) => d.textContent)
    expect(labels).toEqual(['24h changes', '24h failures'])
    expect(host.textContent).not.toContain('18/0/0')
    expect(host.textContent).not.toContain('65')
    expect(host.querySelectorAll('dd a')).toHaveLength(2)
  })
})
