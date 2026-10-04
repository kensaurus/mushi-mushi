/**
 * @vitest-environment jsdom
 *
 * A form the server will refuse must say why before Save (suspected-bugs
 * entry 252): `blockedReason` turns Save off and shows the sentence.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsFormFooter } from './SettingsFormFooter'

describe('SettingsFormFooter', () => {
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

  function saveButton(): HTMLButtonElement {
    return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save changes'))!
  }

  it('turns Save off and says what to fix', () => {
    const onSave = vi.fn()
    act(() => {
      root.render(
        createElement(SettingsFormFooter, {
          dirty: true,
          onSave,
          onDiscard: () => {},
          blockedReason: 'Fix the branch name pattern first.',
        }),
      )
    })
    expect(saveButton().disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Fix the branch name pattern first.')
  })

  it('saves normally with nothing blocking', () => {
    const onSave = vi.fn()
    act(() => {
      root.render(createElement(SettingsFormFooter, { dirty: true, onSave, onDiscard: () => {} }))
    })
    expect(saveButton().disabled).toBe(false)
    act(() => saveButton().click())
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
