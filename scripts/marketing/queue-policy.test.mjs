/**
 * FILE: scripts/marketing/queue-policy.test.mjs
 * PURPOSE: Guard the rules that decide which Bluesky queue items may post.
 *
 * The queue runs by hand on launch day, long after its dates were written.
 * Before these rules, every unposted item with a past date was "due", so four
 * April posts in a retired voice would all have fired on the first run. These
 * tests pin the two guards (disabled items, stale dates) and check that the
 * committed queue says why each retired item was retired.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MAX_STALE_DAYS, classifyQueue } from './queue-policy.mjs'

const NOW = Date.parse('2026-09-21T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()

describe('classifyQueue', () => {
  it('never returns an item that was already posted', () => {
    const queue = [{ text: 'a', scheduled_for: iso(NOW - DAY_MS), posted_at: iso(NOW - DAY_MS) }]
    const result = classifyQueue(queue, { now: NOW })
    assert.deepEqual(result, { due: [], stale: [], disabled: [], invalid: [] })
  })

  it('posts an item scheduled in the recent past', () => {
    const queue = [{ text: 'a', scheduled_for: iso(NOW - DAY_MS) }]
    const { due, stale } = classifyQueue(queue, { now: NOW })
    assert.equal(due.length, 1)
    assert.equal(due[0].index, 0)
    assert.equal(stale.length, 0)
  })

  it('holds an item scheduled in the future', () => {
    const queue = [{ text: 'a', scheduled_for: iso(NOW + DAY_MS) }]
    const result = classifyQueue(queue, { now: NOW })
    assert.deepEqual(result, { due: [], stale: [], disabled: [], invalid: [] })
  })

  it('refuses an item scheduled more than MAX_STALE_DAYS ago', () => {
    const queue = [{ text: 'a', scheduled_for: iso(NOW - (MAX_STALE_DAYS + 1) * DAY_MS) }]
    const { due, stale } = classifyQueue(queue, { now: NOW })
    assert.equal(due.length, 0)
    assert.equal(stale.length, 1)
  })

  it('posts a stale item only when the caller opts in', () => {
    const queue = [{ text: 'a', scheduled_for: '2026-04-24T15:00:00Z' }]
    const { due, stale } = classifyQueue(queue, { now: NOW, allowStale: true })
    assert.equal(due.length, 1)
    assert.equal(stale.length, 0)
  })

  it('never posts a disabled item, even an overdue one with allowStale', () => {
    const queue = [
      { text: 'a', scheduled_for: iso(NOW - DAY_MS), disabled: true, disabled_reason: 'retired' },
      { text: 'b', disabled: true, disabled_reason: 'retired' },
    ]
    const { due, disabled } = classifyQueue(queue, { now: NOW, allowStale: true })
    assert.equal(due.length, 0)
    assert.deepEqual(
      disabled.map((item) => item.index),
      [0, 1],
    )
  })

  it('keeps the original contract that an undated item is due', () => {
    const { due } = classifyQueue([{ text: 'a' }], { now: NOW })
    assert.equal(due.length, 1)
  })

  it('reports an unparseable date instead of posting it', () => {
    const { due, invalid } = classifyQueue([{ text: 'a', scheduled_for: 'next Tuesday' }], {
      now: NOW,
    })
    assert.equal(due.length, 0)
    assert.equal(invalid.length, 1)
  })

  it('keeps each item index pointing at its queue position', () => {
    const queue = [
      { text: 'posted', scheduled_for: iso(NOW - DAY_MS), posted_at: iso(NOW) },
      { text: 'off', disabled: true, disabled_reason: 'retired' },
      { text: 'due', scheduled_for: iso(NOW - DAY_MS) },
    ]
    const { due } = classifyQueue(queue, { now: NOW })
    assert.equal(due[0].index, 2)
    assert.equal(queue[due[0].index].text, 'due')
  })
})

describe('committed queue (docs/marketing/social/queue.json)', () => {
  const queue = JSON.parse(
    readFileSync(new URL('../../docs/marketing/social/queue.json', import.meta.url), 'utf8'),
  )

  it('says why every disabled item was retired', () => {
    for (const [index, item] of queue.entries()) {
      if (item.disabled !== true) continue
      assert.equal(typeof item.disabled_reason, 'string', `item ${index} has no disabled_reason`)
      assert.ok(item.disabled_reason.trim().length > 0, `item ${index} has an empty disabled_reason`)
    }
  })

  it('has no item written before the 2026-09-21 cleanup that could still fire', () => {
    const cleanup = Date.parse('2026-09-21T00:00:00Z')
    const written = queue.filter(
      (item) => item.scheduled_for && Date.parse(item.scheduled_for) < cleanup,
    )
    const { due, stale, invalid } = classifyQueue(written, { now: cleanup, allowStale: true })
    assert.deepEqual(
      [...due, ...stale, ...invalid].map((item) => item.scheduled_for),
      [],
    )
  })
})
