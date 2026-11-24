/**
 * The connection grid at the top of Integrations shows each card's own
 * verdict. Sentry's tile reads the same shared verdict as Settings → General
 * (e469ff36), so the two pages can't disagree; "not connected" is never
 * counted as broken.
 */

import { describe, expect, it } from 'vitest'
import { alertChannelGap, brokenConnections, buildConnectionGrid, connectionGridSentence, type ConnectionGridInput } from './connectionGridModel'
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
  // The row led with Sentry, a monitoring tool we never require (AGENTS.md;
  // first-time user test, 2026-10-28). GitHub and alerts lead; Sentry is last.
  // The tiles are the page (owner, 2026-11-18): every tool has one, set up or
  // not, so Teams, Claude Code, the issue trackers and Langfuse stay reachable.
  it('lists every tool in a fixed order, GitHub first and monitoring last', () => {
    expect(buildConnectionGrid(input()).map((t) => t.id)).toEqual([
      'github', 'slack', 'discord', 'teams', 'cursor_cloud', 'claude_code_agent',
      'linear', 'jira', 'github_issues', 'pagerduty', 'sentry', 'langfuse',
    ])
  })

  it('a paused issue tracker needs you; a saved one reads its check', () => {
    const tiles = buildConnectionGrid(
      input({
        routing: [
          { integration_type: 'jira', is_active: false },
          { integration_type: 'github', is_active: true },
        ],
        history: [probe('sentry'), probe('github'), probe('github_issues')],
      }),
    )
    const byId = Object.fromEntries(tiles.map((t) => [t.id, t]))
    expect(byId.jira.view).toMatchObject({ state: 'attention', label: 'Paused' })
    expect(byId.github_issues.view.state).toBe('working')
    expect(byId.pagerduty.view.state).toBe('not_connected')
    expect(brokenConnections(tiles).map((t) => t.id)).toEqual(['jira'])
  })

  // Mushi's own Langfuse (set in its environment) counted as one of the user's
  // connections: a new app read "2 connected" with nothing connected
  // (integrator's new-user walk, 2026-10-28).
  it("reads Mushi's own Langfuse as not connected and counts the user's", () => {
    const viaEnv: PlatformResponse = {
      platform: { langfuse: { langfuse_host: 'https://us.cloud.langfuse.com', langfuse_public_key_ref: 'ref', langfuse_secret_key_ref: 'ref' } },
      sourceByField: { langfuse_host: 'env', langfuse_public_key_ref: 'env', langfuse_secret_key_ref: 'env' },
    }
    const envTiles = buildConnectionGrid(input({ platform: viaEnv, history: [probe('langfuse')] }))
    expect(envTiles.find((t) => t.id === 'langfuse')?.view.state).toBe('not_connected')
    expect(connectionGridSentence(envTiles).sentence).toMatch(/^Nothing is connected yet/)

    const own: PlatformResponse = { ...viaEnv, sourceByField: { langfuse_host: 'project', langfuse_public_key_ref: 'project', langfuse_secret_key_ref: 'project' } }
    expect(buildConnectionGrid(input({ platform: own, history: [probe('langfuse')] })).find((t) => t.id === 'langfuse')?.view.state).toBe('working')
  })

  it('a failing Claude Code agent is never hidden from the grid', () => {
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
    expect(tile.lastLabel).toBe('Imported')
  })

  it('a configured tool with a failing check needs you; an unconfigured one does not', () => {
    const tiles = buildConnectionGrid(input({ history: [probe('sentry'), probe('github', 'down', 'HTTP 401 Bad credentials')] }))
    expect(brokenConnections(tiles).map((t) => t.id)).toEqual(['github'])
    expect(tiles.find((t) => t.id === 'cursor_cloud')!.view.state).toBe('not_connected')
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

  // One tool set up and never tested read "1 connected, 1 not tested yet"
  // beside tiles that showed nothing connected (integrator, 2026-10-28).
  it('counts a tool that is set up but not tested once', () => {
    expect(connectionGridSentence(buildConnectionGrid(input({ history: [probe('sentry')] })))).toEqual({
      sentence: '1 connected and working, 1 not checked yet.',
      tone: 'neutral',
    })
    expect(connectionGridSentence(buildConnectionGrid(input({ history: [] })))).toEqual({
      sentence: '2 connected, not checked yet.',
      tone: 'neutral',
    })
  })

  // Connecting only Discord read "Nothing is connected yet. Start with GitHub"
  // beside a Discord card saying Connected (first-time user test, 2026-10-28).
  it('counts an alert channel that is only Discord or Teams', () => {
    const only = input({ platform: { platform: {} }, history: [], discordConfigured: true, teamsConfigured: true })
    const tiles = buildConnectionGrid(only)
    expect(tiles.map((t) => t.id)).toEqual(expect.arrayContaining(['discord', 'teams']))
    expect(connectionGridSentence(tiles).sentence).toBe('2 connected, not checked yet.')
    // Their only test posts a message, so they get no one-press check.
    for (const id of ['discord', 'teams']) {
      const tile = tiles.find((t) => t.id === id)!
      expect(tile).toMatchObject({ neverChecked: true, checkKind: null, view: { label: 'Connected · not checked yet' } })
    }
  })

  it('with nothing connected, points at GitHub first', () => {
    const empty = input({ platform: { platform: {} }, history: [] })
    expect(connectionGridSentence(buildConnectionGrid(empty)).sentence).toMatch(/^Nothing is connected yet/)
  })

  it('Slack reads as checking, never "not connected", until its settings arrive (2026-10-31)', () => {
    const slack = buildConnectionGrid(input({ slack: { configured: null, canPost: false, channelId: null } })).find((t) => t.id === 'slack')!
    expect(slack.view.state).toBe('checking')
    expect(slack.view.detail).toBe('Reading your Slack settings…')
  })
})

