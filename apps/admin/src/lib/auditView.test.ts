import { describe, expect, it } from 'vitest'
import { auditActorLabel, auditCountTone, auditPagerVisible, groupAuditRuns, type AuditRowLike } from './auditView'

const row = (id: string, over: Partial<AuditRowLike> = {}): AuditRowLike => ({
  id,
  action: 'settings.updated',
  resource_type: 'github_repo',
  resource_id: '84f3eba2',
  actor_id: 'u1',
  actor_email: null,
  actor_name: 'Kenji',
  created_at: '2026-10-30T10:00:00Z',
  ...over,
})

describe('groupAuditRuns', () => {
  it('collapses consecutive identical rows and keeps them in order', () => {
    const groups = groupAuditRuns([
      row('a', { action: 'api_key.created', resource_type: 'project_api_key', resource_id: 'k1' }),
      row('b'),
      row('c'),
      row('d'),
      row('e'),
      row('f', { action: 'api_key.created', resource_type: 'project_api_key', resource_id: 'k2' }),
    ])
    expect(groups.map((g) => [g.id, g.entries.length])).toEqual([
      ['a', 1],
      ['b', 4],
      ['f', 1],
    ])
  })

  it('never merges across a different resource, actor or an event in between', () => {
    const groups = groupAuditRuns([
      row('a'),
      row('b', { resource_id: 'other' }),
      row('c', { actor_name: 'Test' }),
      row('d'),
      row('e', { action: 'report.created' }),
      row('f'),
    ])
    expect(groups).toHaveLength(6)
  })
})

describe('audit helpers', () => {
  it('labels actors by name or email, never by raw id', () => {
    expect(auditActorLabel(row('a', { actor_name: null, actor_display_email: 'x@y.z' }))).toBe('x@y.z')
    expect(auditActorLabel(row('a', { actor_name: null }))).toBe('Unnamed actor')
    expect(auditActorLabel(row('a', { actor_name: null, actor_id: null }))).toBe('system')
  })
  it('hides the pager on a single page', () => {
    expect(auditPagerVisible(1)).toBe(false)
    expect(auditPagerVisible(2)).toBe(true)
  })
  it('draws a zero failure or warning count neutral', () => {
    expect(auditCountTone('failure', 0)).toBe('neutral')
    expect(auditCountTone('warning', 0)).toBe('neutral')
    expect(auditCountTone('failure', 2)).toBe('danger')
    expect(auditCountTone('warning', 1)).toBe('warn')
  })
})
