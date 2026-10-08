/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/portfolio/ProjectGroupsBar.test.tsx
 * PURPOSE: Plan 021 project groups on the portfolio: chips filter by group,
 *          a new group is created, and ticking an app sends the full new
 *          member list for that group.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetchMutate: mocks.apiFetchMutate }))

import { ProjectGroupsBar } from './ProjectGroupsBar'
import type { ProjectGroup } from '../../lib/projectGroups'

const ORG = '0a000000-0000-4000-8000-000000000000'
const GROUPS: ProjectGroup[] = [
  { id: 'g1', name: 'Kensaurus apps', slug: 'kensaurus-apps', color: 'brand', sort: 0, project_ids: ['p1'] },
]
const APPS = [
  { projectId: 'p1', name: 'glot.it' },
  { projectId: 'p2', name: 'yen-yen' },
]

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.apiFetchMutate.mockReset()
  mocks.apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))

function render(active: string | null, onSelect = vi.fn(), onChanged = vi.fn()) {
  act(() =>
    root.render(
      createElement(MemoryRouter, null,
        createElement(ProjectGroupsBar, { orgId: ORG, groups: GROUPS, apps: APPS, active, onSelect, onChanged }),
      ),
    ),
  )
  return { onSelect, onChanged }
}

describe('ProjectGroupsBar', () => {
  it('filters by group and back to all apps', () => {
    const { onSelect } = render(null)
    act(() => button(/Kensaurus apps/)?.click())
    expect(onSelect).toHaveBeenCalledWith('kensaurus-apps')
    act(() => button(/^All apps$/)?.click())
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('creates a group', async () => {
    const { onChanged } = render(null)
    act(() => button(/Manage groups/)?.click())
    const input = document.getElementById('new-group-name') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Client work')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => button(/Add group/)?.click())
    await flush()
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/orgs/${ORG}/project-groups`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Client work' }) }),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('adds an app by sending the whole new member list', async () => {
    render('kensaurus-apps')
    act(() => button(/Manage groups/)?.click())
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([true, false])
    act(() => boxes[1].click())
    await flush()
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/orgs/${ORG}/project-groups/g1/projects`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ project_ids: ['p1', 'p2'] }) }),
    )
  })
})
