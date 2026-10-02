/**
 * FILE: apps/admin/src/components/recipe/recipeState.test.ts
 * PURPOSE: The Recipe page must never render "not checked" as green
 *          (Plan 019 success criterion 2). Every state maps explicitly, and
 *          anything unrecognised falls to `unknown`, never `ok`.
 */

import { describe, expect, it } from 'vitest'
import { RECIPE_ELEMENT_KEYS } from '../../lib/recipeTypes'
import {
  classifyLinkTarget,
  describeLastChecked,
  elementStateMeta,
  orderedRecipeElements,
  worstState,
} from './recipeState'

describe('elementStateMeta', () => {
  it('maps each of the five states to its own label, glyph and tone', () => {
    expect(elementStateMeta('ok')).toMatchObject({ state: 'ok', label: 'OK', glyph: 'check', tone: 'okSubtle' })
    expect(elementStateMeta('drift')).toMatchObject({ state: 'drift', label: 'Drift', glyph: 'triangle', tone: 'warnSubtle' })
    expect(elementStateMeta('unknown')).toMatchObject({ state: 'unknown', label: 'Unknown', glyph: 'question', tone: 'neutral' })
    expect(elementStateMeta('not_connected')).toMatchObject({
      state: 'not_connected',
      label: 'Not connected',
      glyph: 'ring',
      tone: 'neutral',
    })
    expect(elementStateMeta('error')).toMatchObject({ state: 'error', label: 'Error', glyph: 'cross', tone: 'dangerSubtle' })
  })

  it('gives every state a distinct glyph so colour is never the only signal', () => {
    const glyphs = ['ok', 'drift', 'unknown', 'not_connected', 'error'].map((s) => elementStateMeta(s).glyph)
    expect(new Set(glyphs).size).toBe(5)
  })

  it.each([['green'], ['OK'], ['passed'], [''], [null], [undefined], [0], [true], ['constructor'], ['toString'], ['__proto__']])(
    'renders the unrecognised value %j as unknown, never ok',
    (raw) => {
      const meta = elementStateMeta(raw)
      expect(meta.state).toBe('unknown')
      expect(meta.label).toBe('Unknown')
      expect(meta.tone).not.toMatch(/^ok/)
    },
  )

  it('only the ok state uses a green tone', () => {
    for (const s of ['drift', 'unknown', 'not_connected', 'error', 'mystery']) {
      expect(elementStateMeta(s).tone).not.toMatch(/^ok/)
    }
  })
})

describe('worstState', () => {
  it('ranks error > drift > unknown > not_connected > ok', () => {
    expect(worstState(['ok', 'not_connected'])).toBe('not_connected')
    expect(worstState(['ok', 'unknown', 'not_connected'])).toBe('unknown')
    expect(worstState(['unknown', 'drift'])).toBe('drift')
    expect(worstState(['drift', 'error', 'ok'])).toBe('error')
  })
  it('never reports ok when a card is unrecognised or the list is empty', () => {
    expect(worstState(['ok', 'mystery'])).toBe('unknown')
    expect(worstState([])).toBe('unknown')
  })
})

describe('orderedRecipeElements', () => {
  it('returns all 8 elements in lane order and fills a missing one as unknown', () => {
    const out = orderedRecipeElements({})
    expect(out.map((e) => e.key)).toEqual([...RECIPE_ELEMENT_KEYS])
    for (const el of out) {
      expect(el.state).toBe('unknown')
      expect(el.lastCheckedAt).toBeNull()
    }
  })
})

describe('describeLastChecked', () => {
  const fmt = () => 'some time ago'
  it('says "Never checked" for null instead of formatting the epoch', () => {
    expect(describeLastChecked(null, fmt).text).toBe('Never checked')
  })
  it('does not format an unparseable stamp', () => {
    expect(describeLastChecked('not-a-date', fmt).text).toBe('Check time unknown')
  })
  it('formats a real stamp', () => {
    expect(describeLastChecked('2026-10-01T00:00:00Z', fmt).text).toBe('Checked some time ago')
  })
})

describe('classifyLinkTarget', () => {
  it('only treats /paths as internal and https URLs as external', () => {
    expect(classifyLinkTarget('/code-health')).toBe('internal')
    expect(classifyLinkTarget('https://github.com/acme/shop')).toBe('external')
    expect(classifyLinkTarget('//evil.example')).toBe('text')
    expect(classifyLinkTarget('javascript:alert(1)')).toBe('text')
    expect(classifyLinkTarget('http://plain.example')).toBe('text')
  })
})
