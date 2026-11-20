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

function labels(blocks: unknown[]): string[] {
  const actions = blocks.find((b) => (b as { type: string }).type === 'actions') as { elements: Array<Record<string, any>> }
  return actions.elements.map((el) => (el.type === 'overflow' ? `⋯[${el.options.map((o: any) => o.text.text).join(', ')}]` : el.text.text))
}

const meta = (blocks: unknown[]) => (blocks[2] as { elements: Array<{ text: string }> }).elements[0].text

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

  it('shows Triage / Install GitHub App / Resolve, Dismiss in the ⋯ menu, when dispatch is unavailable', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    // Slack refuses a one-option menu, so the menu also links the report.
    expect(labels(blocks)).toEqual(['Triage →', 'Install GitHub App', 'Resolve ✓', '⋯[Dismiss…, Open in Mushi Mushi]'])
    expect((blocks[3] as { elements: Array<{ style?: string }> }).elements[0].style).toBe('primary')
  })

  it('shows Dispatch fix plus Resolve/Dismiss when configured', () => {
    const blocks = slack.buildReportBlocks({
      ...SAMPLE,
      githubAppInstalled: true,
      autofixEnabled: true,
    })
    const actions = (blocks[3] as { elements: Array<Record<string, any>> }).elements
    expect(labels(blocks)).toEqual(['Triage →', 'Dispatch fix', 'Resolve ✓', '⋯[Dismiss…, Open in Mushi Mushi]'])
    expect(actions[2].action_id).toBe(`resolve_report:${SAMPLE.reportId}`)
    expect(actions[3]).toMatchObject({ type: 'overflow', action_id: `report_more:${SAMPLE.reportId}` })
    expect(actions[3].options[0].value).toBe(`dismiss_report_ask:${SAMPLE.reportId}`)
    // Three buttons at most; everything else is in the menu.
    expect(actions.filter((a) => a.type === 'button')).toHaveLength(3)
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

describe('buildReportBlocks — Reply to reporter (Plan 018 §3)', () => {
  // Button action ids and ⋯ menu option values.
  const actionIds = (blocks: unknown[]) =>
    ((blocks.find((b) => (b as { type: string }).type === 'actions') as { elements: Array<{ action_id: string; options?: Array<{ value: string }> }> }).elements).flatMap(
      (e) => (e.options ? e.options.map((o) => o.value) : [e.action_id]),
    )

  it('offers it in the ⋯ menu for a report filed through the SDK widget', () => {
    const blocks = slack.buildReportBlocks({ ...SAMPLE, reporterToken: `rk1_${'a'.repeat(64)}` })
    expect(actionIds(blocks)).toContain(`reply_reporter:${SAMPLE.reportId}`)
    expect(labels(blocks)).toEqual(['Triage →', 'Install GitHub App', 'Resolve ✓', '⋯[Reply to reporter, Dismiss…]'])
  })

  it('hides it when nobody could read a reply (Sentry, cron, voice sentinels)', () => {
    for (const reporterToken of ['sentry-webhook', 'cron:library-modernizer', 'voice-intake', 'reporter-hash-token']) {
      expect(actionIds(slack.buildReportBlocks({ ...SAMPLE, reporterToken }))).not.toContain(`reply_reporter:${SAMPLE.reportId}`)
    }
  })
})

describe('bug card: one heading, masked reporter, full package names (2026-11-20)', () => {
  it('names only the project owner; anyone else by initials or "a user"; anonymous stays anonymous', () => {
    expect(slack.reporterLabel({ reporterToken: 'x', reporterDisplayName: 'Kenji Sakuramoto', reporterIsOwner: true })).toBe('kenji (owner)')
    expect(slack.reporterLabel({ reporterToken: 'x', reporterDisplayName: 'Jane Q Public', reporterIsOwner: false })).toBe('J. Q. P.')
    expect(slack.reporterLabel({ reporterToken: 'x', reporterDisplayName: '🙂', reporterIsOwner: false })).toBe('a user')
    expect(slack.reporterLabel({ reporterToken: 'reporter-hash-token', reporterDisplayName: null })).toBe('anonymous')
    expect(slack.reporterLabel({ reporterToken: 'sentry-webhook', reporterDisplayName: null })).toBe('Sentry')
    const card = JSON.stringify(slack.buildReportBlocks(SAMPLE))
    expect(card).not.toContain('Kenji Sakuramoto')
    expect(meta(slack.buildReportBlocks(SAMPLE))).toContain(':bust_in_silhouette: Reporter: K. S.')
  })

  it('never cuts the release or the package into "sentry-w…"', () => {
    const blocks = slack.buildReportBlocks({ ...SAMPLE, reporterToken: 'sentry-webhook', sentryRelease: 'sentry-webhook-glot-it@1.115.0+build.42', sdkPackage: '@mushi-mushi/react-native', sdkVersion: '1.37.2' })
    const json = JSON.stringify(blocks)
    expect(json).toContain('sentry-webhook-glot-it@1.115.0+build.42')
    expect(json).toContain('@mushi-mushi/react-native@1.37.2')
    expect(json).toContain('Reporter: Sentry')
    expect(json).not.toContain('sentry-w…')
  })

  it('the heading is the header block only; the top-level text is the short fallback', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    expect(blocks.filter((b) => (b as { type: string }).type === 'header')).toHaveLength(1)
    expect(slack.buildReportFallbackText(SAMPLE)).toBe('⚠️ Medium bug · solo-boss-cloud')
  })

  it('posts top-level blocks, never a legacy attachment (the attachment showed the text as a second heading)', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test' // check-no-secrets: ignore-line — fixture
    const sent: Array<Record<string, unknown>> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({ ok: true, ts: '1.1' }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      await slack.sendReportNotification(SAMPLE, { channelId: 'C1' })
    } finally {
      globalThis.fetch = realFetch
    }
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toHaveProperty('attachments')
    expect(Array.isArray(sent[0].blocks)).toBe(true)
    expect(sent[0].text).toBe('⚠️ Medium bug · solo-boss-cloud')
  })
})
