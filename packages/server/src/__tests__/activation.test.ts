/**
 * FILE: packages/server/src/__tests__/activation.test.ts
 * PURPOSE: Pins the company funnel's `activated` event (November GTM plan
 *          §6.1): the first real end-user report from a deployed app that got
 *          a diagnosis, once per organization. Test bugs from a dev server
 *          and reports Mushi files itself must never activate anyone.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activationDedupKey,
  hadEarlierActivation,
  isActivationCandidate,
  isActivationReport,
  isFirstActivationCandidate,
  type ActivationReportRow,
} from '../../supabase/functions/_shared/activation.ts'
import { MUSHI_EVENTS } from '../../supabase/functions/_shared/analytics-taxonomy.generated.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')

function row(over: Partial<ActivationReportRow> = {}): ActivationReportRow {
  return {
    id: 'r1',
    source: 'widget',
    custom_metadata: null,
    url: 'https://myapp.vercel.app/checkout',
    stage2_model: 'claude-sonnet-5-5',
    has_diagnosis: true,
    ...over,
  }
}

describe('isActivationReport', () => {
  it('a diagnosed widget report from a deployed page activates', () => {
    expect(isActivationReport(row())).toBe(true)
    expect(isActivationReport(row({ source: 'sdk' }))).toBe(true)
  })

  it('a report from a local dev server never activates', () => {
    for (const url of [
      'http://localhost:5173/',
      'http://127.0.0.1:8081/home',
      'http://192.168.1.20:3000/',
      'https://myapp.local/',
    ]) {
      expect(isActivationReport(row({ url })), url).toBe(false)
    }
  })

  it('a production Capacitor app on https://localhost (no port) and a native screen name count', () => {
    expect(isActivationReport(row({ url: 'https://localhost/' }))).toBe(true)
    expect(isActivationReport(row({ url: 'HomeScreen' }))).toBe(true)
    expect(isActivationReport(row({ url: null }))).toBe(true)
  })

  it('reports Mushi or an integration files never activate', () => {
    for (const source of ['site_watch', 'site_audit', 'security_advisory', 'skill_run', 'code_audit', 'fresh_eyes', 'sentry', 'slack', 'voice', 'api', 'store_review', 'ux_loop']) {
      expect(isActivationReport(row({ source })), source).toBe(false)
    }
  })

  it('console fixtures, the demo seed and hand-filed reports never activate', () => {
    for (const source of ['admin_test_report', 'mushi-marketing-seed', 'admin_file']) {
      expect(isActivationReport(row({ custom_metadata: { source } })), source).toBe(false)
    }
  })

  it('needs a real diagnosis: none, or the precomputed test fixture, does not count', () => {
    expect(isActivationReport(row({ has_diagnosis: false }))).toBe(false)
    expect(isActivationReport(row({ stage2_model: 'precomputed' }))).toBe(false)
  })
})

describe('isFirstActivationCandidate (fast-filter forces Stage 2 for it)', () => {
  const rows = [
    { id: 'a', source: 'widget', custom_metadata: { source: 'admin_test_report' }, url: 'https://myapp.app/' },
    { id: 'b', source: 'widget', custom_metadata: null, url: 'http://localhost:5173/' },
    { id: 'c', source: 'site_watch', custom_metadata: null, url: 'https://myapp.app/' },
    { id: 'd', source: 'widget', custom_metadata: null, url: 'https://myapp.app/pay' },
    { id: 'e', source: 'sdk', custom_metadata: null, url: 'https://myapp.app/' },
  ]

  it('is the first end-user report from a deployed page, skipping fixtures, dev servers and Mushi-filed reports', () => {
    expect(isFirstActivationCandidate(rows, 'd')).toBe(true)
    expect(isFirstActivationCandidate(rows, 'e')).toBe(false)
    expect(isFirstActivationCandidate(rows, 'b')).toBe(false)
    expect(isFirstActivationCandidate(rows, 'c')).toBe(false)
  })

  it('is false when the report is not in the rows read (more earlier rows than the window)', () => {
    expect(isFirstActivationCandidate(rows, 'zz')).toBe(false)
  })

  it('needs no diagnosis yet (it decides whether to get one)', () => {
    expect(isActivationCandidate(row({ has_diagnosis: false }))).toBe(true)
    expect(isActivationCandidate(row({ url: 'http://localhost:3000/' }))).toBe(false)
  })
})

describe('hadEarlierActivation', () => {
  it('is false when every earlier report is a dev-server or Mushi-filed one', () => {
    expect(hadEarlierActivation([row({ url: 'http://localhost:3000/' }), row({ source: 'site_watch' })])).toBe(false)
  })

  it('is true when one earlier report already qualified', () => {
    expect(hadEarlierActivation([row({ url: 'http://localhost:3000/' }), row()])).toBe(true)
  })
})

describe('the activated event', () => {
  it('is a server event that names the host project, in the taxonomy', () => {
    const spec = (MUSHI_EVENTS as Record<string, { surface: string; required: readonly string[] }>).activated
    expect(spec).toBeDefined()
    expect(spec.surface).toBe('server')
    expect(spec.required).toContain('project_id')
  })

  it('is emitted once per organization by classify-report, in the self project', () => {
    const src = readFileSync(resolve(FUNCTIONS, 'classify-report/index.ts'), 'utf8')
    const at = src.indexOf("eventName: 'activated'")
    expect(at, 'activated emitter').toBeGreaterThan(-1)
    const call = src.slice(src.lastIndexOf('emitProductEvent(db, {', at), src.indexOf('});', at))
    expect(call).not.toMatch(/\n\s*projectId:/)
    expect(call).toMatch(/project_id: projectId,/)
    expect(call).toMatch(/dedupKey: activationDedupKey\(/)
    expect(activationDedupKey('org-1')).toBe('activated:org-1')
  })

  it('classify-report skips the public demo project and checks earlier reports across the organization', () => {
    const src = readFileSync(resolve(FUNCTIONS, 'classify-report/index.ts'), 'utf8')
    const block = src.slice(src.indexOf('// Company funnel: `activated`'), src.indexOf("eventName: 'activated'"))
    expect(block).toMatch(/isActivationReport\(/)
    expect(block).toMatch(/hadEarlierActivation\(/)
    expect(block).toMatch(/demo_project_id/)
    expect(block).toMatch(/organization_id/)
  })
})
