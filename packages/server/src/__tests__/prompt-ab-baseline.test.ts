/**
 * FILE: prompt-ab-baseline.test.ts
 * PURPOSE: A project that only cloned a candidate prompt (Prompt Lab saves a
 *          clone at 0% traffic, not active) must keep getting the global
 *          active prompt, with traffic_percentage deciding the split. Before
 *          2026-10-04 the clone was the project's only row and was served at
 *          100% as soon as it was saved, for every stage Clone allows.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

import { getPromptForStage } from '../../supabase/functions/_shared/prompt-ab.ts'

const PROJECT = 'p1'
const base = { traffic_percentage: 0, rollout_paused: false, rollout_canary_pct: 0, judge_rubric: null }
const globalActive = { ...base, id: 'g1', project_id: null, stage: 'fix', version: 'v1', prompt_template: 'GLOBAL', is_active: true, is_candidate: false }
const clone = (pct: number) => ({ ...base, id: 'c1', project_id: PROJECT, stage: 'fix', version: 'v1-fork', prompt_template: 'CLONE', is_active: false, is_candidate: true, traffic_percentage: pct })

afterEach(() => vi.restoreAllMocks())

describe('getPromptForStage baseline', () => {
  it('serves the global active prompt while a fresh clone sits at 0%', async () => {
    const db = makeFakeDb({ prompt_versions: [globalActive, clone(0)] })
    for (let i = 0; i < 20; i++) {
      const sel = await getPromptForStage(db as never, PROJECT, 'fix')
      expect(sel.promptTemplate).toBe('GLOBAL')
      expect(sel.isCandidate).toBe(false)
    }
  })

  it('routes to the clone only within its traffic share', async () => {
    const db = makeFakeDb({ prompt_versions: [globalActive, clone(30)] })
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    expect((await getPromptForStage(db as never, PROJECT, 'fix')).promptTemplate).toBe('CLONE')
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    expect((await getPromptForStage(db as never, PROJECT, 'fix')).promptTemplate).toBe('GLOBAL')
  })

  it('keeps serving the clone when there is no global prompt to fall back to', async () => {
    const db = makeFakeDb({ prompt_versions: [clone(0)] })
    expect((await getPromptForStage(db as never, PROJECT, 'fix')).promptTemplate).toBe('CLONE')
  })

  it('a project with its own active prompt ignores the global one', async () => {
    const own = { ...globalActive, id: 'o1', project_id: PROJECT, prompt_template: 'OWN' }
    const db = makeFakeDb({ prompt_versions: [globalActive, own] })
    expect((await getPromptForStage(db as never, PROJECT, 'fix')).promptTemplate).toBe('OWN')
  })
})
