/**
 * "How Mushi Mushi reached this diagnosis" must agree with the Pipeline strip
 * (2026-11-22). Report f6df5143, a vuln-watch advisory written from a template
 * with no model call, read "Diagnosis in progress · usually under a minute"
 * and "Not graded yet" four days later while the strip said both AI stages
 * were not needed.
 */

import { describe, expect, it } from 'vitest'
import type { ReportDetail } from '../components/report-detail/types'
import { reportDiagnosisView } from './reportDiagnosis'
import { checkNodes, diagnosisNodes } from './reportDiagnosisNodes'
import { buildDiagnosisGraph } from './reportDiagnosisGraph'

const CREATED = '2026-11-18T05:25:11.275Z'
const at = (iso: string) => Date.parse(iso)

const advisory = (over: Partial<ReportDetail> = {}) =>
  ({
    id: 'f6df5143-5db7-427f-b7ea-576f8b632fb8',
    status: 'classified',
    source: 'security_advisory',
    category: 'other',
    confidence: 1,
    created_at: CREATED,
    stage1_classification: null,
    stage2_analysis: null,
    stage2_partial: null,
    processing_error: null,
    judge_eval: null,
    fix_attempts: [],
    environment: { url: '', userAgent: 'vuln-watch' },
    ...over,
  }) as unknown as ReportDetail

describe('a report sorted without a model', () => {
  it('is its own view kind, not "pending"', () => {
    expect(reportDiagnosisView(advisory())).toEqual({ kind: 'no_model', source: 'security_advisory' })
  })

  it('an empty stage-2 object means a model ran, so it is not "no model"', () => {
    expect(reportDiagnosisView(advisory({ stage2_analysis: {} })).kind).toBe('pending')
  })

  it('an unsorted report with no result is still pending', () => {
    expect(reportDiagnosisView(advisory({ status: 'new' })).kind).toBe('pending')
  })

  it('a security advisory says it was written from a template, never "in progress"', () => {
    const [cause] = diagnosisNodes(advisory(), at('2026-11-22T00:00:00Z'))
    expect(cause.title).toBe('Written from a template: no AI needed')
    expect(cause.state).toBe('ok')
    expect(`${cause.title} ${cause.detail} ${cause.why}`).not.toMatch(/in progress|under a minute|still reading/i)
  })

  it('another source, or a person, gets the generic line', () => {
    const [cause] = diagnosisNodes(advisory({ source: 'widget' } as Partial<ReportDetail>))
    expect(cause.title).toBe('Sorted without AI')
  })

  it('the judge has nothing to grade instead of "Not graded yet"', () => {
    const judge = checkNodes(advisory()).find((n) => n.id === 'judge')
    expect(judge?.title).toBe('Nothing for the judge to grade')
    expect(judge?.detail).not.toMatch(/sample/)
  })

  it('the graph verdict does not say the diagnosis is in progress', () => {
    const graph = buildDiagnosisGraph(advisory(), at('2026-11-22T00:00:00Z'))
    expect(graph.verdict.label).toBe('Written from a template: no AI needed')
    expect(graph.verdict.label).not.toMatch(/in progress/i)
  })
})

describe('a report with no diagnosis and no error', () => {
  const untriaged = (created: string) => advisory({ status: 'new', source: 'widget', created_at: created } as Partial<ReportDetail>)

  it('reads "in progress" only in its first ten minutes', () => {
    const [fresh] = diagnosisNodes(untriaged('2026-11-22T00:00:00Z'), at('2026-11-22T00:05:00Z'))
    expect(fresh.title).toBe('Diagnosis in progress')
    expect(fresh.state).toBe('pending')
  })

  it('after that it is "Not diagnosed", never "usually under a minute"', () => {
    const [old] = diagnosisNodes(untriaged('2026-11-18T00:00:00Z'), at('2026-11-22T00:00:00Z'))
    expect(old.title).toBe('Not diagnosed')
    expect(old.detail).not.toMatch(/minute/)
    expect(old.needsLook).toBe(true)
    expect(buildDiagnosisGraph(untriaged('2026-11-18T00:00:00Z'), at('2026-11-22T00:00:00Z')).verdict.label).toBe('Not diagnosed')
  })

  it('a stored error shows its first line plainly, not a whole stack', () => {
    const [failed] = diagnosisNodes(
      advisory({ status: 'new', processing_error: 'Stage 2 returned non-2xx: 500\n    at classify (index.ts:12:3)\n    at run (index.ts:40:1)' }),
    )
    expect(failed.title).toBe('Diagnosis failed')
    expect(failed.why).toContain('Stage 2 returned non-2xx: 500')
    expect(failed.why).not.toContain('at classify')
  })
})
