import { describe, expect, it } from 'vitest'
import {
  classifyPlatformConnection,
  deriveIntegrationSignals,
  freshestHeartbeat,
  type IntegrationSignalInput,
} from '../../supabase/functions/_shared/setup-signals.ts'

const NO_ENV = { githubToken: false, slackBotToken: false, slackChannelId: false }

function input(over: Partial<IntegrationSignalInput> = {}): IntegrationSignalInput {
  return {
    settings: null,
    org: null,
    repos: [],
    anthropicPoolKeys: [],
    env: NO_ENV,
    operatorProject: false,
    ...over,
  }
}

describe('deriveIntegrationSignals — Anthropic BYOK (finding A6)', () => {
  it('counts an active, verified key in the byok_keys pool when the legacy column is empty', () => {
    // glot.it on 2026-10-04: byok_keys has anthropic active/ok, the legacy
    // project_settings.byok_anthropic_key_ref is null. The checklist said
    // "Add your Anthropic key" while Settings showed the verified key.
    const s = deriveIntegrationSignals(
      input({ anthropicPoolKeys: [{ status: 'active', test_status: 'ok' }] }),
    )
    expect(s.hasByok).toBe(true)
  })

  it('does not count a pooled key that failed its test or is not active', () => {
    expect(
      deriveIntegrationSignals(
        input({
          anthropicPoolKeys: [
            { status: 'active', test_status: 'error' },
            { status: 'cooldown', test_status: 'ok' },
            { status: 'active', test_status: null },
          ],
        }),
      ).hasByok,
    ).toBe(false)
  })

  it('still honours the legacy column', () => {
    expect(
      deriveIntegrationSignals(input({ settings: { byok_anthropic_key_ref: 'vault://x' } })).hasByok,
    ).toBe(true)
  })
})

describe('deriveIntegrationSignals — GitHub', () => {
  it('needs a repo AND a credential, as the GitHub card does', () => {
    expect(
      deriveIntegrationSignals(input({ settings: { github_repo_url: 'https://github.com/a/b' } }))
        .hasGithub,
    ).toBe(false)
    expect(
      deriveIntegrationSignals(
        input({
          settings: {
            github_repo_url: 'https://github.com/a/b',
            github_installation_token_ref: 'vault://t',
          },
        }),
      ).hasGithub,
    ).toBe(true)
  })

  it('accepts org-default credentials and a GitHub App install on a repo row', () => {
    expect(
      deriveIntegrationSignals(
        input({
          org: { github_repo_url: 'https://github.com/a/b', github_installation_token_ref: 'vault://t' },
        }),
      ).hasGithub,
    ).toBe(true)
    expect(
      deriveIntegrationSignals(input({ repos: [{ github_app_installation_id: 42 }] })).hasGithub,
    ).toBe(true)
    expect(
      deriveIntegrationSignals(input({ repos: [{ github_app_installation_id: null }] })).hasGithub,
    ).toBe(false)
  })
})

describe('deriveIntegrationSignals — Sentry', () => {
  it('needs the org slug and the auth token, from the project or the org', () => {
    expect(deriveIntegrationSignals(input({ settings: { sentry_org_slug: 'acme' } })).hasSentry).toBe(false)
    expect(
      deriveIntegrationSignals(
        input({ settings: { sentry_org_slug: 'acme' }, org: { sentry_auth_token_ref: 'vault://s' } }),
      ).hasSentry,
    ).toBe(true)
  })
})

describe('deriveIntegrationSignals — Slack', () => {
  it('a channel id alone posts nowhere', () => {
    expect(deriveIntegrationSignals(input({ settings: { slack_channel_id: 'C1' } })).hasSlack).toBe(false)
  })

  it('a channel plus a bot token, or a webhook, can post', () => {
    expect(
      deriveIntegrationSignals(
        input({ settings: { slack_channel_id: 'C1', slack_bot_token_ref: 'vault://b' } }),
      ).hasSlack,
    ).toBe(true)
    expect(
      deriveIntegrationSignals(input({ settings: { slack_webhook_url: 'https://hooks.slack.com/x' } }))
        .hasSlack,
    ).toBe(true)
  })

  it('the operator env bot only backs operator-owned projects', () => {
    const env = { githubToken: false, slackBotToken: true, slackChannelId: false }
    const settings = { slack_channel_id: 'C1' }
    expect(deriveIntegrationSignals(input({ settings, env, operatorProject: true })).hasSlack).toBe(true)
    expect(deriveIntegrationSignals(input({ settings, env, operatorProject: false })).hasSlack).toBe(false)
  })
})

describe('freshestHeartbeat', () => {
  it('picks the latest instant across keys, not the first with a value', () => {
    const hb = freshestHeartbeat([
      { last_seen_at: '2026-06-18T10:00:00Z', last_seen_origin: 'old' },
      { last_seen_at: null },
      { last_seen_at: '2026-10-03 23:27:23.973+00', last_seen_origin: 'new' },
    ])
    expect(hb?.last_seen_origin).toBe('new')
  })

  it('returns null when no key has checked in', () => {
    expect(freshestHeartbeat([{ last_seen_at: null }])).toBeNull()
  })
})

describe('classifyPlatformConnection (finding B25)', () => {
  const NOW = Date.parse('2026-10-04T01:00:00Z')
  const recent = '2026-10-04T00:49:06Z'

  it('a passing Sentry API probe with no inbound event is not "healthy"', () => {
    // glot.it and mushi-mushi on 2026-10-04: sentry probe ok, zero rows in
    // webhook_audit_log for sentry. The card said "Healthy".
    expect(
      classifyPlatformConnection({
        probeStatus: 'ok',
        probeCheckedAt: recent,
        needsInbound: true,
        inboundAccepted: false,
        now: NOW,
      }),
    ).toBe('attention')
    expect(
      classifyPlatformConnection({
        probeStatus: 'ok',
        probeCheckedAt: recent,
        needsInbound: true,
        inboundAccepted: true,
        now: NOW,
      }),
    ).toBe('working')
  })

  it('failing probes are down; missing or week-old probes need a re-check', () => {
    expect(classifyPlatformConnection({ probeStatus: 'down', probeCheckedAt: recent, now: NOW })).toBe('down')
    expect(classifyPlatformConnection({ probeStatus: 'degraded', probeCheckedAt: recent, now: NOW })).toBe('down')
    expect(classifyPlatformConnection({ probeStatus: undefined, probeCheckedAt: undefined, now: NOW })).toBe('attention')
    expect(
      classifyPlatformConnection({ probeStatus: 'ok', probeCheckedAt: '2026-09-20T00:00:00Z', now: NOW }),
    ).toBe('attention')
    expect(classifyPlatformConnection({ probeStatus: 'ok', probeCheckedAt: recent, now: NOW })).toBe('working')
  })
})
