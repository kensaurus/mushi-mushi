/**
 * FILE: apps/admin/src/lib/heldReason.test.ts
 * PURPOSE: Held reasons read as plain-word chips ("key used up", never "(key_used_up)"), an
 * unknown code still reads, and the sentence loses its code.
 */

import { describe, expect, it } from 'vitest'
import { groupQueueRows, heldReasonLabel, heldReasonOf, withoutReasonCode } from './heldReason'

describe('heldReason', () => {
  it('maps known codes to short plain words', () => {
    expect(heldReasonLabel('key_used_up')).toBe('key used up')
    expect(heldReasonLabel('no_cursor_key')).toBe('no Cursor key')
    expect(heldReasonLabel('max_followups')).toBe('follow-ups used up')
  })

  it('reads an unknown code with spaces for underscores', () => {
    expect(heldReasonLabel('quota__exhausted_now')).toBe('quota exhausted now')
  })

  it('pulls the code out of a server sentence, or takes a bare code', () => {
    expect(heldReasonOf('The follow-up Cursor key cannot be used here (key_used_up).')).toBe('key used up')
    expect(heldReasonOf('Not queued (brand_new_reason).')).toBe('brand new reason')
    expect(heldReasonOf('daily_limit')).toBe('daily limit reached')
  })

  it('names the reason of queue sentences that carry no code', () => {
    expect(heldReasonOf('Merge conflict: the Cursor key reached its usage limit; it waits for another key.')).toBe('key used up')
    expect(heldReasonOf('Conflicts with the base branch; waits for a free conflict agent (2 ahead in this repo).')).toBe('merge conflict')
    expect(heldReasonOf('main is red too (Build); it rides a release train once main passes.')).toBe('base branch red')
    expect(heldReasonOf('CI fails on its own commit (Lint).')).toBe('CI red')
  })

  it('says nothing for an empty or reasonless detail', () => {
    expect(heldReasonOf(null)).toBeNull()
    expect(heldReasonOf('')).toBeNull()
    expect(heldReasonOf('Queued.')).toBeNull()
  })

  it('drops the code from the sentence', () => {
    expect(withoutReasonCode('The follow-up Cursor key cannot be used here (key_used_up).')).toBe('The follow-up Cursor key cannot be used here.')
    expect(withoutReasonCode('CI is running (2 checks left).')).toBe('CI is running (2 checks left).')
  })
})

describe('groupQueueRows', () => {
  it('puts rows with the same state, repo and sentence on one line, keeping order', () => {
    const row = (id: string, state: string, detail: string | null, repo = 'kensaurus/mushi-mushi') => ({ id, state, repo, detail })
    const groups = groupQueueRows([
      row('a', 'blocked', 'The AI review asked for changes.'),
      row('b', 'blocked', 'Merge conflict. The follow-up Cursor key cannot be used here (key_used_up).'),
      row('c', 'blocked', 'Merge conflict. The follow-up Cursor key cannot be used here (key_used_up).'),
      row('d', 'queued', null),
      row('e', 'blocked', 'Merge conflict. The follow-up Cursor key cannot be used here (key_used_up).', 'kensaurus/glot.it'),
    ])
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([['a'], ['b', 'c'], ['d'], ['e']])
  })
})
