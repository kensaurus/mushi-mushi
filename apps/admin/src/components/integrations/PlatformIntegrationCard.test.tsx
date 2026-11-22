/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/PlatformIntegrationCard.test.tsx
 * PURPOSE: "More actions" offers "Remove key" whenever this project stores a
 *          secret for the integration (2026-10-07: the menu only had "Apply
 *          to all projects", so a stored key could not be removed at all).
 *          Also locks the Sentry card's status, "Open Sentry" action, and
 *          description onto the full-width summary, not the title row that
 *          sits beside the icon buttons.
 */

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageData = vi.hoisted(() => ({
  current: { data: null as { deliveries: unknown[] } | null, error: null as string | null, loading: false, reload: () => {} },
}))

const modelsPage = vi.hoisted(() => ({
  paths: [] as string[],
  current: {
    data: {
      models: [
        {
          id: 'grok-4.7',
          displayName: 'Grok 4.7',
          parameters: [{ id: 'reasoning_effort', displayName: 'Reasoning effort', values: [{ value: 'xhigh' }] }],
        },
        { id: 'composer-2.5' },
      ],
    } as { models: unknown[] } | null,
    error: null as string | null,
    loading: false,
    reload: () => {},
  },
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    if (typeof path === 'string' && path.startsWith('/v1/admin/byok/cursor/models')) {
      modelsPage.paths.push(path)
      return modelsPage.current
    }
    return pageData.current
  },
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
    pageData.current = { data: null, error: null, loading: false, reload: () => {} }
    modelsPage.paths = []
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

  // A not-connected card had a red "Configure" and a red "Connect" doing the
  // same thing (integrator's walk, 2026-10-28).
  it('offers one way to connect a card that is not connected', async () => {
    const onStartEdit = vi.fn()
    await render({ config: {}, sourceByField: {}, onStartEdit })
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toContain('Connect')
    expect(labels).not.toContain('Configure')
  })

  // GitHub read "Via environment" beside "Not connected": Mushi's server held
  // a webhook secret, but the repo was never connected (first-time user test).
  it('does not badge a card that is not connected with a server default', async () => {
    const github = PLATFORM_DEFS.find((d) => d.kind === 'github')!
    await render({ def: github, config: { github_webhook_secret: 'set' }, sourceByField: { github_webhook_secret: 'env' } })
    expect(container.textContent).not.toContain('Via environment')
    expect(container.textContent).not.toContain("Mushi's default")
  })

  it('hides the menu from members, who cannot change credentials', async () => {
    await render({ onRemoveKey: vi.fn(), onApplyToAll: vi.fn(), canManage: false })
    expect(moreActions()).toBeNull()
  })
})

describe('PlatformIntegrationCard — Sentry summary width', () => {
  let container: HTMLDivElement
  let root: Root
  const sentry = PLATFORM_DEFS.find((d) => d.kind === 'sentry')!

  beforeEach(() => {
    pageData.current = { data: { deliveries: [] }, error: null, loading: false, reload: () => {} }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    pageData.current = { data: null, error: null, loading: false, reload: () => {} }
    act(() => root.unmount())
    container.remove()
  })

  it('keeps the status, Open Sentry, and description out of the button row', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(PlatformIntegrationCard, {
        def: sentry,
        config: { sentry_org_slug: 'acme', sentry_auth_token_ref: 'sntrys_test' },
        sourceByField: { sentry_org_slug: 'project', sentry_auth_token_ref: 'project' },
        latestProbe: {
          id: 'probe-1',
          kind: 'sentry',
          status: 'ok',
          latency_ms: 40,
          message: null,
          source: 'test',
          checked_at: new Date().toISOString(),
        },
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
      } as never)))
    })

    const summary = container.querySelector('[data-testid="platform-card-summary"]')
    expect(summary).not.toBeNull()
    const openSentry = Array.from(summary!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Open Sentry')
    expect(openSentry).toBeDefined()
    expect(summary!.textContent).toContain(sentry.whyItMatters)
    expect(summary!.querySelector('[data-connection-state="attention"]')).not.toBeNull()
    const actions = container.querySelector('[aria-label="Test connection"]')?.parentElement?.parentElement
    expect(actions?.contains(openSentry!)).toBe(false)
    expect(actions?.contains(summary)).toBe(false)
  })
})

