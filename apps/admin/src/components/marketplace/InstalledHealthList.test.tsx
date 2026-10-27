/**
 * @vitest-environment jsdom
 *
 * Plugins opens on the plugins you installed and whether each delivers,
 * failing first; subscribed events read as words, never a bare "*"
 * (report fb35c525).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InstalledHealthList } from './InstalledHealthList'
import { PluginCard } from './PluginCard'
import { pluginEventLabel, pluginHealth, type InstalledPlugin, type MarketplacePlugin, type ReliabilityStats } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const plugin = (over: Partial<InstalledPlugin>): InstalledPlugin => ({
  plugin_name: 'Zapier Bridge',
  plugin_slug: 'zapier',
  webhook_url: 'https://hooks.zapier.com/x',
  subscribed_events: [],
  is_active: true,
  last_delivery_at: new Date().toISOString(),
  last_delivery_status: 'ok',
  ...over,
})

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

describe('pluginEventLabel', () => {
  it('says all events in words', () => {
    expect(pluginEventLabel('*')).toBe('All events')
    expect(pluginEventLabel('qa_story.*')).toBe('All qa story events')
    expect(pluginEventLabel('report.classified')).toBe('report.classified')
  })
})

describe('pluginHealth', () => {
  it('reads paused, failing, silent and delivering', () => {
    expect(pluginHealth(plugin({ is_active: false }))).toEqual({ tone: 'neutral', label: 'Paused' })
    expect(pluginHealth(plugin({ last_delivery_status: 'timeout' })).tone).toBe('danger')
    expect(pluginHealth(plugin({ last_delivery_at: null, last_delivery_status: null }))).toEqual({ tone: 'warn', label: 'Nothing sent yet' })
    expect(pluginHealth(plugin({}), { total: 5, ok: 4, error: 1, avgLatency: 90 }).tone).toBe('warn')
    expect(pluginHealth(plugin({}), { total: 5, ok: 5, error: 0, avgLatency: 90 })).toEqual({ tone: 'ok', label: 'Delivering' })
  })
})

describe('InstalledHealthList', () => {
  it('lists failing plugins first with their last 7 days', () => {
    const stats = new Map<string, ReliabilityStats>([['hook', { total: 12, ok: 9, error: 3, avgLatency: 120 }]])
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(InstalledHealthList, {
            installed: [plugin({ plugin_name: 'Zapier Bridge' }), plugin({ plugin_name: 'My hook', plugin_slug: 'hook', last_delivery_status: 'error' })],
            reliabilityBySlug: stats,
          }),
        ),
      )
    })
    const rows = Array.from(host.querySelectorAll('[aria-label="Your plugins"] > li')).map((li) => li.textContent)
    expect(rows[0]).toContain('My hook')
    expect(rows[0]).toContain('Last delivery failed')
    expect(rows[0]).toContain('12 sent in 7 days · 3 failed')
    expect(rows[1]).toContain('No deliveries in the last 7 days')
  })
})

describe('PluginCard events', () => {
  it('shows "All events" instead of an asterisk', () => {
    const p: MarketplacePlugin = {
      slug: 'zapier',
      name: 'Zapier Bridge',
      short_description: 'Fan out any Mushi event.',
      long_description: null,
      publisher: 'mushi-mushi',
      source_url: null,
      manifest: { subscribes: ['*'] },
      required_scopes: [],
      install_count: 0,
      category: 'integration',
      is_official: true,
    }
    act(() => {
      root.render(
        createElement(MemoryRouter, null, createElement(PluginCard, { plugin: p, installed: undefined, stats: undefined, busy: false, onInstall: () => {}, onUninstall: () => {} })),
      )
    })
    const chips = Array.from(host.querySelectorAll('code')).map((c) => c.textContent)
    expect(chips).toEqual(['All events'])
  })
})
