/**
 * @vitest-environment jsdom
 *
 * Site audit row on /credits: the switch still names a stored cadence while
 * the audit is off, the cost line is a cap, and the cadence control is
 * actually disabled while a save is in flight.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditRow } from './SiteAuditControl'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}))

import { SiteAuditControl } from './SiteAuditControl'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function row(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'a2',
    enabled: false,
    base_url: 'https://tsumagoi.kensaur.us',
    page_limit: 139,
    cadence_days: 7,
    next_run_at: null,
    batch_id: null,
    last_run_at: null,
    last_error: null,
    last_summary: null,
    ...over,
  }
}

describe('SiteAuditControl', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function render(audit: AuditRow | null) {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SiteAuditControl, {
            projectId: 'p2',
            name: 'tsumagoi',
            audit,
            openFindings: 0,
            url: 'https://tsumagoi.kensaur.us',
            firecrawlReady: true,
            onChanged: () => {},
          }),
        ),
      )
    })
  }

  function switchLabel(): string {
    const sw = host.querySelector('[role="switch"]')
    return (sw?.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim()
  }

  it('keeps the stored cadence in the switch label while the audit is off', async () => {
    const cases: Array<[number, string]> = [
      [7, 'weekly'],
      [1, 'daily'],
      [3, 'every 3 days'],
      [14, 'every 14 days'],
    ]
    for (const [days, phrase] of cases) {
      await render(row({ enabled: false, cadence_days: days }))
      expect(switchLabel()).toBe(`Audit links, accessibility and translations ${phrase}`)
      expect(host.querySelector('[aria-label="How often to audit"]')).toBeNull()
    }
  })

  it('words the page cap as the most a run can cost', async () => {
    await render(row({ enabled: true, page_limit: 139 }))
    const cost = () =>
      Array.from(host.querySelectorAll('span')).find((el) => el.textContent?.includes('credits a run'))?.textContent
    expect(cost()).toBe('Up to 139 credits a run, one per page.')
    await render(row({ enabled: true, page_limit: 200 }))
    expect(cost()).toBe('Up to 200 credits a run, one per page.')
  })

  it('disables the cadence control for keyboard and assistive tech while a save is in flight', async () => {
    let release: (value: { ok: boolean; data: Record<string, never> }) => void = () => {}
    mocks.apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await render(row({ enabled: true, cadence_days: 7, page_limit: 200 }))
    const group = () => host.querySelector('[aria-label="How often to audit"]')
    const radios = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    expect(group()?.getAttribute('aria-disabled')).toBeNull()
    expect(radios().every((radio) => radio.disabled)).toBe(false)

    const daily = radios().find((radio) => radio.textContent === 'Daily')
    if (!daily) throw new Error('no Daily segment')
    await act(async () => {
      daily.click()
    })

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1)
    expect(group()?.getAttribute('aria-disabled')).toBe('true')
    expect(radios().every((radio) => radio.disabled)).toBe(true)

    await act(async () => {
      release({ ok: true, data: {} })
    })
    expect(group()?.getAttribute('aria-disabled')).toBeNull()
    expect(radios().every((radio) => radio.disabled)).toBe(false)
  })
})
