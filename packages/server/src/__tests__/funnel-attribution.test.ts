/**
 * FILE: packages/server/src/__tests__/funnel-attribution.test.ts
 * PURPOSE: Pins how company-funnel milestones are attributed, after QA on
 *          2026-10-02 read first_report_received for the-wanting-mind with
 *          product_events.project_id = the mushi self project and
 *          properties.project_id = the host project, and asked which is right.
 *
 *          Both are, by design: server milestones are rows in Mushi's own
 *          funnel (self project), and the host project they describe is
 *          properties.project_id. These tests keep every server milestone on
 *          that contract, and pin that the R2 / R3 cases (non-test reports
 *          whose only earlier diagnosis was the console's precomputed test
 *          report, or none) qualify for first_diagnosis_ready.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNonRealReport } from '../../supabase/functions/_shared/first-report.ts'
import { MUSHI_EVENTS } from '../../supabase/functions/_shared/analytics-taxonomy.generated.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

/** The emitProductEvent({...}) call that writes `eventName`. */
function emitCall(src: string, eventName: string): string {
  const at = src.indexOf(`eventName: '${eventName}'`)
  expect(at, `${eventName} emitter`).toBeGreaterThan(-1)
  const start = src.lastIndexOf('emitProductEvent(db, {', at)
  const end = src.indexOf('});', at)
  return src.slice(start, end)
}

describe('server milestones live in the self project and name the host in properties', () => {
  const cases: Array<[string, string]> = [
    ['api/helpers.ts', 'first_report_received'],
    ['classify-report/index.ts', 'first_diagnosis_ready'],
  ]
  for (const [file, eventName] of cases) {
    it(`${eventName}: no projectId override, properties.project_id = host`, () => {
      const call = emitCall(read(file), eventName)
      expect(call).not.toMatch(/\n\s*projectId:/)
      expect(call).toMatch(/project_id: projectId,/)
    })
  }

  it('the taxonomy requires project_id on both server milestones', () => {
    for (const name of ['first_report_received', 'first_diagnosis_ready'] as const) {
      const spec = MUSHI_EVENTS[name] as { surface: string; required: readonly string[] }
      expect(spec.surface).toBe('server')
      expect(spec.required).toContain('project_id')
    }
  })

  it('the payload documents which column means what', () => {
    expect(read('_shared/product-events.ts')).toMatch(/NOT the project the\s+\* event is about/)
  })
})

describe('first_diagnosis_ready fires for the R2 / R3 shapes', () => {
  it('a widget report (no custom_metadata.source) is real; the console test report is not', () => {
    // R2 08d0ecde and R3 c0e99783: custom_metadata has no source.
    expect(isNonRealReport(null)).toBe(false)
    expect(isNonRealReport({})).toBe(false)
    // R2's only earlier diagnosed report: the console test report.
    expect(isNonRealReport({ source: 'admin_test_report' })).toBe(true)
  })

  it('the earlier-diagnosis lookup ignores precomputed test diagnoses and test reports', () => {
    const src = read('classify-report/index.ts')
    expect(src).toContain("stage2_model.is.null,stage2_model.neq.precomputed")
    expect(src).toMatch(/hadEarlierDiagnosis = \(\(prior \?\? \[\]\) as OldestReportRow\[\]\)\.some\(\s*\(row\) => !isNonRealReport\(row\.custom_metadata\)/)
  })

  it('diagnosis_viewed is a console event a browser may send (not server-owned)', () => {
    const spec = MUSHI_EVENTS.diagnosis_viewed as { surface: string }
    expect(spec.surface).toBe('console')
  })
})
