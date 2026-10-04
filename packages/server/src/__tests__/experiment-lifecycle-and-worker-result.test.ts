/**
 * FILE: experiment-lifecycle-and-worker-result.test.ts
 * PURPOSE: Experiment launch / stop / delete refuse impossible transitions
 *          (the routes used to answer ok:true for anything), and proxied
 *          worker replies reach the console as one readable sentence, never
 *          a JSON blob or an unhandled parse error.
 */

import { describe, expect, it } from 'vitest'
import {
  experimentTransitionError,
  MIN_VARIANTS_TO_LAUNCH,
} from '../../supabase/functions/_shared/experiment-lifecycle.ts'
import { readWorkerResult } from '../../supabase/functions/_shared/worker-result.ts'

describe('experimentTransitionError', () => {
  it('launches only a draft with a control and a treatment', () => {
    expect(experimentTransitionError('launch', 'draft', MIN_VARIANTS_TO_LAUNCH)).toBeNull()
    expect(experimentTransitionError('launch', 'draft', 1)).toMatch(/at least 2 variants/)
    expect(experimentTransitionError('launch', 'running', 3)).toMatch(/already running/)
  })

  it('stops only a running experiment', () => {
    expect(experimentTransitionError('stop', 'running', 2)).toBeNull()
    expect(experimentTransitionError('stop', 'draft', 2)).toMatch(/only a running/)
  })

  it('deletes only drafts', () => {
    expect(experimentTransitionError('delete', 'draft', 0)).toBeNull()
    expect(experimentTransitionError('delete', 'stopped', 2)).toMatch(/Only drafts/)
  })
})

describe('readWorkerResult', () => {
  const reply = (body: string, status = 200) => new Response(body, { status })

  it('passes a JSON success body through', async () => {
    expect(await readWorkerResult(reply('{"ok":true,"findings":3}'), 'x')).toEqual({
      ok: true,
      body: { ok: true, findings: 3 },
    })
  })

  it('turns an error object into its message', async () => {
    expect(await readWorkerResult(reply('{"error":"No contract graph yet"}', 400), 'fallback')).toEqual({
      ok: false,
      status: 400,
      message: 'No contract graph yet',
    })
    expect(await readWorkerResult(reply('{"ok":false,"error":{"code":"X","message":"Key missing"}}'), 'fallback')).toEqual({
      ok: false,
      status: 502,
      message: 'Key missing',
    })
  })

  it('uses the fallback sentence for plain-text or empty failures', async () => {
    const plain = await readWorkerResult(reply('upstream exploded', 500), 'The scan could not finish.')
    expect(plain).toEqual({ ok: false, status: 500, message: 'The scan could not finish.' })
    const empty = await readWorkerResult(reply('', 200), 'The scan could not finish.')
    expect(empty.ok).toBe(false)
  })
})
