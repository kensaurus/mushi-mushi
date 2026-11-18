/**
 * @vitest-environment jsdom
 *
 * A stored secret's state is a status pill (2026-11-18): saved passes, not
 * saved is idle; Remove stays beside a saved one.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { StoredSecretStatus } from './StoredSecretStatus'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function render(isSet: boolean) {
  act(() =>
    root.render(createElement(StoredSecretStatus, { column: 'sentry_webhook_secret', label: 'Sentry webhook secret', isSet, consequence: 'Webhooks stop.', onRemoved: vi.fn() })),
  )
  const pill = host.querySelector('[data-testid="status-pill"]')
  return [pill?.getAttribute('data-status'), pill?.textContent]
}

describe('StoredSecretStatus', () => {
  it('marks a saved secret as passed and an unsaved one as idle', () => {
    expect(render(true)).toEqual(['passed', 'Saved'])
    expect(host.querySelector('button[aria-label="Remove sentry webhook secret"]')).not.toBeNull()
    expect(render(false)).toEqual(['idle', 'Not saved yet'])
  })
})
