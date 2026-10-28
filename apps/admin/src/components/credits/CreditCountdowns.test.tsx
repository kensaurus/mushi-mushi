/**
 * @vitest-environment jsdom
 */

/**
 * Spend credits told the owner "Turn it on so the credits fix bugs" about a
 * Cursor key another member owns, while the switch for it was greyed out
 * with "An owner or admin of this key can change it." (2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreditCountdowns } from './CreditCountdowns'
import type { SpendDownKeyStatus } from '../settings/spendDown'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

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

const NOW = new Date('2026-10-28T00:00:00Z')

const KEY: SpendDownKeyStatus = {
  id: 'k1',
  label: 'suzu.haruka',
  keyHint: 'crsr_a4c…ea3d',
  scope: 'universal',
  ownedByMe: false,
  status: 'active',
  enabled: false,
  creditsExpireAt: '2026-10-31T23:59:00Z',
  model: null,
  dailyLimit: 100,
  windowDays: 14,
  state: 'off',
  startsAt: null,
  dispatchedToday: 0,
  remainingToday: 0,
  projects: [{ id: 'p1', name: 'mushi-mushi' }],
  lastRunAt: null,
  lastSummary: null,
} as SpendDownKeyStatus

async function render(key: SpendDownKeyStatus) {
  await act(async () => {
    root.render(
      createElement(MemoryRouter, null, createElement(CreditCountdowns, { keys: [key], balance: null, canManageOrg: true, now: NOW, onChanged: vi.fn() })),
    )
  })
  return container.textContent ?? ''
}

describe('CreditCountdowns', () => {
  it('does not ask someone to turn on a key only its owner can change', async () => {
    const text = await render(KEY)
    expect(text).toContain('spend-down is off.')
    expect(text).not.toContain('Turn it on')
    expect(text).toContain("Only the key's owner or a team admin can turn it on.")
  })

  it('asks the owner to turn it on', async () => {
    const text = await render({ ...KEY, ownedByMe: true })
    expect(text).toContain('Turn it on so the credits fix bugs.')
  })
})
