/**
 * @vitest-environment jsdom
 *
 * Report fe489587, as the Diagnose tab renders it: mushi-demo had one
 * read-only MCP key last called 17 days ago (the docs demo, by curl) and one
 * report:write key never used. The card must say the SDK is not connected
 * yet with install advice, never "Cold" or "removed from a deploy", and not
 * in red: a brand-new app has nothing wrong with it.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/useSendTestReport', () => ({ useSendTestReport: () => vi.fn() }))

import { SdkHealthSummary, type SdkHealthApiKey } from './SdkHealthSummary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAYS = 24 * 60 * 60 * 1000
const keys: SdkHealthApiKey[] = [
  { id: 'mcp', key_prefix: 'mushi_dm', label: 'demo-public-readonly', scopes: ['mcp:read'], is_active: true, created_at: new Date(Date.now() - 60 * DAYS).toISOString(), last_seen_at: new Date(Date.now() - 17 * DAYS).toISOString(), last_seen_origin: 'curl' },
  { id: 'sdk', key_prefix: 'mushi_b3', label: 'default', scopes: ['report:write'], is_active: true, created_at: new Date(Date.now() - DAYS).toISOString(), last_seen_at: null },
]

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

describe('SdkHealthSummary on a never-installed app (fe489587)', () => {
  it('says not connected yet with install advice, not Cold or a removed deploy', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SdkHealthSummary, {
            projectId: 'p1',
            projectName: 'mushi-demo',
            projectSlug: 'mushi-demo',
            apiKeys: keys,
            lastReportAt: null,
            adminHost: 'dxptnwrhwsqckaftyymj.supabase.co',
            reportCount: 1,
          }),
        ),
      )
    })
    const text = host.textContent ?? ''
    expect(text).toContain('SDK not connected yet')
    expect(text).toMatch(/initMushi\(\)|missing in/)
    expect(text).not.toMatch(/cold|removed from|deploy stopped|17d ago/i)
    // The MCP key is not listed as the app's SDK key.
    expect(text).not.toContain('demo-public-readonly')
    const red = host.innerHTML.match(/.{0,200}bg-danger.{0,120}/)
    expect(red?.[0] ?? null).toBeNull()
  })
})
