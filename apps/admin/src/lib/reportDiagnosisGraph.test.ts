/**
 * FILE: apps/admin/src/lib/reportDiagnosisGraph.test.ts
 * PURPOSE: The diagnosis graph's rules, on fixtures shaped like real reports.
 *          The first fixture is a shortened copy of glot.it report 235a49e0
 *          (live-site watch, judge parse failure, Cursor agent stopped).
 */

import { describe, expect, it } from 'vitest'
import type { ReportDetail } from '../components/report-detail/types'
import { buildDiagnosisGraph, initialDiagnosisSelection } from './reportDiagnosisGraph'
import { NEEDS_LOOK_BELOW, headline } from './reportDiagnosisModel'

function report(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    id: '235a49e0-d06d-4494-85e8-b9da97431eca',
    project_id: 'p1',
    description: 'Judge response not valid JSON — defaulting to meaningful.\n\nPage: https://kensaur.us/glot-it/terms/',
    category: 'bug',
    severity: 'medium',
    summary: 'glot-judge-content LLM judge output failed JSON.parse',
    component: 'supabase/functions/glot-judge-content (LLM response parsing / fallback path)',
    confidence: 0.6,
    status: 'classified',
    environment: { url: 'https://kensaur.us/glot-it/terms/', userAgent: 'site-watch' } as ReportDetail['environment'],
    console_logs: null,
    network_logs: null,
    performance_metrics: null,
    screenshot_url: null,
    created_at: '2026-10-19T02:14:09.15+00:00',
    stage1_model: 'claude-haiku-4-5',
    stage1_classification: {
      symptom: 'Judge response not valid JSON — defaulting to meaningful',
      expected: 'Valid JSON response from the judge',
      actual: 'Judge returned invalid JSON, system defaulted to a meaningful fallback',
      category: 'bug',
      severity: 'medium',
      confidence: 0.75,
    },
    stage2_model: 'claude-sonnet-4-5',
    stage2_analysis: {
      rootCause: 'The judge LLM returned output that was not valid JSON. The parser falls back to "meaningful".',
      suggestedFix: 'Strip markdown fences, use JSON mode, retry once and fail closed with judge_error.',
      reproductionSteps: ['Trigger the crawl', 'Content goes to the judge', 'Judge returns non-JSON', 'Observe the fallback'],
      confidence: 0.6,
      code_context: { status: 'ok', fileCount: 5 },
      mcp_tool_calls: [{ ok: true, toolName: 'get_similar_bugs', resultCount: 0 }],
    },
    judge_eval: {
      id: 'j1',
      judge_score: 0.744,
      classification_agreed: true,
      judge_reasoning: 'Category bug fits. The component is inferred from the log message alone.',
      created_at: '2026-10-19T03:14:07Z',
    },
    fix_attempts: [
      {
        id: 'f1',
        status: 'failed',
        agent: 'cursor_cloud',
        llm_model: 'grok-4.7?reasoning_effort=xhigh&context=500k',
        pr_url: null,
        pr_number: null,
        pr_state: null,
        error: 'Cloud agent finished without opening a pull request.',
        created_at: '2026-10-20T03:47:29Z',
      } as unknown as NonNullable<ReportDetail['fix_attempts']>[number],
    ],
    ...overrides,
  } as ReportDetail
}

const ids = (g: ReturnType<typeof buildDiagnosisGraph>, lane: string) => g.nodes.filter((n) => n.lane === lane).map((n) => n.id)

