/**
 * @vitest-environment jsdom
 *
 * Report 2d5e2bd7: on a server with no Slack app, "Add to Slack" answered
 * "SLACK_CLIENT_ID is not set on this server" in a toast and nothing else
 * happened. The card now says so in plain words, stops offering the button,
 * and opens the webhook form, which works without a Slack app.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => mocks.toast }))

import { SlackIntegrationCard, isSlackInstallUnavailable, slackErrorToMessage } from './SlackIntegrationCard'
import { coerceApiResult } from '../../lib/apiEnvelope'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  sessionStorage.clear()
  mocks.apiFetch.mockReset()
  mocks.toast.error.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function buttons(text: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === text)
}

function render() {
  act(() => {
    root.render(createElement(SlackIntegrationCard, { projectId: 'p1', slackConfigured: false, teamName: null }))
  })
}

describe('slackErrorToMessage', () => {
  it('tells the user to reselect a missing or archived channel', () => {
    expect(slackErrorToMessage('channel_not_found', '')).toMatch(/pick the channel again/i)
    expect(slackErrorToMessage('is_archived', '')).toMatch(/pick another channel/i)
  })

  it('tells the user to invite the bot when it is not in the channel', () => {
    expect(slackErrorToMessage('not_in_channel', '')).toMatch(/\/invite/)
  })

  it('reads the Slack code when the test endpoint wraps it as SLACK_API_ERROR', () => {
    expect(slackErrorToMessage('SLACK_API_ERROR', 'channel_not_found')).toMatch(/pick the channel again/i)
    expect(slackErrorToMessage('SLACK_API_ERROR', 'not_in_channel')).toMatch(/\/invite/)
  })
})

describe('isSlackInstallUnavailable', () => {
  it('is true only for the server not having a Slack app', () => {
    expect(isSlackInstallUnavailable({ code: 'NOT_CONFIGURED' })).toBe(true)
    expect(isSlackInstallUnavailable({ code: 'NO_PROJECT_SELECTED' })).toBe(false)
    expect(isSlackInstallUnavailable(null)).toBe(false)
  })

  it("survives apiFetch's error mapping: the route's 503 body keeps its code", () => {
    // apiFetch returns coerceApiResult(body) for a non-2xx body with an error envelope.
    const body = { ok: false, error: { code: 'NOT_CONFIGURED', message: "One-click Slack install isn't set up on this server. Paste an incoming webhook URL instead." } }
    const res = coerceApiResult(body)
    expect(res.ok).toBe(false)
    expect(isSlackInstallUnavailable(res.ok ? null : res.error)).toBe(true)
  })
})

describe('SlackIntegrationCard send test', () => {
  it('explains a stale channel instead of a raw Slack code', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('channels')) return { ok: true, data: { channels: [] } }
      return { ok: false, error: { code: 'SLACK_API_ERROR', message: 'channel_not_found' } }
    })
    act(() => {
      root.render(createElement(SlackIntegrationCard, {
        projectId: 'p1',
        slackConfigured: true,
        teamName: 'Acme',
        canPost: true,
      }))
    })
    await act(async () => {
      await flush()
    })
    await act(async () => {
      buttons('Send test')[0].click()
      await flush()
    })
    const description = mocks.toast.error.mock.calls[0]?.[1] as string
    expect(description).toMatch(/pick the channel again/i)
    expect(description).not.toMatch(/channel_not_found/)
  })
})

describe('SlackIntegrationCard on a server without a Slack app', () => {
  it('turns "Add to Slack" into the webhook form, in plain words', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: "One-click Slack install isn't set up on this server." },
    })
    render()
    const details = host.querySelector<HTMLDetailsElement>('[data-testid="slack-webhook-option"]')!
    expect(details.open).toBe(false)

    await act(async () => {
      buttons('Add to Slack')[0].click()
      await flush()
    })

    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(buttons('Add to Slack')).toHaveLength(0)
    expect(host.textContent).toContain("One-click Slack install isn't set up on this server")
    expect(host.textContent).not.toMatch(/SLACK_CLIENT_ID/)
    expect(details.open).toBe(true)
    expect(buttons('Use a webhook URL')).toHaveLength(1)
  })

  it('remembers it for the session, so the dead button is not offered again', () => {
    sessionStorage.setItem('mushi:slack-install-unavailable', '1')
    render()
    expect(buttons('Add to Slack')).toHaveLength(0)
    expect(host.querySelector<HTMLDetailsElement>('[data-testid="slack-webhook-option"]')!.open).toBe(true)
  })

  it('another failure still shows its error', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: false, error: { code: 'NO_PROJECT_SELECTED', message: 'Pick an app first.' } })
    render()
    await act(async () => {
      buttons('Add to Slack')[0].click()
      await flush()
    })
    expect(mocks.toast.error).toHaveBeenCalled()
    expect(buttons('Add to Slack').length).toBeGreaterThan(0)
  })
})