describe('PlatformIntegrationCard — Cursor model', () => {
  let container: HTMLDivElement
  let root: Root

  function Editor({ initial }: { initial: string }) {
    const [model, setModel] = useState(initial)
    const [key, setKey] = useState('…abcd')
    return createElement(PlatformIntegrationCard, baseProps({
      isEditing: true,
      draft: { cursor_api_key_ref: key, cursor_default_model: model },
      onChangeField: (name: string, value: string) => {
        if (name === 'cursor_default_model') setModel(value)
        if (name === 'cursor_api_key_ref') setKey(value)
      },
    }) as never)
  }

  function modelSelect(): HTMLSelectElement {
    const sel = container.querySelector<HTMLSelectElement>('select[aria-label="Default model"]')
    if (!sel) throw new Error('no model select')
    return sel
  }
  function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  }

  beforeEach(() => {
    modelsPage.paths = []
    modelsPage.current = {
      data: {
        models: [
          {
            id: 'grok-4.7',
            displayName: 'Grok 4.7',
            parameters: [{ id: 'reasoning_effort', displayName: 'Reasoning effort', values: [{ value: 'xhigh' }] }],
          },
          { id: 'composer-2.5' },
        ],
      },
      error: null,
      loading: false,
      reload: () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('picks a model and a setting from the app key, with no key id', async () => {
    await act(async () => {
      root.render(createElement(Editor, { initial: '' }))
    })
    expect(modelsPage.paths).toContain('/v1/admin/byok/cursor/models')
    expect(modelsPage.paths.some((p) => p.includes('keyId='))).toBe(false)
    await act(async () => change(modelSelect(), 'grok-4.7'))
    const effort = () =>
      Array.from(container.querySelectorAll('label'))
        .find((l) => l.textContent?.includes('Reasoning effort'))
        ?.querySelector('select') as HTMLSelectElement | undefined
    if (!effort()) throw new Error('no reasoning select')
    await act(async () => change(effort()!, 'xhigh'))
    expect(modelSelect().value).toBe('grok-4.7')
    expect(effort()?.value).toBe('xhigh')
  })

  it('reopens a saved spec', async () => {
    await act(async () => {
      root.render(createElement(Editor, { initial: 'grok-4.7?reasoning_effort=xhigh' }))
    })
    expect(modelSelect().value).toBe('grok-4.7')
    const effortSelect = Array.from(container.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('Reasoning effort'))
      ?.querySelector('select') as HTMLSelectElement | undefined
    expect(effortSelect?.value).toBe('xhigh')
  })

  // Review of PR #1140: the list is the saved key's, so a key being replaced
  // in the same form must not offer the old account's models.
  it('stops offering the saved key models while a new key is typed', async () => {
    await act(async () => {
      root.render(createElement(Editor, { initial: 'grok-4.7?reasoning_effort=xhigh' }))
    })
    expect(modelSelect().value).toBe('grok-4.7')
    const keyInput = Array.from(container.querySelectorAll('input')).find((i) => i.value === '…abcd')
    if (!keyInput) throw new Error('no key input')
    await act(async () => change(keyInput, 'crsr_new'))
    expect(container.querySelector('select[aria-label="Default model"]')).toBeNull()
    expect(container.textContent).not.toContain('Reasoning effort')
    expect(container.querySelector('[data-testid="cursor-model-after-save"]')).not.toBeNull()
    const manual = container.querySelector<HTMLInputElement>('input[aria-label="Default model"]')
    expect(manual?.value).toBe('grok-4.7?reasoning_effort=xhigh')
    await act(async () => change(manual!, 'composer-2.5'))
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Default model"]')?.value).toBe('composer-2.5')
  })

  it('types a spec when the model list does not load', async () => {
    modelsPage.current = { data: null, error: 'down', loading: false, reload: () => {} }
    await act(async () => {
      root.render(createElement(Editor, { initial: '' }))
    })
    expect(container.textContent).toContain("Cursor's model list did not load")
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Default model"]')
    if (!input) throw new Error('no fallback input')
    await act(async () => change(input, 'custom-1'))
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Default model"]')?.value).toBe('custom-1')
  })
})
