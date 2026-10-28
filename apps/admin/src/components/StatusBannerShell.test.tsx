/**
 * @vitest-environment jsdom
 */

/**
 * A green "all good" banner over the page's status sentence said the same
 * thing twice (Weekly insights "Weekly summaries are up to date" over "24
 * digests"; Editor agents "3 connected · 129 tools" over "3 editors
 * connected … 129 tools"). With a PageStatus on the page the ok banner steps
 * aside; problems still show.
 */

import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusBannerShell } from './StatusBannerShell'
import { PageStatus } from './ui/page-status'

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

async function render(...children: ReactElement[]) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(Fragment, null, ...children)))
  })
}

const status = createElement(PageStatus, { key: 'status', sentence: '3 editors connected; 129 tools available.', tone: 'ok' })

describe('StatusBannerShell', () => {
  it('shows an ok banner on a page without a status sentence', async () => {
    await render(createElement(StatusBannerShell, { key: 'b', tone: 'ok', title: 'Your editor can talk to Mushi' }))
    expect(container.textContent).toContain('Your editor can talk to Mushi')
  })

  it('leaves an ok banner out when the page already leads with its status sentence', async () => {
    await render(createElement(StatusBannerShell, { key: 'b', tone: 'ok', title: 'Your editor can talk to Mushi' }), status)
    expect(container.textContent).not.toContain('Your editor can talk to Mushi')
    expect(container.textContent).toContain('3 editors connected')
  })

  it('still shows a problem next to the status sentence', async () => {
    await render(createElement(StatusBannerShell, { key: 'b', tone: 'danger', title: 'Last summary failed to generate' }), status)
    expect(container.textContent).toContain('Last summary failed to generate')
  })

  it('brings the ok banner back once the status sentence leaves', async () => {
    await render(createElement(StatusBannerShell, { key: 'b', tone: 'ok', title: 'All good' }), status)
    expect(container.textContent).not.toContain('All good')
    await render(createElement(StatusBannerShell, { key: 'b', tone: 'ok', title: 'All good' }))
    expect(container.textContent).toContain('All good')
  })
})
