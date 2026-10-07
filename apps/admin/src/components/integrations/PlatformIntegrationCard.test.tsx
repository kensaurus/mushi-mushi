/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/PlatformIntegrationCard.test.tsx
 * PURPOSE: "More actions" offers "Remove key" whenever this project stores a
 *          secret for the integration (2026-10-07: the menu only had "Apply
 *          to all projects", so a stored key could not be removed at all).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: null, error: null, loading: false, reload: () => {} }),
}))
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))

const { PlatformIntegrationCard } = await import('./PlatformIntegrationCard')
const { PLATFORM_DEFS } = await import('./types')

const CURSOR = PLATFORM_DEFS.find((d) => d.kind === 'cursor_cloud')!

function baseProps(over: Record<string, unknown> = {}) {
  return {
    def: CURSOR,
    config: { cursor_api_key_ref: '…abcd' },
    sourceByField: { cursor_api_key_ref: 'project' },
    latestProbe: undefined,
    sparkline: [],
    isEditing: false,
    draft: {},
    saving: false,
    testing: false,
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onChangeField: vi.fn(),
    onSave: vi.fn(),
    onTest: vi.fn(),
    ...over,
  }
}

describe('PlatformIntegrationCard — Remove key', () => {
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

  const render = async (props: Record<string, unknown>) => {
    await act(async () => {
      root.render(createElement(PlatformIntegrationCard, baseProps(props) as never))
    })
  }
  const moreActions = () => container.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')
  const menuButton = (text: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)

  it('offers Remove key even without an organization (no Apply to all)', async () => {
    const onRemoveKey = vi.fn()
    await render({ onRemoveKey })
    expect(moreActions()).not.toBeNull()
    await act(async () => moreActions()!.click())
    expect(menuButton('Copy credentials to all projects in org')).toBeUndefined()
    const remove = menuButton('Remove key')
    expect(remove).toBeDefined()
    await act(async () => remove!.click())
    // The card only asks; the page confirms in-page before deleting.
    expect(onRemoveKey).toHaveBeenCalledTimes(1)
  })

  it('shows both actions when the project can also copy its credentials', async () => {
    await render({ onRemoveKey: vi.fn(), onApplyToAll: vi.fn() })
    await act(async () => moreActions()!.click())
    expect(menuButton('Copy credentials to all projects in org')).toBeDefined()
    expect(menuButton('Remove key')).toBeDefined()
  })

  it('hides Remove key when the key is inherited from the org, not stored here', async () => {
    await render({ onRemoveKey: vi.fn(), sourceByField: { cursor_api_key_ref: 'org' } })
    expect(moreActions()).toBeNull()
  })

  it('hides the menu from members, who cannot change credentials', async () => {
    await render({ onRemoveKey: vi.fn(), onApplyToAll: vi.fn(), canManage: false })
    expect(moreActions()).toBeNull()
  })
})
