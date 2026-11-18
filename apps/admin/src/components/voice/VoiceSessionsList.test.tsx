/**
 * @vitest-environment jsdom
 *
 * The empty list is plain lines in its section, not a dashed box inside the
 * card (fresh-eyes 2026-11-18).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceSessionsList } from './VoiceSessionsList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('VoiceSessionsList', () => {
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

  it('says there are no requests yet without a box in the card', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(VoiceSessionsList, { sessions: [], onConfirm: () => {}, onCancel: () => {}, pendingId: null, intakeEnabled: false }),
        ),
      )
    })
    const empty = host.querySelector('[data-testid="voice-sessions-empty"]')!
    expect(empty.textContent).toContain('No voice requests yet.')
    expect(empty.textContent).toContain('Turn on voice intake first.')
    expect(host.querySelector('.border-dashed')).toBeNull()
  })
})
