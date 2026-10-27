import { describe, expect, it } from 'vitest'
import { auditRepo, workflowsWithPrTarget } from './audit.js'

describe('auditRepo', () => {
  const base = { repo: 'kensaurus/glot.it', runnersError: null, heartbeatRunners: null, forkApproval: 'all_external_contributors', prTargetWorkflows: [], isPublic: false }

  it('marks Mushi runners by label or heartbeat and flags the rest', () => {
    const a = auditRepo({
      ...base,
      heartbeatRunners: new Set(['nuc-1']),
      runners: [
        { id: 1, name: 'mushi-nuc-1700000000', status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'mushi-nuc' }] },
        { id: 2, name: 'nuc-1', status: 'online', labels: [{ name: 'kensaurus-local' }] },
        { id: 3, name: 'old-box', status: 'offline', labels: [{ name: 'self-hosted' }] },
      ],
    })
    expect(a.runners.map((r) => r.setUpByMushi)).toEqual([true, true, false])
    expect(a.findings).toEqual([{ severity: 'warn', message: expect.stringContaining('"old-box" (id 3) was not set up by Mushi') }])
  })

  it('flags a Shai-Hulud style runner as critical', () => {
    const a = auditRepo({ ...base, runners: [{ id: 9, name: 'SHA1HULUD', status: 'online', labels: [{ name: 'mushi-x' }] }] })
    expect(a.findings[0]!.severity).toBe('critical')
    expect(a.findings[0]!.message).toMatch(/rotate your GitHub and npm tokens/)
  })

  it('reports weak fork approval, pull_request_target, a public repo and an unreadable runner list', () => {
    const a = auditRepo({ ...base, runners: null, runnersError: 'HTTP 403', forkApproval: 'first_time_contributors', prTargetWorkflows: ['triage.yml'], isPublic: true })
    const text = a.findings.map((f) => f.message).join('\n')
    expect(text).toContain('Administration: read')
    expect(text).toContain('first_time_contributors')
    expect(text).toContain('triage.yml')
  })
})

describe('workflowsWithPrTarget', () => {
  it('finds pull_request_target in any on: form and ignores comments', () => {
    expect(workflowsWithPrTarget([
      { name: 'a.yml', text: 'on: pull_request_target\n' },
      { name: 'b.yml', text: 'on:\n  pull_request_target:\n    types: [opened]\n' },
      { name: 'c.yml', text: 'on: [push, pull_request_target]\n' },
      { name: 'd.yml', text: '# never use pull_request_target here\non: pull_request\n' },
    ])).toEqual(['a.yml', 'b.yml', 'c.yml'])
  })
})
