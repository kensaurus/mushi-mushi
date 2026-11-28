/**
 * @vitest-environment jsdom
 *
 * Connect's status lines: SDK heartbeat (SDK keys only), SDK version with an
 * upgrade badge when behind, and the editor connection. Each points at a
 * section that exists on the page. The step rows show them (ADR 0069); the
 * "Upgrade the SDK" button lives in the Update center (UpdateCenter).
 */

import { describe, expect, it } from 'vitest'
import { connectPills, sdkIsBehind } from './ConnectStatusPills'
import { SDK_HEALTH_ANCHOR } from '../../lib/sdkHealth'

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
      // "App checked in · 2m ago", not "App checked in · Heard 2m ago" (2026-11-22).
      ['heartbeat', '2m ago', 'ok'],
      ['version', '0.24.4', 'ok'],
      ['editor', '2 connected, last call 1h ago', 'ok'],
    ])
  })

  it('an SDK that is behind gets an upgrade badge; a quiet one is grey, a never-seen one neutral', () => {
    const behind = connectPills({
      sdkLastSeenAt: '2026-10-27T02:00:00Z',
      sdkVersion: '0.24.3',
      sdkLatestVersion: '0.24.4',
      sdkStatus: null,
      mcpStats: { connectedKeyCount: 0, lastSeenAt: null },
      now: NOW,
    })
    // 10 h quiet is normal for a low-traffic app: grey, not amber (2026-11-18).
    expect(behind[0].tone).toBe('neutral')
    const cold = connectPills({ sdkLastSeenAt: '2026-10-19T12:00:00Z', sdkVersion: null, sdkLatestVersion: null, sdkStatus: null, mcpStats: { connectedKeyCount: 0, lastSeenAt: null }, now: NOW })
    expect(cold[0].tone).toBe('warn')
    expect(behind[1]).toMatchObject({ tone: 'warn', badge: '0.24.4 available' })
    expect(behind[2]).toMatchObject({ value: 'Not connected', tone: 'neutral' })
    const never = connectPills({ sdkLastSeenAt: null, sdkVersion: null, sdkLatestVersion: null, sdkStatus: null, mcpStats: { connectedKeyCount: 0, lastSeenAt: null }, now: NOW })
    expect(never[0]).toMatchObject({ value: 'Not yet', tone: 'neutral' })
  })

  // "SDK heartbeat" was jargon to a new user (integrator's walk, 2026-10-28).
  it('names the check-in pill in plain words', () => {
    const pills = connectPills({ sdkLastSeenAt: null, sdkVersion: null, sdkLatestVersion: null, sdkStatus: null, mcpStats: { connectedKeyCount: 0, lastSeenAt: null }, now: NOW })
    expect(pills[0].label).toBe('App checked in')
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
