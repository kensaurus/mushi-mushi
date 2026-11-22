import { describe, expect, it } from 'vitest'
import { doctorAction, doctorCheckId, doctorTitle, splitDoctorChecks, type DoctorCheck } from './doctorView'

const c = (over: Partial<DoctorCheck>): DoctorCheck => ({ name: 'x', status: 'fail', summary: '', ...over })

describe('doctorTitle', () => {
  it('uses the server label, else the id in words, never the per-app uuid', () => {
    expect(doctorTitle({ name: 'codebase_index:1000000a-0000', label: 'Code index' })).toBe('Code index')
    expect(doctorTitle({ name: 'codebase_index:1000000a-0000' })).toBe('Codebase index')
    expect(doctorTitle({ name: 'platform_slack_oauth' })).toBe('Slack oauth')
    expect(doctorCheckId('codebase_index:abc')).toBe('codebase_index')
  })
})

describe('splitDoctorChecks', () => {
  it('problems are fail then warn; info is optional; pass is ok', () => {
    const out = splitDoctorChecks([
      c({ name: 'ok', status: 'pass' }),
      c({ name: 'opt', status: 'info' }),
      c({ name: 'w', status: 'warn' }),
      c({ name: 'f', status: 'fail' }),
    ])
    expect(out.problems.map((x) => x.name)).toEqual(['f', 'w'])
    expect(out.optional.map((x) => x.name)).toEqual(['opt'])
    expect(out.ok.map((x) => x.name)).toEqual(['ok'])
  })
})

describe('doctorAction', () => {
  it('a code index problem re-indexes in place', () => {
    expect(doctorAction(c({ name: 'codebase_index:p1', status: 'warn', projectId: 'p1' }))).toEqual({ kind: 'reindex', projectId: 'p1', label: 'Re-index' })
  })
  it('queue and reports problems open their page; a console fixHref is a Fix button', () => {
    expect(doctorAction(c({ name: 'dead_letter', status: 'warn' }))).toMatchObject({ kind: 'link', to: '/queue' })
    expect(doctorAction(c({ name: 'stranded_reports', status: 'warn' }))).toMatchObject({ kind: 'link', to: '/reports' })
    expect(doctorAction(c({ name: 'llm_key', status: 'info', fixHref: '/settings?tab=byok' }))).toEqual({ kind: 'link', to: '/settings?tab=byok', label: 'Fix' })
  })
  it('a passing line, or a fix that is not a console route, has no button', () => {
    expect(doctorAction(c({ name: 'llm_key', status: 'pass', fixHref: '/settings?tab=byok' }))).toBeNull()
    expect(doctorAction(c({ name: 'platform_slack_oauth', fixHref: 'docs/operators/platform-setup-checks.md' }))).toBeNull()
    expect(doctorAction(c({ name: 'runtime_url' }))).toBeNull()
  })
})
