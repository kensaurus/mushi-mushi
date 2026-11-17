import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetchMutate: async () => ({ ok: true }) }))
vi.mock('../../lib/env', () => ({ RESOLVED_EXTERNAL_API_URL: 'https://proj.supabase.co/functions/v1/api' }))

const { slackBotStatus } = await import('./SlackBotCard')
const { opsKeySnippets } = await import('./OpsKeyRow')

const base = {
  enabled: true,
  teamId: 'T0TEAM',
  botUserId: 'U0BOT',
  botToken: true,
  signingSecret: true,
  webhooks: { payments: false, releases: false, alerts: false },
  channels: { payments: 'C1', releases: 'C2', alerts: null },
  command: '/kensaurus',
  iconBaseUrl: null,
  updatedAt: null,
  requestUrls: null,
  canEdit: true,
}

describe('Slack bot status', () => {
  it('says what is missing, with a shape', () => {
    expect(slackBotStatus(base)).toEqual({ glyph: '●', label: 'On · 2 of 3 channels', tone: 'ok' })
    expect(slackBotStatus({ ...base, botToken: false })).toMatchObject({ glyph: '○', label: 'Not connected' })
    expect(slackBotStatus({ ...base, signingSecret: false })).toMatchObject({ glyph: '▲', tone: 'warn' })
    expect(slackBotStatus({ ...base, channels: { payments: null, releases: null, alerts: null } })).toMatchObject({ label: 'Needs at least one channel' })
    expect(slackBotStatus({ ...base, enabled: false })).toMatchObject({ label: 'Saved, switched off' })
  })
})

describe('ops key snippets', () => {
  it('fill in the key and the API URL for a Supabase secret, a GitHub secret and one test event', () => {
    const s = opsKeySnippets('mushi_k', 'https://api.test/functions/v1/api')
    expect(s.map((x) => x.label)).toEqual(['Supabase Edge Function secrets', 'GitHub Actions secrets', 'Send one event (from your server)'])
    expect(s[0].text).toBe('supabase secrets set MUSHI_OPS_KEY=mushi_k MUSHI_API_URL=https://api.test/functions/v1/api')
    expect(s[1].text).toContain('gh secret set MUSHI_OPS_KEY --body "mushi_k"')
    expect(s[2].text).toContain('$MUSHI_API_URL/v1/ops/events')
  })
})
