/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/dashboard/TeamActivityTile.test.tsx
 * PURPOSE: Team activity names people, never raw ids (2026-10-04 audit: rows
 *          read "Agent eb0c15cc-4139-490b-a335-35b3d87428df fix.merge").
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
}))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: page.data, loading: page.loading, error: page.error, reload: page.reload }),
}))
vi.mock('../../lib/realtime', () => ({ useRealtimeReload: () => ({}) }))

import { TeamActivityTile } from './TeamActivityTile'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  page.data = null
  page.loading = false
  page.error = null
  page.reload.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('TeamActivityTile', () => {
  it('shows the member name for a console action logged with only a user id', () => {
    const id = 'eb0c15cc-4139-490b-a335-35b3d87428df'
    page.data = {
      count: 2,
      logs: [
        { id: '1', actor_id: id, actor_email: null, actor_name: 'Kenji', actor_display_email: 'k@x.dev', action: 'fix.merge', resource_type: 'fix', resource_id: null, created_at: '2026-10-03T00:00:00Z' },
        { id: '2', actor_id: '00000000-0000-0000-0000-000000000000', actor_email: 'retention-sweep@mushi-mushi', action: 'retention.sweep', resource_type: 'project', resource_id: null, created_at: '2026-10-03T00:00:00Z' },
      ],
    }
    act(() => root.render(createElement(MemoryRouter, null, createElement(TeamActivityTile, { projectId: 'p1' }))))
    const text = host.textContent ?? ''
    expect(text).toContain('Member')
    expect(text).toContain('Kenji')
    expect(text).not.toContain(id)
    expect(text).toContain('System')
  })

  it('labels a member the server could not name (deleted user) as a former member, not an agent', () => {
    page.data = {
      count: 1,
      logs: [
        { id: '1', actor_id: '5f1c0b7e-2d3a-4c4b-9e8f-0a1b2c3d4e5f', actor_email: null, actor_name: null, actor_display_email: null, actor_type: 'user', action: 'fix.merge', resource_type: 'fix', resource_id: null, created_at: '2026-10-03T00:00:00Z' },
      ],
    }
    act(() => root.render(createElement(MemoryRouter, null, createElement(TeamActivityTile, { projectId: 'p1' }))))
    const text = host.textContent ?? ''
    expect(text).toContain('Former member')
    expect(text).toContain('Member')
    expect(text).not.toContain('Automation')
    expect(text).not.toContain('Agent')
  })

  it('shows a loading skeleton, an empty list, and Retry when the audit log fails', () => {
    page.loading = true
    act(() => root.render(createElement(MemoryRouter, null, createElement(TeamActivityTile, { projectId: 'p1' }))))
    expect(host.querySelector('[aria-label="Loading team activity"]')).not.toBeNull()
    expect(host.textContent).not.toContain('No team activity yet')

    page.loading = false
    page.error = 'offline'
    act(() => root.render(createElement(MemoryRouter, null, createElement(TeamActivityTile, { projectId: 'p1' }))))
    expect(host.textContent).toContain("Couldn't load team activity.")
    expect(host.textContent).not.toContain('No team activity yet')
    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Retry')
    retry?.click()
    expect(page.reload).toHaveBeenCalledOnce()

    page.error = null
    page.data = { count: 0, logs: [] }
    act(() => root.render(createElement(MemoryRouter, null, createElement(TeamActivityTile, { projectId: 'p1' }))))
    expect(host.textContent).toContain('No team activity yet')
  })

  it('keeps the last activity when a refresh fails', () => {
    page.error = 'offline'
    page.data = {
      count: 1,
      logs: [
        { id: '1', actor_id: 'eb0c15cc-4139-490b-a335-35b3d87428df', actor_email: null, actor_name: 'Kenji', actor_display_email: 'k@x.dev', action: 'fix.merge', resource_type: 'fix', resource_id: null, created_at: '2026-10-03T00:00:00Z' },
      ],
    }
    act(() => root.render(createElement(MemoryRouter, null, createElement(TeamActivityTile, { projectId: 'p1' }))))
    expect(host.textContent).toContain('Kenji')
    expect(host.textContent).toContain("Couldn't refresh. Showing the last result.")
    expect(host.textContent).not.toContain("Couldn't load team activity.")
  })
})

describe('auditActionPhrase', () => {
  it('names common actions in words and spells out the rest', async () => {
    const { auditActionPhrase } = await import('./TeamActivityTile')
    expect(auditActionPhrase('content_quality.bulk_dismissed')).toBe('dismissed content checks')
    expect(auditActionPhrase('retention.sweep')).toBe('retention sweep')
  })
})
