/**
 * FILE: audit-signals.test.ts
 * PURPOSE: The audit console's groupings. Search terms can no longer break
 *          the PostgREST `or=` filter (a comma used to return an empty page),
 *          actor kinds come from the `actor_type` column (actor_id is a uuid,
 *          so the old `LIKE 'agent_%'` filters always errored), and the three
 *          kinds partition every row so the actor-mix cards sum to the total.
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_ACTOR_TYPES,
  AUDIT_FAIL_ACTIONS,
  HUMAN_ACTOR_TYPES,
  auditSearchFilter,
  auditSearchTerms,
  outcomeActions,
  parseAuditOutcome,
} from '../../supabase/functions/_shared/audit-signals.ts'

describe('auditSearchTerms', () => {
  it('splits on commas and keeps dotted action names', () => {
    expect(auditSearchTerms('report.classified, fix')).toEqual(['report.classified', 'fix'])
  })

  it('strips PostgREST metacharacters so no term can add an operator', () => {
    expect(auditSearchTerms('fix),id.eq.(1')).toEqual(['fix', 'id.eq.1'])
    expect(auditSearchTerms('%*"\'')).toEqual([])
    expect(auditSearchTerms('a,,a, ,b')).toEqual(['a', 'b'])
  })

  it('builds one OR clause per term and column', () => {
    expect(auditSearchFilter(['fix'])).toBe('action.ilike.%fix%,resource_type.ilike.%fix%,resource_id.ilike.%fix%')
    expect(auditSearchFilter([])).toBeNull()
  })
})

describe('actor kinds', () => {
  it('counts every surface a person drives as human, and keys as agents', () => {
    expect([...HUMAN_ACTOR_TYPES]).toEqual(expect.arrayContaining(['user', 'console', 'cli', 'slack']))
    expect([...AGENT_ACTOR_TYPES]).toEqual(expect.arrayContaining(['agent', 'api_key']))
  })

  it('human and agent lists never overlap, so the three counts partition the rows', () => {
    const overlap = HUMAN_ACTOR_TYPES.filter((t) => (AGENT_ACTOR_TYPES as readonly string[]).includes(t))
    expect(overlap).toEqual([])
  })
})

describe('outcomes', () => {
  it('failure lists every failure action the banner counts', () => {
    expect(outcomeActions('failure')).toEqual(AUDIT_FAIL_ACTIONS)
    expect(outcomeActions('failure')).toContain('integration.disconnected')
  })

  it('ignores unknown outcomes', () => {
    expect(parseAuditOutcome('failure')).toBe('failure')
    expect(parseAuditOutcome('drop table')).toBeNull()
  })
})
