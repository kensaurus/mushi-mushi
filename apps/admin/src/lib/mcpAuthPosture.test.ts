import { describe, expect, it } from 'vitest'
import { mcpAuthFaultForStatus, mcpAuthPosture } from './mcpAuthPosture'

describe('mcpAuthPosture', () => {
  const ready = { state: 'ready' as const, fault: null, projects: 'ok' as const, approveFailed: false }

  it('names the open request and the next step: approve, then return to the client', () => {
    expect(mcpAuthPosture(ready)).toMatchObject({
      title: 'Approve access',
      next: expect.stringMatching(/sent back to your MCP client/),
    })
    expect(mcpAuthPosture({ ...ready, state: 'redirecting' }).title).toBe('Return to your MCP client')
    expect(mcpAuthPosture({ ...ready, state: 'approving' }).title).toBe('Approving access')
  })

  it('a failed project load, an empty account, and a failed approve each say what to do', () => {
    expect(mcpAuthPosture({ ...ready, projects: 'failed' }).next).toMatch(/Reload this page/)
    expect(mcpAuthPosture({ ...ready, projects: 'empty' }).next).toMatch(/Create a project/)
    expect(mcpAuthPosture({ ...ready, approveFailed: true }).next).toMatch(/Try again/)
  })

  it('an approval the client never collected does not tell the user to start over blindly', () => {
    expect(mcpAuthFaultForStatus('approved', false)).toBe('not_collected')
    expect(mcpAuthFaultForStatus('approved', true)).toBeNull()
    const copy = mcpAuthPosture({ ...ready, state: 'error', fault: 'not_collected' })
    expect(copy.title).toMatch(/has not picked this up/)
    expect(copy.next).toMatch(/localhost/)
    expect(copy.next).not.toMatch(/already handled/)
  })

  it('a missing request, an expiry, and a denial point back at the MCP client', () => {
    expect(mcpAuthPosture({ ...ready, state: 'error', fault: 'missing_txn' }).next).toMatch(/Restart the connection/)
    expect(mcpAuthPosture({ ...ready, state: 'error', fault: 'expired' }).title).toMatch(/expired/)
    expect(mcpAuthPosture({ ...ready, state: 'denied' }).next).toMatch(/retry the login/)
    expect(mcpAuthPosture({ ...ready, state: 'complete' }).next).toMatch(/close this tab/)
  })
})
