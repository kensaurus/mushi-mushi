/**
 * @vitest-environment jsdom
 */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ConnectionStatus, EXPIRY_WARNING_DAYS, connectionStateFrom } from './ConnectionStatus'

const NOW = Date.parse('2026-10-04T01:00:00Z')
const H = 3_600_000
const iso = (ms: number) => new Date(NOW + ms).toISOString()

describe('connectionStateFrom', () => {
  it('not configured is not connected, whatever else is set', () => {
    expect(connectionStateFrom({ configured: false, verifiedAt: iso(-H), now: NOW })).toBe('not_connected')
  })

  it('a failing last check needs attention', () => {
    expect(
      connectionStateFrom({ configured: true, verifiedAt: iso(-H), lastError: 'Token revoked', now: NOW }),
    ).toBe('attention')
  })

  it('never verified reads "not checked yet", never "working"', () => {
    expect(connectionStateFrom({ configured: true, now: NOW })).toBe('checking')
  })

  it('a recent verification is working; an old one needs a re-test', () => {
    expect(connectionStateFrom({ configured: true, verifiedAt: iso(-2 * H), now: NOW })).toBe('working')
    expect(connectionStateFrom({ configured: true, verifiedAt: iso(-8 * 24 * H), now: NOW })).toBe('attention')
    expect(
      connectionStateFrom({
        configured: true,
        verifiedAt: iso(-8 * 24 * H),
        now: NOW,
        staleAfterMs: 30 * 24 * H,
      }),
    ).toBe('working')
  })

  it('warns before expiry and flags an expired credential', () => {
    expect(
      connectionStateFrom({ configured: true, verifiedAt: iso(-H), expiresAt: iso(5 * 24 * H), now: NOW }),
    ).toBe('expiring')
    expect(
      connectionStateFrom({ configured: true, verifiedAt: iso(-H), expiresAt: iso(60 * 24 * H), now: NOW }),
    ).toBe('working')
    // One 7-day window console-wide (shared with the Settings key rows).
    expect(EXPIRY_WARNING_DAYS).toBe(7)
    expect(
      connectionStateFrom({ configured: true, verifiedAt: iso(-H), expiresAt: iso(7 * 24 * H), now: NOW }),
    ).toBe('expiring')
    expect(
      connectionStateFrom({ configured: true, verifiedAt: iso(-H), expiresAt: iso(10 * 24 * H), now: NOW }),
    ).toBe('working')
    expect(
      connectionStateFrom({
        configured: true,
        verifiedAt: iso(-H),
        expiresAt: iso(10 * 24 * H),
        now: NOW,
        expiryWarningDays: 14,
      }),
    ).toBe('expiring')
    expect(
      connectionStateFrom({ configured: true, verifiedAt: iso(-H), expiresAt: iso(-H), now: NOW }),
    ).toBe('attention')
  })
})

let root: Root | null = null
let host: HTMLElement | null = null

function render(el: ReactElement): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('ConnectionStatus', () => {
  it('renders the state as real text with the fix as a real button', () => {
    let clicked = 0
    const el = render(
      <ConnectionStatus
        state="attention"
        detail="Connected — waiting for the first Sentry event."
        action={{ label: 'Open Sentry alerts', onClick: () => { clicked += 1 } }}
      />,
    )
    expect(el.textContent).toContain('Needs attention')
    expect(el.textContent).toContain('Connected — waiting for the first Sentry event.')
    const button = el.querySelector('button')!
    expect(button.textContent).toBe('Open Sentry alerts')
    act(() => button.click())
    expect(clicked).toBe(1)
  })

  it('renders a link action for not connected', () => {
    const el = render(
      <MemoryRouter>
        <ConnectionStatus state="not_connected" action={{ label: 'Connect', to: '/integrations/config' }} />
      </MemoryRouter>,
    )
    expect(el.textContent).toContain('Not connected')
    const link = el.querySelector('a')!
    expect(link.textContent).toBe('Connect')
    expect(link.getAttribute('href')).toBe('/integrations/config')
  })

  it('shows days left for an expiring credential', () => {
    const in3 = new Date(Date.now() + 3 * 24 * H - 60_000).toISOString()
    expect(render(<ConnectionStatus state="expiring" expiresAt={in3} />).textContent).toContain('Expires in 3 days')
  })

  it('says "Not checked yet" for checking', () => {
    expect(render(<ConnectionStatus state="checking" />).textContent).toContain('Not checked yet')
  })
})
