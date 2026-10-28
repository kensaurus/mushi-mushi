/**
 * @vitest-environment jsdom
 */

/**
 * A new user saw three setup counts for one app at once: Set up "2 of 4
 * done", the sidebar "Set up · 3/4", and Home's checklist "4/10 done · 75%
 * required" (console sweep, 2026-10-28, from the integrator's new-user
 * walk). Every count is now the required steps, worded "3 of 4 done".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupProject, SetupStep, SetupStepId } from '../lib/useSetupStatus'

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({ data: null, loading: false, error: null, reload: () => {}, hasAnyProject: true, activeProject: null, selectors: {}, isStepIncomplete: () => false, getStep: () => null }),
}))
vi.mock('../lib/useNavCounts', () => ({ useNavCounts: () => ({ ready: true }) }))
vi.mock('../lib/mode', () => ({ useAdminMode: () => ({ isQuickstart: true, isBeginner: false, isAdvanced: false }) }))
vi.mock('./ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSendTestReport', () => ({ useSendTestReport: () => vi.fn() }))

import { SetupChecklist } from './SetupChecklist'
import { setupCountLabel } from '../lib/setupProgress'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function step(id: SetupStepId, complete: boolean, required: boolean): SetupStep {
  return { id, label: id, description: '', complete, required, cta_to: '/', cta_label: 'Go' }
}

// mushi-demo on 2026-10-28: 3 of 4 required, 4 of 10 overall.
const DEMO: SetupProject = {
  project_id: 'p1',
  project_name: 'mushi-demo',
  project_slug: 'mushi-demo',
  created_at: '2026-10-01T00:00:00.000Z',
  steps: [
    step('project_created', true, true),
    step('api_key_generated', true, true),
    step('sdk_installed', false, true),
    step('first_report_received', true, true),
    step('github_connected', true, false),
    step('sentry_connected', false, false),
    step('byok_anthropic', false, false),
    step('first_fix_dispatched', false, false),
    step('slack_connected', false, false),
    step('first_qa_story_passing', false, false),
  ],
  required_total: 4,
  required_complete: 3,
  total: 10,
  complete: 4,
  done: false,
  report_count: 1,
  fix_count: 0,
  merged_fix_count: 0,
}

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

describe('setup count', () => {
  it('is worded one way', () => {
    expect(setupCountLabel(DEMO)).toBe('3 of 4 done')
  })

  it.each(['banner', 'wizard'] as const)('the %s checklist shows the same count as the sidebar', (mode) => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(SetupChecklist, { project: DEMO, mode })))
    })
    const count = container.querySelector('[data-testid="setup-checklist-count"]')?.textContent
    expect(count).toBe('3 of 4 done')
    expect(container.textContent).not.toMatch(/4\/10|75%|% required/)
  })

  // Set up showed the rail, this checklist's count and progress bar, and the
  // same four steps again (first-time user test, 2026-10-28).
  it('lists only the optional steps under Set up, with no second count', () => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(SetupChecklist, { project: DEMO, mode: 'wizard', extrasOnly: true })))
    })
    expect(container.querySelector('[data-testid="setup-checklist-count"]')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    const items = container.querySelectorAll('[data-testid="setup-extras"] li')
    expect(items).toHaveLength(6)
    expect(container.textContent).not.toContain('sdk_installed')
  })
})
