/**
 * @vitest-environment jsdom
 */

/**
 * A team at its plan's app limit gets the server's plain message under a
 * clear title and one way out, the plans (402 PLAN_APP_LIMIT, 2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsCreatePanel } from './ProjectsCreatePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let where = ''
function Where() {
  const l = useLocation()
  where = `${l.pathname}${l.search}`
  return null
}

beforeEach(() => {
  where = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ProjectsCreatePanel at the plan app limit', () => {
  it('shows the limit message and sends "See plans" to the Plans tab', () => {
    const message = 'Free watches 1 app, and this team has 1. Move to Builder (3 apps) to add another, or remove an app you no longer use.'
    const panel = createElement(ProjectsCreatePanel, {
      createdProject: null,
      onDismissCreated: vi.fn(),
      orgDataLoaded: true,
      canManageProjects: true,
      activeOrgRole: 'owner',
      onNavigateTeam: vi.fn(),
      newName: 'Second app',
      onNewNameChange: vi.fn(),
      creating: false,
      createError: { code: 'PLAN_APP_LIMIT', message },
      onCreate: vi.fn(),
      onRetryCreate: vi.fn(),
      onClearCreateError: vi.fn(),
    })
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/projects'] },
          createElement(Routes, null, createElement(Route, { path: '*', element: createElement('div', null, panel, createElement(Where)) })),
        ),
      )
    })
    expect(container.textContent).toContain('Your plan’s apps are all in use')
    expect(container.textContent).toContain(message)
    const seePlans = [...container.querySelectorAll('button')].find((b) => b.textContent === 'See plans')!
    act(() => seePlans.click())
    expect(where).toBe('/team?view=billing&tab=plans')
  })
})
