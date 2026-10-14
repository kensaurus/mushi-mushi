import { describe, expect, it } from 'vitest'
import { connectionFromProbe, humanizeProbeMessage, sentryConnection, isMissingSentrySecret } from './integrationConnection'

const NOW = Date.parse('2026-10-04T01:00:00Z')
const RECENT = '2026-10-04T00:49:06Z'
const ok = { status: 'ok' as const, message: 'HTTP 200', checked_at: RECENT }

describe('humanizeProbeMessage', () => {
  it('drops messages that only say it worked', () => {
    expect(humanizeProbeMessage('HTTP 200')).toBeNull()
    expect(humanizeProbeMessage('Credential validated (HTTP 201)')).toBeNull()
  })

  it('turns an HTTP status plus JSON body into a sentence', () => {
    // The real glot.it OpenAI probe row on 2026-10-04.
    const raw =
      'HTTP 400 — {\n  "error": {\n    "message": "Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.",\n    "type": "invalid'
    const text = humanizeProbeMessage(raw)!
    expect(text.startsWith('The service rejected the request: Unsupported parameter')).toBe(true)
    expect(text).not.toContain('{')
  })

  it('keeps an already human message', () => {
    expect(humanizeProbeMessage('API key invalid or revoked. Generate a new key at console.anthropic.com.')).toBe(
      'API key invalid or revoked. Generate a new key at console.anthropic.com.',
    )
    expect(humanizeProbeMessage('HTTP 401')).toBe('The credentials were rejected.')
  })
})

describe('connectionFromProbe', () => {
  it('saved credentials alone are "not checked yet", never working', () => {
    expect(connectionFromProbe({ configured: true, probe: undefined, now: NOW }).state).toBe('checking')
  })

  it('a recent passing probe is working', () => {
    expect(connectionFromProbe({ configured: true, probe: ok, now: NOW }).state).toBe('working')
  })

  it('a failing probe needs attention and says why in words', () => {
    const v = connectionFromProbe({
      configured: true,
      probe: { status: 'down', message: 'API key invalid or revoked.', checked_at: RECENT },
      now: NOW,
    })
    expect(v.state).toBe('attention')
    expect(v.detail).toBe('API key invalid or revoked.')
  })

  it('not configured is not connected', () => {
    expect(connectionFromProbe({ configured: false, probe: ok, now: NOW }).state).toBe('not_connected')
  })
})

describe('sentryConnection (finding B25)', () => {
  it('a passing API probe with no inbound event is waiting, not healthy', () => {
    const v = sentryConnection({ configured: true, probe: ok, latestDelivery: null, deliveriesLoaded: true, now: NOW })
    expect(v.state).toBe('attention')
    expect(v.detail).toMatch(/^Connected — waiting for the first event/)
  })

  it('with automatic import on, says it is importing instead of demanding a webhook', () => {
    const v = sentryConnection({
      configured: true,
      probe: ok,
      latestDelivery: null,
      deliveriesLoaded: true,
      autoImport: { enabled: true, lastRunAt: RECENT },
      now: NOW,
    })
    // Still attention: the server banner counts only alerts, and the two must agree.
    expect(v.state).toBe('attention')
    expect(v.detail).toMatch(/^Connected — importing new Sentry issues automatically \(last run/)
  })

  it('an accepted event makes it working; a rejected one needs attention', () => {
    expect(
      sentryConnection({
        configured: true,
        probe: ok,
        latestDelivery: { outcome: 'accepted', created_at: RECENT, error_message: null },
        deliveriesLoaded: true,
        now: NOW,
      }).state,
    ).toBe('working')
    expect(
      sentryConnection({
        configured: true,
        probe: ok,
        latestDelivery: { outcome: 'rejected', created_at: RECENT, error_message: 'bad signature' },
        deliveriesLoaded: true,
        now: NOW,
      }).state,
    ).toBe('attention')
  })

  it('a failed deliveries request says so instead of checking forever', () => {
    const v = sentryConnection({
      configured: true,
      probe: ok,
      latestDelivery: undefined,
      deliveriesLoaded: false,
      deliveriesFailed: true,
      now: NOW,
    })
    expect(v.state).toBe('checking')
    expect(v.detail).toMatch(/^Couldn't check/)
  })

  it('a failing API probe wins over deliveries', () => {
    expect(
      sentryConnection({
        configured: true,
        probe: { status: 'down', message: 'HTTP 401', checked_at: RECENT },
        latestDelivery: { outcome: 'accepted', created_at: RECENT, error_message: null },
        deliveriesLoaded: true,
        now: NOW,
      }).detail,
    ).toBe('The credentials were rejected.')
  })
})

describe('isMissingSentrySecret', () => {
  it('spots alerts dropped for want of a webhook secret (glot.it, 2026-10-14)', () => {
    expect(isMissingSentrySecret({ outcome: 'error', created_at: RECENT, error_message: 'Sentry webhook secret not configured for this project' })).toBe(true)
  })
  it('ignores accepted deliveries, other rejections and no delivery', () => {
    expect(isMissingSentrySecret({ outcome: 'accepted', created_at: RECENT, error_message: null })).toBe(false)
    expect(isMissingSentrySecret({ outcome: 'rejected_signature', created_at: RECENT, error_message: 'Invalid signature' })).toBe(false)
    expect(isMissingSentrySecret(null)).toBe(false)
  })
})
