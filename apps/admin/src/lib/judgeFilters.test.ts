/**
 * FILE: apps/admin/src/lib/judgeFilters.test.ts
 * PURPOSE: /judge Evaluations request (console QA 247, 107) and the
 *          Run-judge confirm copy (QA 248).
 */

import { describe, expect, it } from 'vitest'
import { judgeEvaluationsPath, judgeRunConfirmBody } from './judgeFilters'

const base = {
  sort: 'recent' as const,
  page: 1,
  pageSize: 50,
  disagreementOnly: false,
  prompt: null,
  from: null,
  to: null,
}

function params(path: string): URLSearchParams {
  return new URLSearchParams(path.split('?')[1])
}

describe('judgeEvaluationsPath', () => {
  it('asks the server for disagreements instead of filtering 50 rows here', () => {
    const p = params(judgeEvaluationsPath({ ...base, disagreementOnly: true }))
    expect(p.get('disagreement')).toBe('1')
    expect(p.get('limit')).toBe('50')
    expect(p.get('page')).toBe('1')
  })

  it('keeps the prompt row stage', () => {
    const p = params(judgeEvaluationsPath({ ...base, prompt: { version: 'v3', stage: 'stage1' } }))
    expect(p.get('prompt_version')).toBe('v3')
    expect(p.get('prompt_stage')).toBe('stage1')
  })

  it('sends the trend brush range only when both ends are set', () => {
    expect(params(judgeEvaluationsPath({ ...base, from: '2026-09-01T00:00:00.000Z', to: null })).has('from')).toBe(false)
    const p = params(judgeEvaluationsPath({ ...base, from: '2026-09-01T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', page: 2 }))
    expect(p.get('from')).toBe('2026-09-01T00:00:00.000Z')
    expect(p.get('to')).toBe('2026-09-15T00:00:00.000Z')
    expect(p.get('page')).toBe('2')
  })
})

describe('judgeRunConfirmBody', () => {
  it('names the reports a run will grade and that it spends LLM calls', () => {
    expect(judgeRunConfirmBody(3)).toMatch(/3 classified reports/)
    expect(judgeRunConfirmBody(3)).toMatch(/LLM call/)
    expect(judgeRunConfirmBody(1)).toMatch(/1 classified report it/)
  })

  it('says a run will likely grade nothing when nothing is waiting', () => {
    expect(judgeRunConfirmBody(0)).toMatch(/grade nothing/)
  })
})
