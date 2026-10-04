/**
 * FILE: skill-step-dispatch-cancel.test.ts
 * PURPOSE: Console QA #24, the dispatch side. A skill pipeline cancelled from
 *          the console must not start a Cursor Cloud agent, and an agent
 *          created while the cancel landed is stopped at once. A late
 *          dispatch never reopens a step the cancel closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

import { dispatchPluginEvent } from '../../supabase/functions/_shared/plugins.ts'

const P = '1000000a-0000-4000-8000-0000000000c1'
const RUN = '4000000a-0000-4000-8000-0000000000c1'

let db: FakeDb
const calls: Array<{ url: string; method: string }> = []

function seed(runStatus: string) {
  db = makeFakeDb({
    project_plugins: [],
    project_settings: [{ project_id: P, cursor_api_key_ref: 'crsr_test_key', github_repo_url: 'https://github.com/o/r' }],
    skill_pipeline_runs: [{ id: RUN, project_id: P, status: runStatus }],
    skill_pipeline_step_runs: [{ id: 's0', run_id: RUN, step_index: 0, status: 'running' }],
    plugin_dispatch_log: [],
  })
}

const payload = { runId: RUN, stepIndex: 0, skillSlug: 'debug-error', contextPacket: '# packet', projectId: P }

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.endsWith('/v1/agents') && init?.method === 'POST') {
      return new Response(JSON.stringify({ agent: { id: 'bc-new' }, run: { id: 'run_1', agentId: 'bc-new', status: 'CREATING' } }), { status: 201 })
    }
    return new Response(JSON.stringify({ id: 'run_1' }), { status: 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('skill pipeline step dispatch after Cancel', () => {
  it('does not create an agent for a cancelled run', async () => {
    seed('aborted')
    await dispatchPluginEvent(db as never, P, 'skill_pipeline.step.dispatched', payload)
    expect(calls.filter((c) => c.url.includes('api.cursor.com'))).toEqual([])
  })

  it('creates the agent and records it while the run is open', async () => {
    seed('running')
    await dispatchPluginEvent(db as never, P, 'skill_pipeline.step.dispatched', payload)
    expect(calls.some((c) => c.url.endsWith('/v1/agents') && c.method === 'POST')).toBe(true)
    expect(db.tables.skill_pipeline_step_runs[0]).toMatchObject({ status: 'running', agent_ref: 'bc-new' })
  })

  it('stops an agent created while the cancel landed, and keeps the step closed', async () => {
    seed('running')
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      if (url.endsWith('/v1/agents') && init?.method === 'POST') {
        // The console cancel lands while Cursor creates the agent.
        db.tables.skill_pipeline_runs[0]!.status = 'aborted'
        db.tables.skill_pipeline_step_runs[0]!.status = 'skipped'
        return new Response(JSON.stringify({ agent: { id: 'bc-new' }, run: { id: 'run_1', agentId: 'bc-new' } }), { status: 201 })
      }
      return new Response(JSON.stringify({ id: 'run_1' }), { status: 200 })
    }))
    await dispatchPluginEvent(db as never, P, 'skill_pipeline.step.dispatched', payload)
    expect(calls.some((c) => c.url.endsWith('/v1/agents/bc-new/runs/run_1/cancel') && c.method === 'POST')).toBe(true)
    expect(db.tables.skill_pipeline_step_runs[0]?.status).toBe('skipped')
  })
})
