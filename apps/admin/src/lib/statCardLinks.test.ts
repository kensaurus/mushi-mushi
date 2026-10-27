/**
 * FILE: apps/admin/src/lib/statCardLinks.test.ts
 * PURPOSE: Snapshot cards that open /reports carry the filters that
 *          reproduce their count. /reports reads no `tab` param, so
 *          `?tab=queue` / `?tab=severity` opened the unfiltered list, and
 *          `/inbox?tab=inbox` is not a tab (2026-10-04 console audit, group B
 *          items 79 and 236). Group E cards (130–132) land on real tabs too.
 */

import { describe, expect, it } from 'vitest'
import { connectLinks, fixesLinks, judgeLinks, mcpLinks, onboardingLinks, repoLinks, researchLinks, settingsLinks, ssoLinks } from './statCardLinks'

import { resolveMcpTab } from './mcpPageHelpers'
import { ONBOARDING_TAB_IDS } from '../components/onboarding/types'
import { mintMcpKeyHref } from '../components/mcp/McpStatusBanner'
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
  it('opens Your projects at the mint control with the mcp:read preset the copy names', () => {
    const url = new URL(mintMcpKeyHref('p1'), 'https://console.example')
    expect(url.hash).toBe('#mint-key-p1')
    expect(url.searchParams.get('project')).toBe('p1')
    expect(SCOPE_PRESETS.find((p) => p.id === url.searchParams.get('keyScope'))!.scopes).toEqual(['mcp:read'])
    expect(url.pathname).toBe('/projects')
    expect(url.searchParams.get('tab')).toBe('list')
    const preset = url.searchParams.get('keyScope')
    expect(isScopePresetId(preset)).toBe(true)
    expect(SCOPE_PRESETS.find((p) => p.id === preset)!.scopes.some((s) => s.startsWith('mcp:'))).toBe(true)
  })
})

/**
 * PURPOSE: Snapshot tiles must open a tab and filter the page really has.
 *
 * Console QA group C (2026-10-04): four /judge tiles linked to `?tab=scores`
 * and `?tab=disagreements`, which JudgePage resolves to Overview (QA 106);
 * the /fixes "Failed" tile opened the unfiltered list (QA 242). The allowed
 * values below mirror resolveJudgeTab / resolveFixesTab / resolveRepoTab and
 * each page's status filter. Add a value here only with the page change.
 */


const PAGE_TABS: Record<string, string[]> = {
  '/judge': ['trend', 'evaluations', 'prompts'],
  '/fixes': ['pipeline', 'attempts'],
  '/repo': ['branches', 'activity'],
}

const PAGE_STATUS: Record<string, string[]> = {
  '/fixes': ['failed', 'inflight', 'pr_open', 'merged'],
  '/repo': ['open', 'ci_passing', 'ci_failed', 'failed', 'merged'],
}

function check(link: string) {
  const url = new URL(link, 'https://console.test')
  const tabs = PAGE_TABS[url.pathname]
  if (!tabs) return
  const tab = url.searchParams.get('tab')
  if (tab !== null) expect(tabs, `${link} names tab "${tab}"`).toContain(tab)
  const status = url.searchParams.get('status')
  if (status !== null) expect(PAGE_STATUS[url.pathname] ?? [], `${link} names status "${status}"`).toContain(status)
}

describe('snapshot tile links', () => {
  it('every /judge, /fixes and /repo tile opens a real tab and filter', () => {
    for (const link of [...Object.values(judgeLinks), ...Object.values(fixesLinks), ...Object.values(repoLinks)]) {
      check(link)
    }
  })

  it('the judge Disagreements tile opens the filtered evaluations', () => {
    expect(judgeLinks.disagree).toBe('/judge?tab=evaluations&filter=disagreement')
  })

  it('the fixes Failed tile opens the failed filter', () => {
    expect(new URL(fixesLinks.failed, 'https://c.test').searchParams.get('status')).toBe('failed')
  })
})

