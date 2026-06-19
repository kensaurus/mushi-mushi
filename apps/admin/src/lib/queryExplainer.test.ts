import { describe, expect, it } from 'vitest'
import { isQueryGuideExpanded, QUERY_MODES } from './queryExplainer'
import { isAuditGuideExpanded, AUDIT_TABS } from './auditExplainer'

describe('queryExplainer', () => {
  it('expands guide when recent errors exist', () => {
    expect(isQueryGuideExpanded(0)).toBe(false)
    expect(isQueryGuideExpanded(2)).toBe(true)
  })

  it('documents three query surfaces', () => {
    expect(QUERY_MODES).toHaveLength(3)
  })
})

describe('auditExplainer', () => {
  it('expands guide when 24h failures exist', () => {
    expect(isAuditGuideExpanded(0)).toBe(false)
    expect(isAuditGuideExpanded(1)).toBe(true)
  })

  it('documents audit tabs', () => {
    expect(AUDIT_TABS.map((t) => t.id)).toEqual(['log', 'actors', 'actions'])
  })
})
