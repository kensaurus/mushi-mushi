/**
 * @vitest-environment jsdom
 */

/**
 * Help & support with nothing sent yet said so three times: a red-toned
 * "No submissions yet" banner, the status line "You have not sent the Mushi
 * team a bug or a request yet." and an "EMPTY" pill (2026-10-28). Nothing
 * sent is not a problem; the status line says it once.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FeedbackStatusBanner } from './FeedbackStatusBanner'
import { EMPTY_FEEDBACK_STATS, type FeedbackStats } from './types'

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

async function render(stats: FeedbackStats) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(FeedbackStatusBanner, { stats })))
  })
}

describe('FeedbackStatusBanner', () => {
  it('shows no banner before the first ticket', async () => {
    await render({ ...EMPTY_FEEDBACK_STATS, hasAnyProject: true, projectName: 'mushi-mushi', topPriority: 'first_submit' })
    expect(container.textContent).toBe('')
  })

  it('still shows a waiting team reply', async () => {
    await render({ ...EMPTY_FEEDBACK_STATS, hasAnyProject: true, totalTickets: 2, awaitingReply: 1, topPriority: 'reply' })
    expect(container.textContent).toContain('1 team reply waiting')
  })
})
