/**
 * @vitest-environment jsdom
 */

/**
 * mushi-demo on 2026-10-26: Required (3/4) listed all four steps as Pending.
 * Each row now follows its own step from GET /v1/admin/setup.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingStepsGuide } from './OnboardingStepsGuide'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('OnboardingStepsGuide', () => {
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

  it('marks the three done steps Done and the SDK step Next, not all four Pending', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(OnboardingStepsGuide, {
            stats: { setupDone: false, hasAnyProject: true, requiredComplete: 3, requiredTotal: 4, nextStepId: 'sdk_installed', sdkInstalled: false, reportCount: 0 },
            completedStepIds: ['project_created', 'api_key_generated', 'first_report_received'],
          }),
        ),
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Required (3/4)')
    expect(text).not.toContain('Pending')
    expect(text.match(/Done/g)?.length).toBe(3)
    expect(text).toContain('Next')
  })
})
