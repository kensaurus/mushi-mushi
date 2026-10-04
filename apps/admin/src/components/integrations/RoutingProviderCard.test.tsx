/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/RoutingProviderCard.test.tsx
 * PURPOSE: Routing cards respect the caller's role and keep tokens out of
 *          password managers.
 *
 * Why (2026-10-04, QA entries 34 and 271): members saw Edit, Pause and
 * Disconnect on every routing card, and each click ended in a 403. Token
 * fields were type="password", so browsers offered to save a Jira token as
 * the site login.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoutingProviderCard } from './RoutingProviderCard'
import { ROUTING_PROVIDERS, type RoutingIntegration } from './types'

const JIRA = ROUTING_PROVIDERS.find((p) => p.type === 'jira')!
const EXISTING = { integration_type: 'jira', config: {}, is_active: true } as unknown as RoutingIntegration

function baseProps(over: Record<string, unknown> = {}) {
  return {
    provider: JIRA,
    existing: EXISTING,
    isEditing: false,
    draft: {},
    saving: false,
    testing: false,
    latestProbe: undefined,
    sparkline: [],
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onChangeField: vi.fn(),
    onSave: vi.fn(),
    onTest: vi.fn(),
    onTogglePause: vi.fn(),
    onDisconnect: vi.fn(),
    ...over,
  }
}

describe('RoutingProviderCard', () => {
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

  it('disables write controls for members but keeps Test', async () => {
    await act(async () => {
      root.render(createElement(RoutingProviderCard, baseProps({ canManage: false })))
    })
    const byLabel = (l: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`)
    expect(byLabel('Disconnect integration')?.disabled).toBe(true)
    expect(byLabel('Pause integration')?.disabled).toBe(true)
    expect(byLabel('Edit integration')?.disabled).toBe(true)
    expect(byLabel('Test connection')?.disabled).toBe(false)
  })

  it('keeps write controls for owners and admins', async () => {
    await act(async () => {
      root.render(createElement(RoutingProviderCard, baseProps()))
    })
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Disconnect integration"]')?.disabled).toBe(false)
  })

  it('renders the API token as a masked text field, not a password field', async () => {
    await act(async () => {
      root.render(createElement(RoutingProviderCard, baseProps({ isEditing: true })))
    })
    expect(container.querySelector('input[type="password"]')).toBeNull()
    const masked = container.querySelector<HTMLInputElement>('input[data-mushi-mask]')
    expect(masked?.type).toBe('text')
  })
})