/**
 * Stat cards must land somewhere real (suspected-bugs entries 110 and 257):
 * every Settings link names a tab Settings renders (not an old alias), and
 * /sso has no tabs at all.
 */

import { SETTINGS_TAB_IDS } from '../components/settings/types'

describe('settingsLinks', () => {
  it('points every ?tab= link at a tab Settings renders', () => {
    for (const to of [...Object.values(settingsLinks), researchLinks.firecrawl]) {
      const url = new URL(to, 'https://console.test')
      if (url.pathname !== '/settings') continue
      const tab = url.searchParams.get('tab')
      if (tab) expect(SETTINGS_TAB_IDS).toContain(tab)
    }
  })

  it('sends the bug-widget card to SDK & connection, where the widget controls are', () => {
    expect(settingsLinks.sdk).toBe('/settings?tab=sdk')
  })
})

describe('ssoLinks', () => {
  it('scrolls to the providers list instead of a tab that does not exist', () => {
    for (const to of [ssoLinks.registered, ssoLinks.pendingFailed, ssoLinks.emailDomains]) {
      expect(to).toBe('/sso#sso-providers')
    }
  })
})

/**
 * Report c0dc93ec: screen readers heard "Go to Health · LLM", "Drift",
 * "Anomalies", "Intelligence", "Iterate" and "Repo" — names those pages lost
 * in the October navigation pass. Labels now come from the nav registry.
 */
import * as allLinks from './statCardLinks'
import { statDestinationLabel, statLinkLabel } from './statCardLinks'

describe('statDestinationLabel', () => {
  const RETIRED = /\b(Health|LLM|Drift|Anomalies|Intelligence|Iterate|Repo|Judge|Codebase|BYOK|Inbox|Dashboard|Query|Marketplace|Notifications|QA Coverage|Cron)\b/

  it('never names a retired page or tab for any stat-card link', () => {
    const groups = Object.entries(allLinks).filter(([name]) => name.endsWith('Links')) as Array<[string, Record<string, string>]>
    expect(groups.length).toBeGreaterThan(10)
    for (const [, group] of groups) {
      for (const to of Object.values(group)) {
        expect(statDestinationLabel(to), to).not.toMatch(RETIRED)
      }
    }
  })

  it('reads hub views and retired routes as the view they open', () => {
    expect(statDestinationLabel('/health?view=schema')).toBe('Schema changes')
    expect(statDestinationLabel('/drift?tab=findings')).toBe('Schema changes · Changes')
    expect(statDestinationLabel('/cost?tab=breakdown')).toBe('AI spend · Breakdown')
    expect(statDestinationLabel('/repo?tab=branches')).toBe('Pull requests')
    expect(statDestinationLabel('/repo?tab=branches&status=ci_failed')).toBe('Pull requests · Failing CI')
    expect(statDestinationLabel('/judge?tab=evaluations')).toBe('Triage grading · Grades')
    expect(statDestinationLabel('/fixes?tab=attempts&status=failed')).toBe('Fixes · All fixes: Stopped')
  })

  it('says "Show" for a tab or filter of the page or hub view the user is on', () => {
    expect(statLinkLabel('/judge?tab=trend', '/judge')).toBe('Show Trend')
    expect(statLinkLabel('/judge?tab=trend', '/fixes')).toBe('Go to Triage grading · Trend')
    expect(statLinkLabel('/team?view=billing', '/team')).toBe('Go to Billing')
    expect(statLinkLabel('/team?view=billing&tab=plans', '/team?view=billing')).toBe('Show Plans')
    // A retired route is the hub view it opens: on /health?view=schema the
    // Drift links are the same page.
    expect(statLinkLabel('/drift?tab=findings', '/health?view=schema')).toBe('Show Changes')
    expect(statLinkLabel('/drift?tab=findings', '/health')).toBe('Go to Schema changes · Changes')
    // The filter is named, not just the tab.
    expect(statLinkLabel('/fixes?tab=attempts&status=failed', '/fixes')).toBe('Show All fixes: Stopped')
  })
})
