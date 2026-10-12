import { describe, expect, it } from 'vitest'
import { mcpAuthAccessPlan, mcpAuthApproveBody, mcpAuthGrantedScopes, mcpAuthHandledMessage } from './mcpAuthProjects'

describe('mcpAuthAccessPlan (ADR 0026)', () => {
  const rows = {
    ok: true,
    data: {
      projects: [
        { id: 'a', name: 'Admin one', can_manage: true, organization_role: 'admin' },
        { id: 'b', name: 'Member one', can_manage: false, organization_role: 'member' },
      ],
    },
  }

  it('offers all, selected and one-project grants, defaulting to all projects when there are several', () => {
    const plan = mcpAuthAccessPlan(rows)
    expect(plan.modes).toEqual(['account', 'selected', 'project'])
    expect(plan.defaultMode).toBe('account')
    expect(plan.visible.map((p) => p.id)).toEqual(['a', 'b'])
    expect(plan.connectable).toEqual([{ id: 'a', name: 'Admin one' }])
  })

  // QA bug 269: a project key needs owner/admin, so only those projects are
  // offered for it — a member still gets account access with their own role.
  it('a member with no admin project can still grant account access with their own role', () => {
    const plan = mcpAuthAccessPlan({ ok: true, data: { projects: [{ id: 'b', name: 'B', can_manage: false }] } })
    expect(plan.modes).toEqual(['account', 'selected'])
    expect(plan.defaultMode).toBe('account')
  })

  it('one manageable project defaults to the narrow one-project grant', () => {
    expect(mcpAuthAccessPlan({ ok: true, data: { projects: [{ id: 'a', name: 'A', can_manage: true }] } }).defaultMode).toBe('project')
  })

  it('no projects or a failed load offers nothing', () => {
    expect(mcpAuthAccessPlan(null)).toMatchObject({ modes: [], defaultMode: null })
    expect(mcpAuthAccessPlan({ ok: true, data: { projects: [] } })).toMatchObject({ modes: [], defaultMode: null })
  })
})

describe('mcpAuthApproveBody', () => {
  it('builds the body the server expects for each access, or null while incomplete', () => {
    expect(mcpAuthApproveBody('t', 'account', {})).toEqual({ txn: 't', access: 'account' })
    expect(mcpAuthApproveBody('t', 'selected', { selectedIds: ['a', 'b', 'a'] })).toEqual({ txn: 't', access: 'selected', project_ids: ['a', 'b'] })
    expect(mcpAuthApproveBody('t', 'selected', { selectedIds: [] })).toBeNull()
    expect(mcpAuthApproveBody('t', 'project', { projectId: 'a' })).toEqual({ txn: 't', access: 'project', project_id: 'a' })
    expect(mcpAuthApproveBody('t', 'project', {})).toBeNull()
  })
})

describe('mcpAuthGrantedScopes', () => {
  it('an account grant drops report:write; a project grant keeps what was asked', () => {
    expect(mcpAuthGrantedScopes(['report:write', 'mcp:read', 'mcp:write'], 'account')).toEqual(['mcp:read', 'mcp:write'])
    expect(mcpAuthGrantedScopes(['report:write', 'mcp:read', 'mcp:write'], 'project')).toEqual(['report:write', 'mcp:read', 'mcp:write'])
  })
})

describe('mcpAuthHandledMessage', () => {
  it('an approval the client never collected says why and what to do (not a bare "already handled")', () => {
    const out = mcpAuthHandledMessage('approved', false)
    expect(out.kind).toBe('error')
    expect(out.message).toMatch(/has not picked it up/)
    expect(out.message).toMatch(/localhost/)
    expect(out.message).toMatch(/paste the redirect URL/)
  })

  it('a collected approval is complete, and expiry and denial keep their own wording', () => {
    expect(mcpAuthHandledMessage('approved', true)).toMatchObject({ kind: 'complete' })
    expect(mcpAuthHandledMessage('expired', undefined).message).toMatch(/expired/)
    expect(mcpAuthHandledMessage('denied', undefined).message).toMatch(/denied/)
  })
})
