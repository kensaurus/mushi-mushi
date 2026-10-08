// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import type { ProbeResult } from './types.js'
import { clsNeedsSecondLook, decide, steadierCls } from './verdict.js'

const clean = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  axe: [],
  overflowX: false,
  smallTargets: 0,
  consoleErrors: [],
  cls: 0,
  ...over,
})
const contrast = { id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 3, targets: ['.muted'] }

describe('decide', () => {
  it('reports no change when the agent edited nothing', () => {
    expect(decide({ filesChanged: 0, before: { desktop: clean() }, after: null, pixelRatios: {} }).outcome).toBe('no_change')
  })

  it('fails the attempt when the screen cannot be captured after the edit', () => {
    expect(decide({ filesChanged: 2, before: { desktop: clean() }, after: null, pixelRatios: {} }).outcome).toBe(
      'capture_failed',
    )
  })

  it('keeps an edit that removes a violation and changes the screen', () => {
    const v = decide({
      filesChanged: 1,
      before: { desktop: clean({ axe: [contrast] }) },
      after: { desktop: clean() },
      pixelRatios: { desktop: 0.01 },
    })
    expect(v.outcome).toBe('accepted')
    expect(v.reason).toMatch(/desktop 12→0/)
  })

  it.each([
    ['sideways scroll', { overflowX: true }, /scrolls sideways/],
    ['a new console error', { consoleErrors: ['TypeError: x is undefined'] }, /new console error/],
    ['a new axe rule', { axe: [contrast] }, /new accessibility violations color-contrast/],
    ['more small targets', { smallTargets: 4 }, /tap targets under 24 px 0 → 4 \(problem score 0 → 4\)/],
    ['layout shift past the good threshold', { cls: 0.18 }, /layout shift 0 → 0.18/],
  ])('rolls back an edit that adds %s', (_name, worse, reason) => {
    const v = decide({
      filesChanged: 1,
      before: { mobile: clean() },
      after: { mobile: clean(worse as Partial<ProbeResult>) },
      pixelRatios: { mobile: 0.2 },
    })
    expect(v.outcome).toBe('rejected')
    expect(v.reason).toMatch(reason)
  })

  it('keeps an edit whose only change is layout shift inside the "good" range (glot.it Home, 2026-10-06)', () => {
    const v = decide({
      filesChanged: 3,
      before: { mobile: clean(), desktop: clean() },
      after: { mobile: clean({ cls: 0.085 }), desktop: clean({ cls: 0.05 }) },
      pixelRatios: { mobile: 0.145, desktop: 0.05 },
    })
    expect(v.outcome).toBe('accepted')
  })

  it('names which rule got more elements in a rollback', () => {
    const v = decide({
      filesChanged: 1,
      before: { desktop: clean({ axe: [contrast] }) },
      after: { desktop: clean({ axe: [{ ...contrast, count: 5 }] }) },
      pixelRatios: { desktop: 0.1 },
    })
    expect(v.reason).toMatch(/color-contrast 3 → 5 element\(s\)/)
  })

  it('takes a second look at layout shift past the good line and keeps the steadier reading (glot.it /chat)', () => {
    const before = { desktop: clean({ cls: 0.025 }), mobile: clean({ cls: 0.043 }) }
    const first = { desktop: clean({ cls: 0.14 }), mobile: clean({ cls: 0.05 }) }
    expect(clsNeedsSecondLook(before, first)).toBe(true)
    expect(clsNeedsSecondLook(before, { desktop: clean({ cls: 0.09 }), mobile: clean({ cls: 0.05 }) })).toBe(false)
    // A hot-reload blip is gone on the second shot; a real shift stays and still rolls back.
    const blip = steadierCls(first, { desktop: clean({ cls: 0.02 }), mobile: clean({ cls: 0.06 }) })
    expect(blip).toMatchObject({ desktop: { cls: 0.02 }, mobile: { cls: 0.05 } })
    expect(decide({ filesChanged: 1, before, after: blip, pixelRatios: { desktop: 0.1 } }).outcome).toBe('accepted')
    const real = steadierCls(first, { desktop: clean({ cls: 0.16 }), mobile: clean({ cls: 0.05 }) })
    expect(decide({ filesChanged: 1, before, after: real, pixelRatios: { desktop: 0.1 } }).reason).toMatch(/layout shift 0.025 → 0.14/)
  })

  it('does not commit an edit nobody can see', () => {
    const v = decide({
      filesChanged: 1,
      before: { desktop: clean() },
      after: { desktop: clean() },
      pixelRatios: { desktop: 0.0001 },
    })
    expect(v.outcome).toBe('no_change')
  })
})

describe('an edit with nothing visible', () => {
  it('is kept and flagged for review when that is allowed, rolled back otherwise', () => {
    const input = { filesChanged: 1, before: { mobile: clean() }, after: { mobile: clean() }, pixelRatios: { mobile: 0 } }
    expect(decide(input)).toMatchObject({ outcome: 'no_change' })
    expect(decide({ ...input, keepInvisible: true })).toMatchObject({ outcome: 'accepted', needsReview: true })
    expect(decide({ ...input, keepInvisible: true }).reason).toMatch(/^Kept, needs your review/)
  })
})

describe('assistantText', () => {
  it('keeps every message the agent wrote, newlines and all, when there is no final result', async () => {
    const { assistantText } = await import('./verdict.js')
    const stream = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the screen.' }] } }),
      JSON.stringify({ type: 'tool_call', subtype: 'started', tool_call: { readToolCall: { args: { path: 'a' } } } }),
      JSON.stringify({ type: 'assistant', model_call_id: 'dup', message: { content: [{ type: 'text', text: 'dup' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '- Raise the CTA\n- Shorten the hero copy' }] } }),
      'not json',
    ].join('\n')
    expect(assistantText(stream)).toBe('Looking at the screen.\n- Raise the CTA\n- Shorten the hero copy')
  })
})

describe('an attempt with no edits', () => {
  it('quotes the agent and treats blocked tools as a failure, not "no change needed"', async () => {
    const { agentFinalMessage, explainNoEdit } = await import('./verdict.js')
    const blocked = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","subtype":"success","result":"I could not read `.mushi-ux/PROMPT.md`, so I have not changed the screen. Every file call is stopped by a hook error."}',
    ].join('\n')
    const final = agentFinalMessage(blocked)
    expect(final).toMatch(/could not read/)
    expect(explainNoEdit(final)).toMatchObject({ outcome: 'agent_failed' })
    expect(explainNoEdit('The screen already meets the checklist; nothing to change.')).toEqual({
      outcome: 'no_change',
      reason: 'The agent made no edits: The screen already meets the checklist; nothing to change.',
    })
    expect(explainNoEdit(null)).toEqual({ outcome: 'no_change', reason: 'The agent made no edits.' })
    expect(agentFinalMessage('plain text, no json')).toBeNull()
  })
})
