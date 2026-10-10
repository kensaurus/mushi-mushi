/**
 * recordPromptResult used to read avg_judge_score/total_evaluations and write
 * the new average back from JS. judge-batch fires it without awaiting, so
 * concurrent scores for one version lost increments. It now delegates to the
 * single-statement record_prompt_judge_score RPC (20261010180200).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

import { recordPromptResult } from '../../supabase/functions/_shared/prompt-ab.ts'

function dbReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  const from = vi.fn(() => { throw new Error('no table access expected') })
  return { db: { rpc, from }, rpc, from }
}

describe('recordPromptResult', () => {
  it('updates through the atomic RPC with the full scope', async () => {
    const { db, rpc, from } = dbReturning({ data: 1, error: null })
    await recordPromptResult(db as never, 'r1', 'v2', 0.8, { projectId: 'p1', stage: 'stage1' })
    expect(rpc).toHaveBeenCalledWith('record_prompt_judge_score', {
      p_version: 'v2', p_score: 0.8, p_project_id: 'p1', p_stage: 'stage1',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('scopes to global rows when no project is given and logs ambiguity', async () => {
    const { db, rpc } = dbReturning({ data: 2, error: null })
    await recordPromptResult(db as never, 'r1', 'v2', 0.5)
    expect(rpc).toHaveBeenCalledWith('record_prompt_judge_score', {
      p_version: 'v2', p_score: 0.5, p_project_id: null, p_stage: null,
    })
    expect(fakeLog.error).toHaveBeenCalledWith(expect.stringContaining('Multiple prompt_versions rows'), expect.anything())
  })
})

describe('20261010180200_record_prompt_judge_score', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261010180200_record_prompt_judge_score.sql'),
    'utf8',
  ).replace(/--[^\n]*/g, '')

  it('increments in one UPDATE from the row being updated', () => {
    expect(sql).toMatch(/update public\.prompt_versions\s+set avg_judge_score = \(coalesce\(avg_judge_score, 0\) \* coalesce\(total_evaluations, 0\) \+ p_score\)/)
    expect(sql).toMatch(/total_evaluations = coalesce\(total_evaluations, 0\) \+ 1/)
    expect(sql).toMatch(/project_id is not distinct from p_project_id/)
    expect(sql).toMatch(/if coalesce\(cardinality\(v_ids\), 0\) <> 1 then/)
  })

  it('is service-role only', () => {
    expect(sql).toMatch(/revoke all on function public\.record_prompt_judge_score\(text, double precision, uuid, text\) from public, anon, authenticated;/)
    expect(sql).toMatch(/grant execute on function public\.record_prompt_judge_score\(text, double precision, uuid, text\) to service_role;/)
  })
})
