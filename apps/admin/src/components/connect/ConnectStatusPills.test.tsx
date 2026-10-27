/**
 * @vitest-environment jsdom
 *
 * Connect opens on three pills: SDK heartbeat (SDK keys only), SDK version
 * with an upgrade badge when behind, and the editor connection. Each pill
 * jumps to a section that exists on the page.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConnectStatusPills, connectPills, sdkIsBehind } from './ConnectStatusPills'
import { SDK_HEALTH_ANCHOR } from '../../lib/sdkHealth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-10-27T12:00:00Z')
const CONNECT_SECTION_IDS = ['connect-studio', 'connect-github', SDK_HEALTH_ANCHOR, 'connect-sdk', 'connect-update']

describe('connectPills', () => {
  it('a fresh SDK on the latest version with an editor connected reads all green', () => {
    const pills = connectPills({
      sdkLastSeenAt: '2026-10-27T11:58:00Z',
      sdkVersion: '0.24.4',
      sdkLatestVersion: '0.24.4',
      sdkStatus: 'up-to-date',
      mcpStats: { connectedKeyCount: 2, lastSeenAt: '2026-10-27T11:00:00Z' },
      now: NOW,
    })
    expect(pills.map((p) => [p.id, p.value, p.tone])).toEqual([
      ['heartbeat', 'Heard 2m ago', 'ok'],
      ['version', '0.24.4', 'ok'],
      ['editor', '2 connected, last call 1h ago', 'ok'],
    ])
  })

  it('an SDK that is behind gets an upgrade badge; a quiet one is amber, a never-seen one neutral', () => {
    const behind = connectPills({
      sdkLastSeenAt: '2026-10-27T02:00:00Z',
      sdkVersion: '0.24.3',
      sdkLatestVersion: '0.24.4',
      sdkStatus: null,
      mcpStats: { connectedKeyCount: 0, lastSeenAt: null },
      now: NOW,
    })
    expect(behind[0].tone).toBe('warn')
    expect(behind[1]).toMatchObject({ tone: 'warn', badge: '0.24.4 available' })
    expect(behind[2]).toMatchObject({ value: 'Not connected', tone: 'neutral' })
    const never = connectPills({ sdkLastSeenAt: null, sdkVersion: null, sdkLatestVersion: null, sdkStatus: null, mcpStats: { connectedKeyCount: 0, lastSeenAt: null }, now: NOW })
    expect(never[0]).toMatchObject({ value: 'Not heard yet', tone: 'neutral' })
  })

  it('every pill jumps to a Connect section that exists', () => {
    const pills = connectPills({ sdkLastSeenAt: null, sdkVersion: null, sdkLatestVersion: null, sdkStatus: null, mcpStats: { connectedKeyCount: 0, lastSeenAt: null }, now: NOW })
    for (const p of pills) expect(CONNECT_SECTION_IDS).toContain(p.href.slice(1))
  })

  it('treats a deprecated or outdated status as behind even without a latest version', () => {
    expect(sdkIsBehind({ sdkVersion: '0.1.0', sdkLatestVersion: null, sdkStatus: 'deprecated' })).toBe(true)
    expect(sdkIsBehind({ sdkVersion: '0.1.0', sdkLatestVersion: '0.1.0', sdkStatus: null })).toBe(false)
  })
})

describe('ConnectStatusPills', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('offers "Upgrade the SDK" only when the SDK is behind', () => {
    const base = { sdkLastSeenAt: null, sdkLatestVersion: '0.24.4', sdkStatus: null, mcpStats: { connectedKeyCount: 0, lastSeenAt: null } }
    act(() => root.render(createElement(MemoryRouter, null, createElement(ConnectStatusPills, { ...base, sdkVersion: '0.24.3' }))))
    expect(Array.from(host.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Upgrade the SDK'])
    act(() => root.render(createElement(MemoryRouter, null, createElement(ConnectStatusPills, { ...base, sdkVersion: '0.24.4' }))))
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.querySelectorAll('[data-pill]')).toHaveLength(3)
  })
})
