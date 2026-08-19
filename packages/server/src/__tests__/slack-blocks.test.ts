/**
 * Unit tests for Slack Block Kit report card builder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const SAMPLE: import('../../supabase/functions/_shared/slack.ts').SlackReportPayload = {
  projectName: 'solo-boss-cloud',
  category: 'bug',
  severity: 'medium',
  summary: 'ReferenceError: currentPath is not defined in financial-reports profit-loss tab handler',
  reporterToken: 'reporter-hash-token',
  pageUrl: 'http://localhost:5174/financial-reports?tab=profit-loss',
  reportId: '50fbddf2-aaaa-bbbb-cccc-ddddeeeeffff',
  reporterDisplayName: 'Kenji Sakuramoto',
  reporterVerified: false,
  sessionId: 'ms_mq91vabcdef',
  confidence: 0.78,
  component: 'frontend/financial-reports (profit-loss tab)',
  githubAppInstalled: false,
  autofixEnabled: false,
}

type SlackModule = typeof import('../../supabase/functions/_shared/slack.ts')

let slack: SlackModule
const envBackup = { ...process.env }

beforeEach(async () => {
  process.env.ADMIN_BASE_URL = 'https://kensaur.us/mushi-mushi/admin'
  ;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: (key: string) => process.env[key] },
  }
  slack = await import('../../supabase/functions/_shared/slack.ts')
})

afterEach(() => {
  process.env = { ...envBackup }
})

function blockTypes(blocks: unknown[]): string[] {
  return blocks.map((b) => (b as { type: string }).type)
}

describe('buildReportBlocks', () => {
  it('uses compact header → summary → meta context → actions → id footer', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    expect(blockTypes(blocks)).toEqual([
      'header',
      'section',
      'context',
      'actions',
      'context',
    ])
  })

  it('shows summary once as bold text (not a quote block)', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    const summary = (blocks[1] as { text: { text: string } }).text.text
    expect(summary).toBe('*ReferenceError: currentPath is not defined in financial-reports profit-loss tab handler*')
    expect(summary).not.toContain('>')
  })

  it('does not repeat severity/type in a labeled field grid', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    const json = JSON.stringify(blocks)
    expect(json).not.toContain('*Severity*')
    expect(json).not.toContain('*Type*')
  })

  it('packs metadata into one icon context row with page link', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    const meta = (blocks[2] as { elements: Array<{ text: string }> }).elements[0].text
    expect(meta).toContain(':file_folder:')
    expect(meta).toContain(':brain: 78%')
    expect(meta).toContain('financial-reports')
  })

  it('shows Triage / Install GitHub App / Resolve / Dismiss when dispatch unavailable', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    const actions = (blocks[3] as { elements: Array<{ text: { text: string }; style?: string }> }).elements
    expect(actions.map((a) => a.text.text)).toEqual([
      'Triage →',
      'Install GitHub App',
      'Resolve ✓',
      'Dismiss',
    ])
    expect(actions[0].style).toBe('primary')
  })

  it('shows Dispatch fix plus Resolve/Dismiss when configured', () => {
    const blocks = slack.buildReportBlocks({
      ...SAMPLE,
      githubAppInstalled: true,
      autofixEnabled: true,
    })
    const actions = (blocks[3] as { elements: Array<{ text: { text: string }; action_id?: string }> }).elements
    expect(actions.map((a) => a.text.text)).toEqual([
      'Triage →',
      'Dispatch fix',
      'Resolve ✓',
      'Dismiss',
    ])
    expect(actions[2].action_id).toBe(`resolve_report:${SAMPLE.reportId}`)
    expect(actions[3].action_id).toBe(`dismiss_report:${SAMPLE.reportId}`)
  })

  it('scopes the Triage deep link to the project when projectId is present', () => {
    const blocks = slack.buildReportBlocks({ ...SAMPLE, projectId: 'proj-uuid-1234' })
    const actions = (blocks[3] as { elements: Array<{ url?: string }> }).elements
    expect(actions[0].url).toBe(
      `https://kensaur.us/mushi-mushi/admin/reports/${SAMPLE.reportId}?project=proj-uuid-1234`,
    )
  })

  it('leads with the plain-language title and keeps the technical summary as the second line', () => {
    const blocks = slack.buildReportBlocks({
      ...SAMPLE,
      title: 'Profit & loss tab crashes when opened',
      rootCause: 'currentPath is referenced before initialization in the tab handler',
    })
    const section = (blocks[1] as { text: { text: string } }).text.text
    const [first, second, third] = section.split('\n')
    expect(first).toBe('*Profit & loss tab crashes when opened*')
    expect(second).toContain('ReferenceError: currentPath')
    expect(third).toContain(':mag: currentPath is referenced before initialization')
  })

  it('adds an evidence context row only when there is evidence', () => {
    const bare = slack.buildReportBlocks(SAMPLE)
    expect(blockTypes(bare)).toEqual(['header', 'section', 'context', 'actions', 'context'])

    const rich = slack.buildReportBlocks({
      ...SAMPLE,
      consoleErrorCount: 3,
      failedRequestCount: 1,
      reproStepsCount: 4,
      sdkPackage: '@mushi-mushi/react',
      sdkVersion: '2.1.0',
    })
    expect(blockTypes(rich)).toEqual(['header', 'section', 'context', 'context', 'actions', 'context'])
    const evidence = (rich[3] as { elements: Array<{ text: string }> }).elements[0].text
    expect(evidence).toContain(':x: 3 console errors')
    expect(evidence).toContain(':no_entry: 1 failed request')
    expect(evidence).toContain(':footprints: 4-step repro')
    expect(evidence).toContain('@mushi-mushi/react@2.1.0')
  })

  it('renders the area chip ahead of the component', () => {
    const blocks = slack.buildReportBlocks({ ...SAMPLE, area: 'Reports' })
    const meta = (blocks[2] as { elements: Array<{ text: string }> }).elements[0].text
    expect(meta.indexOf(':round_pushpin: Reports')).toBeGreaterThanOrEqual(0)
    expect(meta.indexOf(':round_pushpin:')).toBeLessThan(meta.indexOf(':file_folder:'))
  })
})

describe('buildReportFallbackText', () => {
  it('omits summary to avoid duplicating block content', () => {
    const text = slack.buildReportFallbackText(SAMPLE)
    expect(text).toBe('⚠️ Medium bug · solo-boss-cloud')
    expect(text).not.toContain('ReferenceError')
  })
})
