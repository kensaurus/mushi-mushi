/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/NotificationChannelCards.test.tsx
 * PURPOSE: The Slack, Discord and Teams cards on /integrations/config.
 *
 * Why (2026-10-04, QA entries 37, 38 and 274):
 * - Discord and Teams "Remove" deleted the webhook on the first click; the
 *   URL cannot be read back, so a misclick lost it. Remove now asks first.
 * - The Teams card accepted any https host, then the save failed with the raw
 *   "teams_webhook_url: host is not an allowed webhook provider".
 * - Slack saves toasted success but the card kept the old state until a full
 *   reload: nothing re-read the settings the status line comes from.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => api)

import { DiscordIntegrationCard } from './DiscordIntegrationCard'
import { TeamsIntegrationCard } from './TeamsIntegrationCard'
import { SlackIntegrationCard } from './SlackIntegrationCard'

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function buttonByText(root: ParentNode, text: RegExp): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => text.test(b.textContent ?? ''))
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function patchCalls(): Array<Record<string, unknown>> {
  return api.apiFetch.mock.calls
    .filter((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH')
    .map((c) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>)
}

describe('notification channel cards', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it.each([
    ['Discord', DiscordIntegrationCard, { discordConfigured: true }, 'discord_webhook_url'],
    ['Teams', TeamsIntegrationCard, { teamsConfigured: true }, 'teams_webhook_url'],
  ] as const)('%s Remove asks first and only PATCHes after Confirm', async (_name, Card, props, field) => {
    const onChanged = vi.fn()
    await act(async () => {
      root.render(createElement(Card as never, { projectId: PROJECT, onChanged, ...props }))
      await flush()
    })

    await act(async () => {
      buttonByText(container, /^Remove$/)!.click()
      await flush()
    })
    expect(patchCalls()).toHaveLength(0)
    const confirm = buttonByText(document.body, /^Remove webhook$/)
    expect(confirm).toBeTruthy()

    await act(async () => {
      confirm!.click()
      await flush()
    })
    expect(patchCalls()).toEqual([{ [field]: null }])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('Teams refuses a non-Microsoft host before saving', async () => {
    await act(async () => {
      root.render(createElement(TeamsIntegrationCard, { projectId: PROJECT, teamsConfigured: false }))
      await flush()
    })
    const input = container.querySelector<HTMLInputElement>('#teams-webhook-url')!
    await act(async () => {
      setInputValue(input, 'https://example.com/hook')
      await flush()
    })
    const save = buttonByText(container, /^Save$/)!
    expect(save.disabled).toBe(true)
    expect(container.textContent).toMatch(/not a Teams webhook URL/)

    await act(async () => {
      setInputValue(input, 'https://acme.webhook.office.com/webhookb2/abc')
      await flush()
    })
    expect(buttonByText(container, /^Save$/)!.disabled).toBe(false)
  })

  it('Slack webhook save re-reads the settings so the card updates', async () => {
    const onChanged = vi.fn()
    await act(async () => {
      root.render(
        createElement(SlackIntegrationCard, {
          projectId: PROJECT,
          slackConfigured: false,
          teamName: null,
          onChanged,
        }),
      )
      await flush()
    })
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!
    await act(async () => {
      setInputValue(input, 'https://hooks.slack.com/services/T0/B0/xyz')
      await flush()
    })
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('details button')).find(
      (b) => (b.textContent ?? '').trim() === 'Save',
    )!
    await act(async () => {
      save.click()
      await flush()
    })
    expect(patchCalls()).toEqual([{ slack_webhook_url: 'https://hooks.slack.com/services/T0/B0/xyz' }])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('Slack refuses a webhook URL that is not on hooks.slack.com', async () => {
    await act(async () => {
      root.render(createElement(SlackIntegrationCard, { projectId: PROJECT, slackConfigured: false, teamName: null }))
      await flush()
    })
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!
    await act(async () => {
      setInputValue(input, 'https://example.com/hook')
      await flush()
    })
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('details button')).find(
      (b) => (b.textContent ?? '').trim() === 'Save',
    )!
    expect(save.disabled).toBe(true)
  })
})
