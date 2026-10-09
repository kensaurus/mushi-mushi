import { describe, expect, it } from 'vitest'
import { mcpAuthProjectChoice } from './mcpAuthProjects'

// QA bug 269: members were offered projects the consent route 403s on, and a
// failed projects load read as "No projects found".
describe('mcpAuthProjectChoice', () => {
  it('a failed load is not an empty account', () => {
    expect(mcpAuthProjectChoice(null)).toEqual({ kind: 'load-failed' })
    expect(mcpAuthProjectChoice({ ok: false })).toEqual({ kind: 'load-failed' })
  })

  it('offers only projects the user can connect', () => {
    const res = {
      ok: true,
      data: {
        projects: [
          { id: 'a', name: 'Admin one', can_manage: true },
          { id: 'b', name: 'Member one', can_manage: false },
        ],
      },
    }
    expect(mcpAuthProjectChoice(res)).toEqual({ kind: 'ok', projects: [{ id: 'a', name: 'Admin one' }] })
  })

  it('says when every visible project needs a higher role', () => {
    expect(mcpAuthProjectChoice({ ok: true, data: { projects: [{ id: 'b', name: 'B', can_manage: false }] } })).toEqual({
      kind: 'no-access',
      visibleCount: 1,
    })
    expect(mcpAuthProjectChoice({ ok: true, data: { projects: [] } })).toEqual({ kind: 'none' })
  })
})
