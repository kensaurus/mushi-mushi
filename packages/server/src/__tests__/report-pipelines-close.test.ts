/**
 * FILE: report-pipelines-close.test.ts
 * PURPOSE: A report's open handoff pipelines end when the report is fixed or
 *          dismissed (pipeline 08607674 stayed "pending" after its report's
 *          PR merged, 2026-10-08). Cloud runs are left for the explicit Cancel.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  closeReportPipelines,
  closesPipelines,
  pipelineCloseNote,
} from '../../supabase/functions/_shared/report-pipelines-close.ts'

const P = 'p1'
const R = 'r1'

function seed() {
  return makeFakeDb({
    skill_pipeline_runs: [
      { id: 'handoff-open', project_id: P, report_id: R, mode: 'handoff', status: 'pending' },
      { id: 'handoff-running', project_id: P, report_id: R, mode: 'handoff', status: 'running' },
      { id: 'cloud-open', project_id: P, report_id: R, mode: 'cloud', status: 'running' },
      { id: 'handoff-done', project_id: P, report_id: R, mode: 'handoff', status: 'completed' },
      { id: 'other-report', project_id: P, report_id: 'r2', mode: 'handoff', status: 'pending' },
    ],
    skill_pipeline_step_runs: [
      { id: 's1', run_id: 'handoff-open', status: 'pending' },
      { id: 's2', run_id: 'handoff-open', status: 'passed' },
      { id: 's3', run_id: 'cloud-open', status: 'running' },
    ],
  })
}

describe('closeReportPipelines', () => {
  it('aborts open handoff runs of the report and skips their open steps', async () => {
    const db = seed()
    const closed = await closeReportPipelines(db as never, { reportId: R, projectId: P, reportStatus: 'fixed' })
    expect(closed.sort()).toEqual(['handoff-open', 'handoff-running'])
    const runs = (await db.from('skill_pipeline_runs').select('*')).data as Array<{ id: string; status: string }>
    const status = Object.fromEntries(runs.map((r) => [r.id, r.status]))
    expect(status).toMatchObject({
      'handoff-open': 'aborted',
      'handoff-running': 'aborted',
      'cloud-open': 'running',
      'handoff-done': 'completed',
      'other-report': 'pending',
    })
    const steps = (await db.from('skill_pipeline_step_runs').select('*')).data as Array<{ id: string; status: string; notes?: string }>
    expect(steps.find((s) => s.id === 's1')).toMatchObject({ status: 'skipped', notes: 'Closed: the report was fixed.' })
    expect(steps.find((s) => s.id === 's2')?.status).toBe('passed')
    expect(steps.find((s) => s.id === 's3')?.status).toBe('running')
  })

  it('does nothing for a status that keeps the report open', async () => {
    const db = seed()
    expect(await closeReportPipelines(db as never, { reportId: R, projectId: P, reportStatus: 'classified' })).toEqual([])
    expect(closesPipelines('fixing')).toBe(false)
  })

  it('says why on each step', () => {
    expect(pipelineCloseNote('dismissed')).toBe('Closed: the report was dismissed.')
    expect(pipelineCloseNote('fixed')).toBe('Closed: the report was fixed.')
  })
})

describe('wiring', () => {
  const fns = resolve(__dirname, '../../supabase/functions/_shared')
  it('runs on every status transition and on a merge', () => {
    expect(readFileSync(resolve(fns, 'report-transition.ts'), 'utf8')).toContain('closeReportPipelines(db, {')
    expect(readFileSync(resolve(fns, 'fix-merge.ts'), 'utf8')).toContain('closeReportPipelines(db as never, {')
  })
})
