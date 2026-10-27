/**
 * The connection grid at the top of Integrations shows each card's own
 * verdict. Sentry's tile reads the same shared verdict as Settings → General
 * (e469ff36), so the two pages can't disagree; "not connected" is never
 * counted as broken.
 */

import { describe, expect, it } from 'vitest'
import { brokenConnections, buildConnectionGrid, connectionGridSentence, type ConnectionGridInput } from './connectionGrid'
import { sentryConnectionFromPageData } from '../../lib/useSentryConnection'
import type { HealthRow, PlatformResponse } from './types'

const NOW = Date.parse('2026-10-27T12:00:00Z')
const RECENT = '2026-10-27T11:50:00Z'

const probe = (kind: string, status: HealthRow['status'] = 'ok', message: string | null = 'HTTP 200'): HealthRow => ({
  id: `h-${kind}`,
  kind,
  status,
  latency_ms: 40,
  message,
  source: 'cron',
  checked_at: RECENT,
})

const platform: PlatformResponse = {
  platform: {
    sentry: { sentry_org_slug: 'acme', sentry_auth_token_ref: 'ref', sentry_auto_import: true, sentry_auto_import_last_at: RECENT },
    github: { github_repo_url: 'https://github.com/acme/app', github_installation_token_ref: 'ref' },
  },
  sourceByField: { sentry_org_slug: 'project', sentry_auth_token_ref: 'project' },
}

function input(over: Partial<ConnectionGridInput> = {}): ConnectionGridInput {
  return {
    platform,
    history: [probe('sentry'), probe('github')],
    sentryDeliveries: [],
    slack: { configured: false, canPost: false, channelId: null },
    linearConnected: false,
    now: NOW,
    ...over,
  }
}

describe('buildConnectionGrid', () => {
  it('lists the six tools in a fixed order', () => {
    expect(buildConnectionGrid(input()).map((t) => t.id)).toEqual(['sentry', 'github', 'slack', 'langfuse', 'cursor_cloud', 'linear'])
  })

  it('shows Claude Code only once it is set up, so a failing agent is never hidden from the grid', () => {
    const withClaude: PlatformResponse = { ...platform, platform: { ...platform.platform, claude_code_agent: { claude_api_key_ref: 'ref' } } }
    const tiles = buildConnectionGrid(input({ platform: withClaude, history: [probe('sentry'), probe('github'), probe('claude_code_agent', 'down', 'HTTP 401')] }))
    expect(tiles.map((t) => t.id)).toContain('claude_code_agent')
    expect(brokenConnections(tiles).map((t) => t.id)).toEqual(['claude_code_agent'])
  })

  it("Sentry's tile is the verdict Settings → General reads, from the same inputs (e469ff36)", () => {
    const tile = buildConnectionGrid(input()).find((t) => t.id === 'sentry')!
    const shared = sentryConnectionFromPageData({ platform, history: [probe('sentry'), probe('github')], deliveries: [], now: NOW })
    expect(tile.view).toEqual(shared)
    // Importing automatically is working, not "needs attention" over a missing webhook.
    expect(tile.view.state).toBe('working')
    expect(tile.lastLabel).toBe('Last import')
  })

  it('a configured tool with a failing check needs you; an unconfigured one does not', () => {
    const tiles = buildConnectionGrid(input({ history: [probe('sentry'), probe('github', 'down', 'HTTP 401 Bad credentials')] }))
    expect(brokenConnections(tiles).map((t) => t.id)).toEqual(['github'])
    expect(tiles.find((t) => t.id === 'langfuse')!.view.state).toBe('not_connected')
  })

  it('a Slack channel nothing can post to needs you, with the card’s words', () => {
    const tiles = buildConnectionGrid(input({ slack: { configured: true, canPost: false, channelId: 'C1' } }))
    const slack = tiles.find((t) => t.id === 'slack')!
    expect(slack.view).toEqual({ state: 'attention', detail: 'No Slack bot can post to this channel yet.' })
  })
})

describe('connectionGridSentence', () => {
  it('names the broken connections', () => {
    const tiles = buildConnectionGrid(
      input({
        history: [probe('sentry'), probe('github', 'down', 'HTTP 401')],
        slack: { configured: true, canPost: false, channelId: 'C1' },
      }),
    )
    expect(connectionGridSentence(tiles)).toEqual({ sentence: 'GitHub and Slack need you.', tone: 'warn' })
  })

  it('says all is well when every connected tool works', () => {
    expect(connectionGridSentence(buildConnectionGrid(input()))).toEqual({ sentence: '2 connected and working.', tone: 'ok' })
  })

  it('with nothing connected, points at GitHub first', () => {
    const empty = input({ platform: { platform: {} }, history: [] })
    expect(connectionGridSentence(buildConnectionGrid(empty)).sentence).toMatch(/^Nothing is connected yet/)
  })
})
