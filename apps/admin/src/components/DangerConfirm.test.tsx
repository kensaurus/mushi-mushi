/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DangerConfirm } from './DangerConfirm'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('DangerConfirm', () => {
  it('focuses the type-to-confirm input on open, not the disabled confirm button', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
      root!.render(
        createElement(DangerConfirm, {
          open: true,
          title: 'Delete glot.it?',
          body: 'This cannot be undone.',
          requiredText: 'glot-it',
          inputLabel: 'Type the project slug to confirm',
          onConfirm: () => {},
          onCancel: () => {},
        }),
      ),
    )
    expect(document.activeElement?.getAttribute('data-testid')).toBe('danger-confirm-input')
  })
})
