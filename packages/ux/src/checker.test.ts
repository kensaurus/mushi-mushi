// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { combineVotes, firstJson, toVote, unionBox, type CheckerVote } from './checker.js'

const vote = (preferred: CheckerVote['preferred'], confidence: CheckerVote['confidence'] = 'high'): CheckerVote => ({ preferred, confidence, difference: 'd', reason: 'r' })

describe('checker veto rule', () => {
  it('rolls a step back only when both orders prefer the original, each at least medium', () => {
    expect(combineVotes([vote('before'), vote('before', 'medium')]).verdict).toBe('revert')
    expect(combineVotes([vote('before'), vote('before', 'low')]).verdict).toBe('unsure')
    expect(combineVotes([vote('before'), vote('after')]).verdict).toBe('unsure')
    expect(combineVotes([vote('before'), vote('tie')]).verdict).toBe('unsure')
    expect(combineVotes([vote('after', 'low'), vote('after')]).verdict).toBe('keep')
    expect(combineVotes([vote('before')]).verdict).toBe('unsure')
  })

  it('maps an A/B answer back to before and after, whichever order was shown', () => {
    expect(toVote({ verdict: 'A', confidence: 'high' }, true)?.preferred).toBe('before')
    expect(toVote({ verdict: 'A', confidence: 'high' }, false)?.preferred).toBe('after')
    expect(toVote({ verdict: 'tie' }, true)).toMatchObject({ preferred: 'tie', confidence: 'low' })
    expect(toVote({ verdict: 'C' }, true)).toBeNull()
  })

  it('reads the JSON out of a chatty answer', () => {
    expect(firstJson('Sure. {"verdict":"B","confidence":"medium"} done')).toEqual({ verdict: 'B', confidence: 'medium' })
    expect(firstJson('no json here')).toBeNull()
  })

  it('crops around the changes with context, within the image and the height cap', () => {
    expect(unionBox([{ x: 10, y: 500, w: 40, h: 40 }], 390, 2000)).toEqual({ x: 0, y: 380, w: 390, h: 280 })
    expect(unionBox([{ x: 0, y: 0, w: 390, h: 1900 }], 390, 2000).h).toBe(1400)
    expect(unionBox([], 390, 900)).toEqual({ x: 0, y: 0, w: 390, h: 900 })
  })
})
