/**
 * FILE: apps/admin/src/lib/funnelBuilder.test.ts
 * PURPOSE: Step ordering, query construction, and saved-funnel storage for
 *          the Users & Funnels builder.
 */

import { describe, expect, it } from 'vitest'
import {
  FUNNEL_MAX_STEPS,
  SIGNUP_ACTIVATED_PRESET,
  addStep,
  buildFunnelQuery,
  canRunFunnel,
  deleteSavedFunnel,
  loadSavedFunnels,
  moveStep,
  removeStep,
  saveFunnel,
  savedFunnelsKey,
  type FunnelDefinition,
  type FunnelStorage,
} from './funnelBuilder'

function memoryStorage(): FunnelStorage & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v)
    },
    removeItem: (k) => {
      store.delete(k)
    },
  }
}

describe('step ordering', () => {
  it('appends in click order, ignores duplicates and invalid names, and caps at 8', () => {
    let steps: string[] = []
    steps = addStep(steps, 'signup_completed')
    steps = addStep(steps, ' project_created ')
    steps = addStep(steps, 'signup_completed')
    steps = addStep(steps, 'Not Valid')
    steps = addStep(steps, '$pageview')
    expect(steps).toEqual(['signup_completed', 'project_created'])

    for (let i = 0; i < 10; i++) steps = addStep(steps, `step_${i}`)
    expect(steps).toHaveLength(FUNNEL_MAX_STEPS)
    expect(steps[FUNNEL_MAX_STEPS - 1]).toBe('step_5')
  })

  it('never mutates the input array', () => {
    const original = ['a_1', 'b_2']
    const added = addStep(original, 'c_3')
    const removed = removeStep(original, 0)
    const moved = moveStep(original, 0, 1)
    expect(original).toEqual(['a_1', 'b_2'])
    expect(added).toEqual(['a_1', 'b_2', 'c_3'])
    expect(removed).toEqual(['b_2'])
    expect(moved).toEqual(['b_2', 'a_1'])
  })

  it('moves steps and clamps out-of-range targets', () => {
    const steps = ['one_1', 'two_2', 'three_3', 'four_4']
    expect(moveStep(steps, 3, 0)).toEqual(['four_4', 'one_1', 'two_2', 'three_3'])
    expect(moveStep(steps, 0, 99)).toEqual(['two_2', 'three_3', 'four_4', 'one_1'])
    expect(moveStep(steps, 1, -5)).toEqual(['two_2', 'one_1', 'three_3', 'four_4'])
    expect(moveStep(steps, 9, 0)).toEqual(steps)
    expect(moveStep(steps, 2, 2)).toEqual(steps)
  })

  it('requires two to eight steps to run', () => {
    expect(canRunFunnel([])).toBe(false)
    expect(canRunFunnel(['only_one'])).toBe(false)
    expect(canRunFunnel(['a_1', 'b_2'])).toBe(true)
    expect(canRunFunnel(SIGNUP_ACTIVATED_PRESET.steps)).toBe(true)
  })
})

describe('buildFunnelQuery', () => {
  it('encodes ordered steps, window, breakdown, and range', () => {
    const q = buildFunnelQuery(
      { steps: ['signup_completed', 'project_created'], window: '7d', breakdown: 'plan' },
      { from: '2026-09-01T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' },
    )
    const params = new URLSearchParams(q)
    expect(params.get('steps')).toBe('signup_completed,project_created')
    expect(params.get('window')).toBe('7d')
    expect(params.get('breakdown')).toBe('plan')
    expect(params.get('from')).toBe('2026-09-01T00:00:00.000Z')
    expect(params.get('to')).toBe('2026-09-21T00:00:00.000Z')
  })

  it('omits empty breakdown and range', () => {
    const q = buildFunnelQuery({ steps: ['a_1', 'b_2'], window: '1h', breakdown: '   ' })
    expect(q).toBe('steps=a_1%2Cb_2&window=1h')
  })
})

describe('saved funnels', () => {
  const projectId = 'proj_1'

  it('round-trips per project and upserts by id', () => {
    const storage = memoryStorage()
    const def: FunnelDefinition = {
      id: 'funnel:1',
      name: 'Checkout',
      steps: ['cart_viewed', 'checkout_started', 'order_placed'],
      window: '1d',
      breakdown: null,
    }
    expect(loadSavedFunnels(projectId, storage)).toEqual([])
    saveFunnel(projectId, def, storage)
    expect(loadSavedFunnels(projectId, storage)).toEqual([def])
    expect(loadSavedFunnels('proj_2', storage)).toEqual([])

    const renamed = { ...def, name: 'Checkout v2', breakdown: 'plan' }
    const list = saveFunnel(projectId, renamed, storage)
    expect(list).toEqual([renamed])
    expect(storage.store.has(savedFunnelsKey(projectId))).toBe(true)
  })

  it('never persists presets and removes the key when the last funnel is deleted', () => {
    const storage = memoryStorage()
    saveFunnel(projectId, SIGNUP_ACTIVATED_PRESET, storage)
    expect(storage.store.size).toBe(0)

    saveFunnel(projectId, { id: 'funnel:2', name: 'x', steps: ['a_1', 'b_2'], window: '7d', breakdown: null }, storage)
    expect(deleteSavedFunnel(projectId, 'funnel:2', storage)).toEqual([])
    expect(storage.store.has(savedFunnelsKey(projectId))).toBe(false)
  })

  it('drops corrupt rows instead of throwing', () => {
    const storage = memoryStorage()
    storage.setItem(
      savedFunnelsKey(projectId),
      JSON.stringify([
        { id: 'ok', name: 'ok', steps: ['a_1', 'Bad Name'], window: '7d', breakdown: '' },
        { id: 'bad-window', name: 'x', steps: [], window: '99d' },
        'garbage',
      ]),
    )
    expect(loadSavedFunnels(projectId, storage)).toEqual([
      { id: 'ok', name: 'ok', steps: ['a_1'], window: '7d', breakdown: null },
    ])
    storage.setItem(savedFunnelsKey(projectId), '{not json')
    expect(loadSavedFunnels(projectId, storage)).toEqual([])
    expect(loadSavedFunnels(projectId, null)).toEqual([])
  })
})
