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
  process.env.ADMIN_BASE_URL = 'https://admin.mushimushi.dev'
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

  it('shows Triage and Install GitHub App when dispatch unavailable', () => {
    const blocks = slack.buildReportBlocks(SAMPLE)
    const actions = (blocks[3] as { elements: Array<{ text: { text: string }; style?: string }> }).elements
    expect(actions).toHaveLength(2)
    expect(actions[0].text.text).toBe('Triage →')
    expect(actions[0].style).toBe('primary')
    expect(actions[1].text.text).toBe('Install GitHub App')
  })

  it('shows Triage and Dispatch fix when configured', () => {
    const blocks = slack.buildReportBlocks({
      ...SAMPLE,
      githubAppInstalled: true,
      autofixEnabled: true,
    })
    const actions = (blocks[3] as { elements: Array<{ text: { text: string } }> }).elements
    expect(actions).toHaveLength(2)
    expect(actions[1].text.text).toBe('Dispatch fix')
  })
})

describe('buildReportFallbackText', () => {
  it('omits summary to avoid duplicating block content', () => {
    const text = slack.buildReportFallbackText(SAMPLE)
    expect(text).toBe('⚠️ Medium bug · solo-boss-cloud')
    expect(text).not.toContain('ReferenceError')
  })
})
