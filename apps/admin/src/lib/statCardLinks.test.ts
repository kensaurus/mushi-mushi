/**
 * FILE: apps/admin/src/lib/statCardLinks.test.ts
 * PURPOSE: Snapshot cards that open /reports carry the filters that
 *          reproduce their count. /reports reads no `tab` param, so
 *          `?tab=queue` / `?tab=severity` opened the unfiltered list, and
 *          `/inbox?tab=inbox` is not a tab (2026-10-04 console audit, group B
 *          items 79 and 236). Group E cards (130–132) land on real tabs too.
 */

import { describe, expect, it } from 'vitest'
import { connectLinks, inboxLinks, mcpLinks, onboardingLinks, reportsLinks } from './statCardLinks'
import { EMPTY_INBOX_STATS } from '../components/inbox/types'

describe('inbox and reports stat links', () => {
  it('never point /reports at a tab param', () => {
    for (const href of [inboxLinks.backlog, inboxLinks.critical, ...Object.values(reportsLinks)]) {
      expect(href).not.toMatch(/[?&]tab=/)
    }
  })

  it('Critical 14d opens open critical reports from the same window', () => {
    expect(inboxLinks.critical).toBe('/reports?status=open&severity=critical&days=14')
  })

  it('Open falls back to a tab that exists', () => {
    expect(inboxLinks.open({ ...EMPTY_INBOX_STATS, topPriorityTo: null })).toBe('/inbox?tab=actions')
  })
})

import { resolveMcpTab } from './mcpPageHelpers'
import { ONBOARDING_TAB_IDS } from '../components/onboarding/types'
import { MINT_MCP_KEY_HREF } from '../components/mcp/McpStatusBanner'
import { isScopePresetId, SCOPE_PRESETS } from '../components/projects/project-models'

// QA bugs 130, 131: the onboarding "SDK" card linked to /sdk (a 404), the
// Required/Optional cards to a tab that does not exist, the MCP "Tools" card
// to ?tab=tools (rendered Overview), and /connect "SDK live" to a missing
// anchor. Every group E stat-card link must land somewhere real.
const CONNECT_SECTION_IDS = ['connect-studio', 'connect-github', 'connect-sdk', 'connect-native-ci', 'connect-update']

function parse(href: string) {
  const url = new URL(href, 'https://console.example')
  return { path: url.pathname, tab: url.searchParams.get('tab'), hash: url.hash.slice(1) }
}

describe('stat card links land on real tabs and anchors', () => {
  it('onboarding cards open a real onboarding tab', () => {
    for (const href of [onboardingLinks.required, onboardingLinks.sdk, onboardingLinks.optional]) {
      const { path, tab } = parse(href)
      expect(path).toBe('/onboarding')
      expect(ONBOARDING_TAB_IDS as readonly string[]).toContain(tab)
    }
    expect(parse(onboardingLinks.sdk).tab).toBe('sdk')
  })

  it('MCP tool cards open the catalog, not Overview', () => {
    for (const href of [mcpLinks.tools, connectLinks.tools]) {
      const { path, tab } = parse(href)
      expect(path).toBe('/mcp')
      expect(resolveMcpTab(tab)).toBe('catalog')
    }
  })

  it('connect "SDK live" scrolls to a section that exists', () => {
    const { path, hash } = parse(connectLinks.sdk)
    expect(path).toBe('/connect')
    expect(CONNECT_SECTION_IDS).toContain(hash)
  })
})

// QA bug 132: "Mint MCP key" opened /projects on Overview with "SDK ingest" preselected.
describe('MCP banner mint link', () => {
  it('opens Your projects with an MCP key preset chosen', () => {
    const url = new URL(MINT_MCP_KEY_HREF, 'https://console.example')
    expect(url.pathname).toBe('/projects')
    expect(url.searchParams.get('tab')).toBe('list')
    const preset = url.searchParams.get('keyScope')
    expect(isScopePresetId(preset)).toBe(true)
    expect(SCOPE_PRESETS.find((p) => p.id === preset)!.scopes.some((s) => s.startsWith('mcp:'))).toBe(true)
  })
})