describe('the GitHub tile follows the app binding the GitHub card uses', () => {
  // Owner, 2026-11-17 (kensaur.us): the App was given access and the card said
  // "Connected", but the tile read only the token form and said "Not
  // connected", and the page counted "1 connected and working" while GitHub
  // and Claude Code both worked.
  const appOnly: PlatformResponse = {
    platform: {
      github: { github_repo_url: 'https://github.com/kensaurus/kensaur.us', github_installation_token_ref: null },
      claude_code_agent: { claude_api_key_ref: 'ref' },
    },
    sourceByField: {},
  }
  const github = (tiles: ReturnType<typeof buildConnectionGrid>) => tiles.find((t) => t.id === 'github')!

  it('an App install with no token reads connected, and the count agrees with the tiles', () => {
    const tiles = buildConnectionGrid(
      input({
        platform: appOnly,
        history: [probe('claude_code_agent'), probe('github')],
        github: { state: 'connected', repo: 'kensaurus/kensaur.us' },
      }),
    )
    expect(github(tiles).view.state).not.toBe('not_connected')
    const counted = tiles.filter((t) => t.view.state !== 'not_connected').map((t) => t.id)
    expect(counted).toEqual(expect.arrayContaining(['github', 'claude_code_agent']))
    expect(connectionGridSentence(tiles).sentence).toBe('2 connected and working.')
  })

  it('a linked repo the App cannot reach is amber with the plain reason, never "Not connected"', () => {
    const tile = github(buildConnectionGrid(input({ platform: appOnly, github: { state: 'repo_no_access', repo: 'kensaurus/kensaur.us' } })))
    expect(tile.view).toMatchObject({ state: 'attention', label: 'Repo linked · app access missing' })
    expect(tile.view.detail).toBe("Mushi Mushi can't read this repo yet: give the Mushi Mushi GitHub App access to kensaurus/kensaur.us.")
  })

  // Owner, 2026-11-18: the tile read "Not tested yet · Nothing yet" beside a
  // drawer saying "Connected: kensaurus/kensaur.us".
  it('a connected repo nobody has checked reads connected, not checked yet, with a check to run', () => {
    const tile = github(buildConnectionGrid(input({ platform: appOnly, history: [], github: { state: 'connected', repo: 'kensaurus/kensaur.us' } })))
    expect(tile).toMatchObject({ neverChecked: true, checkKind: 'github', view: { state: 'checking', label: 'Connected · not checked yet' } })
    // Once a check has run, the tile reads its result instead.
    const checked = github(buildConnectionGrid(input({ platform: appOnly, history: [probe('github')], github: { state: 'connected', repo: 'kensaurus/kensaur.us' } })))
    expect(checked.neverChecked).toBeUndefined()
    expect(checked.view.state).toBe('working')
  })

  it('still-loading states never read as connected', () => {
    const slack = buildConnectionGrid(input({ slack: { configured: null, canPost: false, channelId: null } })).find((t) => t.id === 'slack')!
    expect(slack.neverChecked).toBeUndefined()
    expect(slack.view.label).toBeUndefined()
    const sentry = buildConnectionGrid(input({ sentryDeliveries: null })).find((t) => t.id === 'sentry')!
    expect(sentry.neverChecked).toBeUndefined()
    expect(sentry.view.label).not.toBe('Connected · not checked yet')
  })

  it('every never-checked tool with a read-only check names it', () => {
    const tiles = buildConnectionGrid(
      input({
        history: [],
        slack: { configured: true, canPost: true, channelId: 'C1' },
        linearConnected: true,
        routing: [{ integration_type: 'jira', is_active: true }],
      }),
    )
    const unchecked = Object.fromEntries(tiles.filter((t) => t.neverChecked).map((t) => [t.id, t.checkKind]))
    expect(unchecked).toMatchObject({ github: 'github', slack: 'slack', linear: 'linear', jira: 'jira' })
  })

  it('no repo reads not connected; without the status yet it falls back to the token form', () => {
    expect(github(buildConnectionGrid(input({ github: { state: 'not_connected', repo: null } }))).view.state).toBe('not_connected')
    expect(github(buildConnectionGrid(input({ github: null }))).view.state).toBe('working')
  })
})

describe('alertChannelGap', () => {
  it('is a gap only when events are on and Slack, Discord and Teams are all not connected', () => {
    const none = buildConnectionGrid(input())
    expect(alertChannelGap(none, 8)).toBe(true)
    expect(alertChannelGap(none, 0)).toBe(false)
    // Prefs still loading: unknown is never a gap.
    expect(alertChannelGap(none, null)).toBe(false)
    expect(alertChannelGap(buildConnectionGrid(input({ discordConfigured: true })), 8)).toBe(false)
    // Slack settings still loading read as present, so the gap never flashes.
    expect(alertChannelGap(buildConnectionGrid(input({ slack: { configured: null, canPost: false, channelId: null } })), 8)).toBe(false)
  })
})
