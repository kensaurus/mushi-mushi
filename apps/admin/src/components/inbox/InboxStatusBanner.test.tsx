/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/inbox/InboxStatusBanner.test.tsx
 * PURPOSE: Fresh-eyes sweep 2026-11-18 on /inbox: "1 thing needs you / Read
 *          each diagnosis…" repeated the only card word for word, with two
 *          buttons for one action; and the card's "Page / Reports queue" chip
 *          wrapped to two lines.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inboxBannerRepeatsCards, isInboxStatusBannerCritical } from './InboxStatusBanner'
import { MetaChip } from '../report-detail/ReportSurface'
import { EMPTY_INBOX_STATS } from './types'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('inbox banner', () => {
  const actions = { ...EMPTY_INBOX_STATS, hasAnyProject: true, topPriority: 'actions' as const, openActions: 1 }

  it('steps aside when the one open card already says it', () => {
    expect(isInboxStatusBannerCritical(actions)).toBe(true)
    expect(inboxBannerRepeatsCards(actions, 1)).toBe(true)
    expect(inboxBannerRepeatsCards({ ...actions, openActions: 3 }, 3)).toBe(false)
    // Setup and no-project banners say something no card does.
    expect(inboxBannerRepeatsCards({ ...actions, topPriority: 'setup' }, 1)).toBe(false)
  })
})

describe('MetaChip', () => {
  it('reads "Page: Reports queue" on one line, with no box of its own', () => {
    act(() => root.render(createElement(MemoryRouter, null, createElement(MetaChip, { label: 'Page', children: 'Reports queue' }))))
    const chip = container.firstElementChild as HTMLElement
    expect(chip.textContent).toBe('Page:Reports queue')
    expect(chip.className).toContain('inline-flex')
    expect(chip.className).not.toMatch(/\bborder\b|flex-col/)
    expect(chip.querySelector('span:last-child')?.className).toContain('whitespace-nowrap')
  })
})
