import { describe, expect, it } from 'vitest'
import { checklistProgress, selfHostChecklist, type ChecklistInput } from './selfHostChecklist'

const API = 'https://abc.supabase.co/functions/v1/api'

const healthy: ChecklistInput = {
  apiUrl: API,
  health: { mode: 'self-hosted', version: '0123456789abcdef', deployedAt: '2026-11-19T00:00:00Z' },
  ready: { status: 'ok', checks: { env: 'ok', db: 'ok' } },
  doctor: {
    status: 'pass',
    checks: [
      { name: 'runtime_url', status: 'pass', summary: 'Cron jobs call https://abc.supabase.co.' },
      { name: 'recovery_token', status: 'pass', summary: 'ok' },
      { name: 'recovery_cron', status: 'pass', summary: 'ok' },
      { name: 'screenshots_bucket', status: 'pass', summary: 'Private screenshots bucket exists.' },
      { name: 'llm_key', status: 'info', summary: 'No AI key yet.', hint: 'Add one.', fixHref: '/settings?tab=byok' },
      { name: 'console_url', status: 'pass', summary: 'Links open https://mushi.example.com.' },
    ],
  },
  doctorError: null,
}

const byId = (input: ChecklistInput) => new Map(selfHostChecklist(input).map((i) => [i.id, i]))

describe('selfHostChecklist', () => {
  it('a healthy minimal self-host: every item done, the missing AI key is optional with a Fix button', () => {
    const items = selfHostChecklist(healthy)
    expect(items.map((i) => i.id)).toEqual(['api', 'deploy', 'database', 'cron_url', 'jobs', 'screenshots', 'ai_key', 'console_url'])
    const m = byId(healthy)
    expect(m.get('deploy')).toMatchObject({ status: 'pass', detail: 'Running commit 0123456.' })
    expect(m.get('ai_key')).toMatchObject({ status: 'info', hint: 'Add one.', action: { kind: 'link', to: '/settings?tab=byok' } })
    expect(checklistProgress(items)).toEqual({ done: 8, total: 8, problems: 0 })
  })

  it('an unstamped deploy is optional; an API that does not answer fails and drops the deploy line', () => {
    expect(byId({ ...healthy, health: { ...healthy.health!, version: 'dev' } }).get('deploy')!.status).toBe('info')
    const down = byId({ ...healthy, health: null })
    expect(down.get('api')!.status).toBe('fail')
    expect(down.has('deploy')).toBe(false)
  })

  it('the database line names missing env or the db error; no answer is unknown', () => {
    expect(byId({ ...healthy, ready: { status: 'degraded', checks: { env: 'missing', missingEnv: ['SUPABASE_ANON_KEY'], db: 'error' } } }).get('database')).toMatchObject({
      status: 'fail',
      detail: 'Missing function env: SUPABASE_ANON_KEY.',
    })
    expect(byId({ ...healthy, ready: { status: 'degraded', checks: { env: 'ok', db: 'error', dbError: 'timeout' } } }).get('database')!.detail).toContain('timeout')
    expect(byId({ ...healthy, ready: null }).get('database')!.status).toBe('unknown')
  })

  it('background jobs take the worst of the token and the cron run', () => {
    const doctor = { ...healthy.doctor!, checks: healthy.doctor!.checks.map((c) => (c.name === 'recovery_cron' ? { ...c, status: 'fail' as const, summary: 'never ran' } : c)) }
    expect(byId({ ...healthy, doctor }).get('jobs')).toMatchObject({ status: 'fail', detail: 'never ran' })
  })

  it('cron jobs still calling Mushi Mushi Cloud is a problem that counts against progress', () => {
    const doctor = { ...healthy.doctor!, checks: healthy.doctor!.checks.map((c) => (c.name === 'runtime_url' ? { ...c, status: 'fail' as const, summary: 'Cron jobs still call Mushi Mushi Cloud', hint: 'Re-run selfhost up.' } : c)) }
    const items = selfHostChecklist({ ...healthy, doctor })
    expect(items.find((i) => i.id === 'cron_url')).toMatchObject({ status: 'fail', hint: 'Re-run selfhost up.' })
    expect(checklistProgress(items)).toEqual({ done: 7, total: 8, problems: 1 })
  })

  it('without the doctor the server lines are unknown and say why; an old server without a check says so', () => {
    const noDoctor = byId({ ...healthy, doctor: null, doctorError: 'HTTP 401' })
    expect(noDoctor.get('cron_url')).toMatchObject({ status: 'unknown', detail: 'The server checks did not run: HTTP 401' })
    const old = byId({ ...healthy, doctor: { status: 'pass', checks: [] } })
    expect(old.get('screenshots')!.detail).toContain('update it')
  })
})
