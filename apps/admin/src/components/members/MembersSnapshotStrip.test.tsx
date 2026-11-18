/**
 * @vitest-environment jsdom
 */

/**
 * Members said "3 of 5 seats used" in its sentence, its Seats tile and the
 * seat card (console sweep, 2026-10-28). The tile keeps the count; the
 * sentence speaks only when the seats have run out.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MembersSnapshotStrip, membersMetrics } from './MembersSnapshotStrip'
import { EMPTY_MEMBERS_STATS, type MembersStats } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(stats: Partial<MembersStats>) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(MembersSnapshotStrip, { stats: { ...EMPTY_MEMBERS_STATS, ...stats }, fetchedAt: null })))
  })
}

describe('MembersSnapshotStrip', () => {
  it('leaves the seat count to the Seats tile', () => {
    render({ memberCount: 3, seatLimit: 5, seatsUsed: 3, seatsRemaining: 2 })
    expect(container.textContent).not.toMatch(/3 of 5 seats/)
    expect(container.textContent).toContain('3/5')
  })

  it('says so when every seat is used', () => {
    render({ memberCount: 5, seatLimit: 5, seatsUsed: 5, seatsRemaining: 0, atSeatCap: true })
    expect(container.textContent).toContain('All 5 seats are used')
  })

  it('does not repeat the member count the Members tile shows', () => {
    render({ memberCount: 3, seatLimit: 5, seatsUsed: 3, seatsRemaining: 2 })
    expect(container.textContent).not.toContain('3 members')
  })

  it('does not claim invites were accepted for a team of one', () => {
    render({ memberCount: 1 })
    expect(container.textContent).toContain('Just you so far.')
    expect(container.textContent).not.toContain('Everyone you invited')
  })

  it('shows the member count once, as Seats; open invites only when there are some', () => {
    const quiet = membersMetrics({ ...EMPTY_MEMBERS_STATS, memberCount: 3, seatLimit: 5, seatsUsed: 3, seatsRemaining: 2 })
    expect(quiet.map((m) => [m.label, m.value])).toEqual([['Seats used', '3/5']])
    const waiting = membersMetrics({ ...EMPTY_MEMBERS_STATS, memberCount: 3, seatLimit: 5, seatsUsed: 4, pendingInvites: 1 })
    expect(waiting.map((m) => m.label)).toEqual(['Open invites', 'Seats used'])
  })
})
