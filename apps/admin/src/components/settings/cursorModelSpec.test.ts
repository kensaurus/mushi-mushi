/**
 * FILE: cursorModelSpec.test.ts
 * PURPOSE: The spend-down, Integrations, and review follow-up pickers write a
 *          Cursor model spec
 *          (`id` or `id?param=value`) and reopen a saved spec on the same controls.
 */

import { describe, expect, it } from 'vitest'
import {
  CURSOR_MODEL_OTHER,
  cursorModelSelection,
  cursorModelSpec,
  type CursorModelOption,
} from './cursorModelSpec'

const GROK: CursorModelOption = {
  id: 'grok-4.7',
  displayName: 'Grok 4.7',
  parameters: [
    {
      id: 'reasoning_effort',
      displayName: 'Reasoning effort',
      values: [{ value: 'xhigh' }, { value: 'high' }],
    },
    { id: 'context', displayName: 'Context', values: [{ value: '500k' }, { value: '200k' }] },
  ],
}

describe('cursorModelSelection', () => {
  it('maps a saved spec onto the model and its settings', () => {
    expect(
      cursorModelSelection('grok-4.7?reasoning_effort=xhigh&context=500k', [GROK], true),
    ).toEqual({
      modelId: 'grok-4.7',
      custom: '',
      params: { reasoning_effort: 'xhigh', context: '500k' },
    })
  })

  it('keeps an unknown id selected until the list has loaded, then offers Other', () => {
    expect(cursorModelSelection('custom-1?effort=high', [GROK], false).modelId).toBe('custom-1')
    expect(cursorModelSelection('custom-1?effort=high', [GROK], true)).toEqual({
      modelId: CURSOR_MODEL_OTHER,
      custom: 'custom-1?effort=high',
      params: {},
    })
  })

  it('treats a broken spec as Other once the list is ready', () => {
    expect(cursorModelSelection('grok 4.7', [GROK], true).modelId).toBe(CURSOR_MODEL_OTHER)
    expect(cursorModelSelection('', [GROK], true).modelId).toBe('')
  })
})

describe('cursorModelSpec', () => {
  it('writes params in the model’s own order and drops empty ones', () => {
    expect(
      cursorModelSpec('grok-4.7', '', { context: '500k', reasoning_effort: 'xhigh' }, GROK),
    ).toBe('grok-4.7?reasoning_effort=xhigh&context=500k')
    expect(cursorModelSpec('grok-4.7', '', { reasoning_effort: '' }, GROK)).toBe('grok-4.7')
  })

  it('leaves out a param value that would break the spec', () => {
    expect(
      cursorModelSpec('grok-4.7', '', { reasoning_effort: 'a&context=1', context: '500k' }, GROK),
    ).toBe('grok-4.7?context=500k')
    expect(cursorModelSpec('grok-4.7', '', { reasoning_effort: 'x=y?z' }, GROK)).toBe('grok-4.7')
  })

  it('keeps a typed id when Other is selected', () => {
    expect(cursorModelSpec(CURSOR_MODEL_OTHER, ' composer-2.5 ', {}, undefined)).toBe(
      'composer-2.5',
    )
    expect(cursorModelSpec('', '', {}, undefined)).toBe('')
  })
})
