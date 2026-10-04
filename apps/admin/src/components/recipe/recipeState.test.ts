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
  elementsBehindWorst,
  factLabel,
  orderedRecipeElements,
  problemCountText,
  worstState,
} from './recipeState'

describe('elementStateMeta', () => {
  it('maps each of the five states to its own plain-English label, glyph and tone', () => {
    expect(elementStateMeta('ok')).toMatchObject({ state: 'ok', label: 'OK', glyph: 'check', tone: 'okSubtle' })
    expect(elementStateMeta('drift')).toMatchObject({ state: 'drift', label: 'Needs attention', glyph: 'triangle', tone: 'warnSubtle' })
    expect(elementStateMeta('unknown')).toMatchObject({ state: 'unknown', label: 'Not checked yet', glyph: 'question', tone: 'neutral' })
    expect(elementStateMeta('not_connected')).toMatchObject({
      state: 'not_connected',
      label: 'Not set up',
      glyph: 'ring',
      tone: 'neutral',
    })
    expect(elementStateMeta('error')).toMatchObject({ state: 'error', label: 'Check failed', glyph: 'cross', tone: 'dangerSubtle' })
  })

  it('an unknown element that WAS checked reads "Not confirmed", never "Not checked yet" beside a check time', () => {
    expect(elementStateMeta('unknown', '2026-10-01T00:00:00Z')).toMatchObject({ state: 'unknown', label: 'Not confirmed', tone: 'neutral' })
    expect(elementStateMeta('unknown', null).label).toBe('Not checked yet')
    // Only unknown changes: a check time never turns another state's label.
    expect(elementStateMeta('drift', '2026-10-01T00:00:00Z').label).toBe('Needs attention')
    expect(elementStateMeta('ok', '2026-10-01T00:00:00Z').label).toBe('OK')
  })

  it('no label is a bare jargon word', () => {
    for (const s of ['ok', 'drift', 'unknown', 'not_connected', 'error']) {
      expect(elementStateMeta(s).label).not.toMatch(/^(Drift|Unknown|Error|Deviance)$/)
    }
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
      expect(meta.label).toBe('Not checked yet')
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

  const el = (state: string, lastCheckedAt: string | null) => ({
    key: 'env' as const, label: 'Environment variables', lane: 'runtime' as const, state: state as 'ok', reason: 'All 2 required variables are set in GitHub.', lastCheckedAt, facts: {}, findingsCount: 0, links: [],
  })

  it('never passes "OK" through without a check time: it becomes "Not checked yet" (the "Env names OK · Never checked" bug)', () => {
    const [env] = orderedRecipeElements({ env: el('ok', null) }).filter((e) => e.key === 'env')
    expect(env.state).toBe('unknown')
    expect(env.reason).toBe('Not checked yet, so this is not a pass.')
    expect(elementStateMeta(env.state, env.lastCheckedAt).label).toBe('Not checked yet')
    expect(describeLastChecked(env.lastCheckedAt, () => 'x').text).toBe('Not checked yet')
  })

  it('keeps a checked OK, and the worst state never reads OK above an unchecked card', () => {
    const out = orderedRecipeElements({ env: el('ok', '2026-10-03T00:00:00Z') })
    expect(out.find((e) => e.key === 'env')?.state).toBe('ok')
    const unchecked = orderedRecipeElements({ env: el('ok', null) })
    expect(worstState(unchecked.map((e) => e.state))).not.toBe('ok')
  })
})

describe('header and card wording', () => {
  const e = (key: 'env' | 'gates' | 'ci', state: string) => ({ key, label: key, lane: 'build' as const, state: state as 'ok', reason: 'r', lastCheckedAt: null, facts: {}, findingsCount: 0, links: [] })
  it('the header names exactly the elements in the worst state, and none when the worst is OK or not set up', () => {
    expect(elementsBehindWorst([e('env', 'drift'), e('gates', 'drift'), e('ci', 'unknown')]).map((x) => x.key)).toEqual(['env', 'gates'])
    expect(elementsBehindWorst([e('env', 'ok'), e('gates', 'not_connected')])).toEqual([])
  })
  it('zero problems only reads "Nothing open to fix" for a judged element', () => {
    expect(problemCountText('drift', 3)).toBe('3 problems to fix')
    expect(problemCountText('ok', 0)).toBe('Nothing open to fix')
    expect(problemCountText('unknown', 0)).toBe('Not checked for problems')
    expect(problemCountText('not_connected', 0)).toBe('Not checked for problems')
  })
})

describe('factLabel', () => {
  it('turns the server fact keys into plain labels and keeps unknown keys readable', () => {
    expect(factLabel('deviance')).toBe('Off-system score')
    expect(factLabel('manifest')).toBe('Recipe file')
    expect(factLabel('someNewFact')).toBe('Some new fact')
    expect(factLabel('constructor')).toBe('Constructor')
  })
})

describe('describeLastChecked', () => {
  const fmt = () => 'some time ago'
  it('says "Not checked yet" for null instead of formatting the epoch', () => {
    expect(describeLastChecked(null, fmt).text).toBe('Not checked yet')
  })
  it('with no stamp, follows the state: a failed or problem element never reads "Not checked yet"', () => {
    expect(describeLastChecked(null, fmt, 'error').text).toBe('Last check did not finish')
    expect(describeLastChecked(null, fmt, 'drift').text).toBe('Check time not recorded')
    expect(describeLastChecked(null, fmt, 'not_connected').text).toBe('Nothing to check until it is set up')
    expect(describeLastChecked(null, fmt, 'unknown').text).toBe('Not checked yet')
    expect(describeLastChecked(null, fmt, 'mystery').text).toBe('Not checked yet')
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
