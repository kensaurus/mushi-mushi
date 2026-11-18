/**
 * @vitest-environment jsdom
 *
 * When every setup check passes, each step is a ● row you can open, not an
 * open card under "All checks pass" (fresh-eyes 2026-11-18).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Step } from './SetupCopilotPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Setup copilot steps', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const render = (done: boolean) =>
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(Step, { title: '1 · Connect credentials', done, children: createElement('p', null, 'body') })))
    })

  it('folds a passed step to a closed ● row', () => {
    render(true)
    const row = host.querySelector<HTMLDetailsElement>('[data-testid="copilot-step-done"]')!
    expect(row.open).toBe(false)
    expect(row.querySelector('summary')!.textContent).toContain('1 · Connect credentials')
    expect(row.querySelector('summary svg[data-tone="ok"]')).not.toBeNull()
  })

  it('keeps an unfinished step open', () => {
    render(false)
    expect(host.querySelector('[data-testid="copilot-step-done"]')).toBeNull()
    expect(host.textContent).toContain('body')
  })
})