describe('buildDiagnosisGraph on a real report shape', () => {
  const graph = buildDiagnosisGraph(report())
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  it('places every claim in its lane', () => {
    expect(ids(graph, 'evidence')).toEqual(['report', 'browser'])
    expect(ids(graph, 'signal')).toEqual(['symptom', 'similar', 'code'])
    expect(ids(graph, 'diagnosis')).toEqual(['cause', 'component', 'fixdir'])
    expect(ids(graph, 'check')).toEqual(['judge', 'repro'])
    expect(ids(graph, 'fix')).toEqual(['attempt', 'next'])
  })

  it('names where the report came from and the page', () => {
    const r = byId.get('report')!
    expect(r.title).toBe('Found by the live-site watch')
    expect(r.detail).toContain('/glot-it/terms/')
  })

  it('marks every claim under the threshold, and only those', () => {
    expect(byId.get('symptom')!.needsLook).toBe(true)
    expect(byId.get('cause')!.needsLook).toBe(true)
    expect(byId.get('cause')!.confidence).toBe(0.6)
    expect(byId.get('judge')!.needsLook).toBe(true)
    expect(byId.get('code')!.needsLook).toBe(false)
    expect(byId.get('fixdir')!.needsLook).toBe(false)
    for (const n of graph.nodes) {
      if (n.confidence != null && n.confidence < NEEDS_LOOK_BELOW && n.state !== 'pending') expect(n.needsLook, n.id).toBe(true)
    }
  })

  it('shows the failed agent run without the model query string, and a next step', () => {
    const a = byId.get('attempt')!
    expect(a.state).toBe('failed')
    expect(a.title).toBe('Agent stopped without a pull request')
    expect(a.detail).toBe('cursor_cloud · grok-4.7')
    expect(byId.get('next')!.title).toBe('Check the weak spots, then retry')
  })

  it('walks the path in reasoning order', () => {
    expect(graph.path).toEqual(['report', 'symptom', 'cause', 'component', 'judge', 'repro', 'attempt', 'next'])
  })

  it('only links nodes that exist, once each, and never to themselves', () => {
    const keys = graph.edges.map(([a, b]) => `${a}>${b}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const [a, b] of graph.edges) {
      expect(byId.has(a), a).toBe(true)
      expect(byId.has(b), b).toBe(true)
      expect(a).not.toBe(b)
    }
    expect(keys).toContain('browser>cause')
    expect(keys).toContain('code>component')
    expect(keys).toContain('attempt>next')
  })

  it('calls an unconfirmed diagnosis what it is', () => {
    expect(graph.verdict).toEqual({ tone: 'warn', label: 'Likely cause, not confirmed' })
  })

  it('opens on the first marked node on the path', () => {
    expect(initialDiagnosisSelection(graph)).toBe('symptom')
  })
})

describe('buildDiagnosisGraph evidence', () => {
  it('counts console errors and failed requests instead of "no browser evidence"', () => {
    const g = buildDiagnosisGraph(
      report({
        environment: { url: 'https://app.test/checkout', userAgent: 'Mozilla/5.0' } as ReportDetail['environment'],
        console_logs: [
          { level: 'error', message: 'TypeError: cannot read total of undefined', timestamp: 1 },
          { level: 'warn', message: 'slow', timestamp: 2 },
          { level: 'log', message: 'ok', timestamp: 3 },
        ],
        network_logs: [
          { method: 'POST', url: 'https://api.test/v1/cart', status: 500, duration: 30, timestamp: 1 },
          { method: 'GET', url: 'https://api.test/v1/me', status: 200, duration: 10, timestamp: 2 },
        ],
        performance_metrics: { lcp: 6408, cls: 0.12 },
      }),
    )
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(byId.has('browser')).toBe(false)
    expect(byId.get('report')!.title).toBe('Reported by a user')
    expect(byId.get('console')!.title).toBe('1 console error')
    expect(byId.get('console')!.why).toContain('TypeError')
    expect(byId.get('network')!.title).toBe('1 failed request')
    expect(byId.get('network')!.why).toContain('POST /v1/cart → 500')
    expect(byId.get('perf')!.detail).toBe('LCP 6408 ms · CLS 0.12')
    expect(g.edges).toContainEqual(['console', 'cause'])
  })
})

describe('buildDiagnosisGraph verdicts', () => {
  it('a confident diagnosis the judge agrees with is confirmed', () => {
    const g = buildDiagnosisGraph(
      report({
        confidence: 0.9,
        stage2_analysis: { rootCause: 'Stale total.', component: 'src/cart/Total.tsx', confidence: 0.9, reproductionSteps: ['Open cart'] },
        judge_eval: { id: 'j', judge_score: 0.92, classification_agreed: true, judge_reasoning: 'Good.', created_at: '' },
        fix_attempts: [],
      }),
    )
    expect(g.verdict).toEqual({ tone: 'ok', label: 'Diagnosis confirmed by the judge' })
    expect(g.nodes.find((n) => n.id === 'next')!.title).toBe('Fix it: dispatch or paste the prompt')
  })

  it('a judge that disagrees wins over confidence', () => {
    const g = buildDiagnosisGraph(report({ judge_eval: { id: 'j', judge_score: 0.4, classification_agreed: false, judge_reasoning: 'Wrong severity.', created_at: '' } }))
    expect(g.verdict.label).toBe('Judge disagrees: check the triage')
  })

  it('a merged fix reads as fixed, with production as the next step', () => {
    const g = buildDiagnosisGraph(
      report({
        status: 'fixed',
        fix_attempts: [
          { id: 'f', status: 'completed', agent: 'claude_code', llm_model: null, pr_url: 'https://github.com/x/y/pull/42', pr_number: 42, pr_state: 'merged', error: null, files_changed: ['a.ts'], created_at: '' } as unknown as NonNullable<ReportDetail['fix_attempts']>[number],
        ],
      }),
    )
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(g.verdict).toEqual({ tone: 'ok', label: 'Fixed' })
    expect(byId.get('attempt')!.title).toBe('Fix merged (PR #42)')
    expect(byId.get('attempt')!.href).toBe('https://github.com/x/y/pull/42')
    expect(byId.get('next')!.title).toBe('Check it in production')
  })

  it('a failed diagnosis is one marked node and a danger verdict', () => {
    const g = buildDiagnosisGraph(report({ stage2_analysis: null, stage1_classification: null, processing_error: 'stage2 timeout', judge_eval: null, fix_attempts: [] }))
    const cause = g.nodes.find((n) => n.id === 'cause')!
    expect(cause.state).toBe('failed')
    expect(cause.needsLook).toBe(true)
    expect(g.verdict.tone).toBe('danger')
    expect(g.nodes.some((n) => n.id === 'repro')).toBe(false)
    expect(g.nodes.some((n) => n.id === 'next')).toBe(false)
  })

  it('an area name instead of a file is marked, because an agent cannot find it', () => {
    const g = buildDiagnosisGraph(report({ stage2_analysis: { rootCause: 'x', component: 'Checkout', confidence: 0.95, reproductionSteps: ['a'] } }))
    const component = g.nodes.find((n) => n.id === 'component')!
    expect(component.needsLook).toBe(true)
    expect(component.why).toContain('names an area, not a file')
  })
})

describe('headline', () => {
  it('keeps the first sentence and cuts long ones at a word', () => {
    expect(headline('One. Two.')).toBe('One.')
    const cut = headline('word '.repeat(60), 40)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(41)
  })
})
