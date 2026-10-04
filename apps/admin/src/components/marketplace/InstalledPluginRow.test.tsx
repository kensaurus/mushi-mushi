/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/marketplace/InstalledPluginRow.test.tsx
 * PURPOSE: Installed plugin controls on /marketplace.
 *
 * Why (2026-10-04, QA entries 34, 37, 151 and 276):
 * - Edit URL → Save did nothing at all for a non-https URL.
 * - Rotate secret rotated on the first click and broke the receiver.
 * - Members saw every control and each click ended in a 403.
 * - Delivery rows could only be expanded with a mouse.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstalledPluginRow } from './InstalledPluginRow'
import { DispatchTable } from './DispatchTable'
import type { DispatchEntry, InstalledPlugin } from './types'

const PLUGIN = {
  plugin_name: 'Zapier',
  plugin_slug: 'zapier',
  webhook_url: 'https://hooks.example.com/mushi',
  subscribed_events: [],
  is_active: true,
  last_delivery_at: null,
  last_delivery_status: null,
} as unknown as InstalledPlugin

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const byText = (root: ParentNode, t: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === t)

describe('InstalledPluginRow', () => {
  let container: HTMLDivElement
  let root: Root
  let handlers: {
    onTest: ReturnType<typeof vi.fn>
    onTogglePause: ReturnType<typeof vi.fn>
    onEditUrl: ReturnType<typeof vi.fn>
    onRotateSecret: ReturnType<typeof vi.fn>
    onUninstall: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    handlers = {
      onTest: vi.fn(async () => {}),
      onTogglePause: vi.fn(async () => {}),
      onEditUrl: vi.fn(async () => {}),
      onRotateSecret: vi.fn(async () => 'whsec_new'),
      onUninstall: vi.fn(),
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  async function render(canManage = true) {
    await act(async () => {
      root.render(createElement(InstalledPluginRow, { plugin: PLUGIN, busy: false, canManage, ...handlers }))
    })
  }

  it('explains a non-https URL instead of silently ignoring Save', async () => {
    await render()
    await act(async () => byText(container, 'Edit URL')!.click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Webhook URL"]')!
    await act(async () => setInputValue(input, 'http://example.com/hook'))
    await act(async () => byText(container, 'Save')!.click())
    expect(handlers.onEditUrl).not.toHaveBeenCalled()
    expect(container.textContent).toMatch(/must start with https:\/\//)
  })

  it('keeps the editor open when the save fails, without an unhandled rejection', async () => {
    handlers.onEditUrl.mockRejectedValueOnce(new Error('refused'))
    await render()
    await act(async () => byText(container, 'Edit URL')!.click())
    await act(async () => byText(container, 'Save')!.click())
    expect(handlers.onEditUrl).toHaveBeenCalledWith('zapier', 'https://hooks.example.com/mushi')
    expect(container.querySelector('input[aria-label="Webhook URL"]')).not.toBeNull()
  })

  it('asks before rotating the signing secret', async () => {
    await render()
    await act(async () => byText(container, 'Rotate secret')!.click())
    expect(handlers.onRotateSecret).not.toHaveBeenCalled()
    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[data-primary]')).find(
      (b) => b.textContent?.trim() === 'Rotate secret',
    )!
    await act(async () => confirm.click())
    expect(handlers.onRotateSecret).toHaveBeenCalledWith('zapier')
    expect(container.textContent).toContain('whsec_new')
  })

  it('disables every write for members, with the reason', async () => {
    await render(false)
    for (const label of ['Test', 'Pause', 'Edit URL', 'Rotate secret', 'Uninstall']) {
      const b = byText(container, label)!
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('title')).toMatch(/Owners and admins/)
    }
  })
})

describe('DispatchTable', () => {
  it('expands a delivery response from a keyboard-reachable button', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const entry = {
      id: 7,
      delivery_id: 'abcdef1234567890',
      created_at: '2026-10-04T00:00:00Z',
      plugin_slug: 'zapier',
      event: 'report.created',
      status: 'error',
      http_status: 500,
      duration_ms: 120,
      response_excerpt: 'Internal error from receiver',
    } as unknown as DispatchEntry
    await act(async () => {
      root.render(
        createElement(DispatchTable, {
          entries: [entry],
          installedPluginOptions: [],
          pluginFilter: '',
          statusFilter: '',
          onPluginFilter: () => {},
          onStatusFilter: () => {},
        }),
      )
    })
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect(container.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('#delivery-response-7')?.textContent).toContain('Internal error from receiver')
    act(() => root.unmount())
    container.remove()
  })
})
