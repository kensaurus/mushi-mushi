/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/GeneralPanel.secrets.test.tsx
 * PURPOSE: GET /v1/admin/settings returns stored secrets as a mask plus a
 *          `<column>_set` flag. General settings must (1) never send that mask
 *          back on save and (2) remove a stored secret only through the
 *          explicit Remove → confirm step, which PATCHes that one column to null.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const MASK = '••••••••'
const SETTINGS = {
  slack_channel_id: 'C123',
  slack_webhook_url: MASK,
  slack_webhook_url_set: true,
  sentry_dsn: 'https://pub@o0.ingest.sentry.io/1',
  sentry_webhook_secret: MASK,
  sentry_webhook_secret_set: true,
  telegram_bot_token_ref: MASK,
  telegram_bot_token_ref_set: true,
  stage2_model: 'claude-sonnet-5-5',
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => mocks.toast }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path === '/v1/admin/settings' ? SETTINGS : null,
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { GeneralPanel } from './GeneralPanel'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`no button "${text}"`)
  return btn
}

function patchBodies(): Array<Record<string, unknown>> {
  return mocks.apiFetch.mock.calls
    .filter(([path, init]) => path === '/v1/admin/settings' && (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('GeneralPanel stored secrets', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    mocks.reload.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      // The Supabase row links to the AI keys tab, so it needs a router.
      root.render(createElement(MemoryRouter, null, createElement(GeneralPanel)))
      await flush()
    })
  }

  it('shows saved secrets as empty fields and never sends the mask back on save', async () => {
    await render()
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    expect(inputs.some((i) => i.value.includes('••'))).toBe(false)

    const channel = inputs.find((i) => i.value === 'C123')!
    await act(async () => {
      typeInto(channel, 'C999')
      await flush()
    })
    await act(async () => {
      buttonByText('Save changes').click()
      await flush()
    })

    expect(patchBodies()).toEqual([{ slack_channel_id: 'C999' }])
  })

  it('removes one stored secret only after confirming, and sends null for that column alone', async () => {
    await render()
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove sentry webhook secret"]')!
    await act(async () => {
      remove.click()
      await flush()
    })
    // Nothing is sent until the confirm step.
    expect(patchBodies()).toEqual([])

    await act(async () => {
      buttonByText('Cancel').click()
      await flush()
    })
    expect(patchBodies()).toEqual([])

    await act(async () => {
      remove.click()
      await flush()
    })
    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[data-primary]')).find(
      (b) => b.textContent?.trim() === 'Remove',
    )!
    await act(async () => {
      confirm.click()
      await flush()
    })

    expect(patchBodies()).toEqual([{ sentry_webhook_secret: null }])
    expect(mocks.reload).toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalledWith('Sentry webhook secret removed')
  })
})
