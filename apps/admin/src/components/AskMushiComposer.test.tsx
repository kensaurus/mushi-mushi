/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/AskMushiComposer.test.tsx
 * PURPOSE: The composer forwards its own textarea, so the sidebar focuses the
 *          composer when the drawer opens, not the page's first form textarea.
 */

import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { AskMushiComposer } from './AskMushiComposer'

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

describe('AskMushiComposer', () => {
  it('forwards its ref to the editable composer textarea', () => {
    const ref = createRef<HTMLTextAreaElement | null>()
    // Another form textarea earlier in the document, like the report triage note.
    const other = document.createElement('form')
    other.appendChild(document.createElement('textarea'))
    document.body.insertBefore(other, container)

    act(() => {
      root.render(
        createElement(AskMushiComposer, {
          ref,
          value: '',
          onChange: () => {},
          onSubmit: () => {},
          onSlashCommand: () => {},
          placeholder: 'Ask about Reports',
        }),
      )
    })

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
    expect(ref.current?.placeholder).toBe('Ask about Reports')
    expect(ref.current?.readOnly).toBe(false)
    expect(container.contains(ref.current)).toBe(true)
    ref.current?.focus()
    expect(document.activeElement).toBe(ref.current)
    other.remove()
  })
})
