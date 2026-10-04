/**
 * FILE: packages/server/src/__tests__/integration-probe-kinds.test.ts
 * PURPOSE: Every routing and ticket card on /integrations/config has a kind
 *          the manual probe route accepts.
 *
 * Why (2026-10-04, QA entry 36): ALL_INTEGRATION_KINDS left out 'linear' and
 * 'vercel', so Test on those cards always got a bare BAD_KIND and no health
 * row was ever written. Vercel had no probe at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: () => undefined } })
  return import('../../supabase/functions/_shared/integration-probes.ts')
}

afterEach(() => vi.unstubAllGlobals())

describe('ALL_INTEGRATION_KINDS', () => {
  it('includes the console card kinds: platform, fix agent, Linear, routing, Vercel', async () => {
    const { ALL_INTEGRATION_KINDS } = await load()
    for (const kind of [
      'sentry',
      'langfuse',
      'github',
      'cursor_cloud',
      'claude_code_agent',
      'linear',
      'jira',
      'github_issues',
      'pagerduty',
      'vercel',
    ]) {
      expect(ALL_INTEGRATION_KINDS).toContain(kind)
    }
  })
})

describe('vercel probe', () => {
  it('says what is missing instead of failing when no token is saved', async () => {
    const { probeIntegration } = await load()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await probeIntegration('vercel', {} as never, {}, { project_slug: 'shop' })
    expect(r.status).toBe('unknown')
    expect(r.detail).toMatch(/access token/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads a valid token as ok and a rejected one as down', async () => {
    const { probeIntegration } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect((await probeIntegration('vercel', {} as never, {}, { project_slug: 'shop', access_token: 't' })).status).toBe('ok')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    expect((await probeIntegration('vercel', {} as never, {}, { project_slug: 'shop', access_token: 't' })).status).toBe('down')
  })

  it('names the project when Vercel cannot find it', async () => {
    const { probeIntegration } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const r = await probeIntegration('vercel', {} as never, {}, { project_slug: 'shop', team_slug: 'acme', access_token: 't' })
    expect(r.status).toBe('degraded')
    expect(r.detail).toMatch(/"shop"/)
  })
})
