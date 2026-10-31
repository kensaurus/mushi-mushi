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
      'slack',
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

describe('manual probe route', () => {
  // Source-level: the Hono app is not booted under vitest.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { resolve } = require('node:path') as typeof import('node:path')
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/modernization-health-super.ts'), 'utf8')
  const route = src.slice(src.indexOf("app.post('/v1/admin/health/integration/:kind'"), src.indexOf("app.post('/v1/admin/health/integration/:kind'") + 2500)

  it('probes the project the console names, and refuses one the caller cannot read', () => {
    expect(route).toContain("c.req.header('X-Mushi-Project-Id')")
    expect(route).toContain('requested && !accessibleIds.includes(requested)')
    expect(route).toContain('const projectId = requested || accessibleIds[0]')
  })

  it('refuses to guess between several projects when none is named', () => {
    // accessibleIds is a Set union with no ORDER BY, so [0] is arbitrary.
    const guard = route.indexOf('if (!requested && accessibleIds.length > 1)')
    expect(guard).toBeGreaterThan(0)
    expect(route.slice(guard, guard + 250)).toContain("'PROJECT_REQUIRED'")
    expect(guard).toBeLessThan(route.indexOf('const projectId = requested || accessibleIds[0]'))
  })

  it('reads the Slack token column the Slack probe needs', () => {
    expect(route).toContain('slack_bot_token_ref')
  })
})

describe('hourly probe cron', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { resolve } = require('node:path') as typeof import('node:path')
  const cron = readFileSync(resolve(__dirname, '../../supabase/functions/integration-health-probe/index.ts'), 'utf8')

  it('probes Slack for projects with a bot token or a channel', () => {
    expect(cron).toContain("if (hasSlack(s)) tasks.push({ projectId: s.project_id, kind: 'slack'")
    expect(cron).toContain('slack_bot_token_ref, slack_channel_id')
  })

  it('looks settings up by project from a map, not a scan per routing row', () => {
    expect(cron).toContain('settingsByProject.get(r.project_id)')
    expect(cron).not.toMatch(/allSettings\.find\(\(s\) => s\.project_id === /)
  })
})

describe('fix agent probes test the key a fix would use (2026-10-30)', () => {
  it('Cursor and Claude Code probe the pooled key before the old per-app field', async () => {
    vi.resetModules()
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    vi.doMock('../../supabase/functions/_shared/byok.ts', () => ({
      resolveLlmKey: async (_db: unknown, _p: string, provider: string, opts: { purpose?: string }) => {
        expect(opts.purpose).toBe('probe')
        return { key: provider === 'cursor' ? 'pooled-cursor' : 'pooled-anthropic' }
      },
    }))
    vi.doMock('../../supabase/functions/_shared/settings-secrets.ts', () => ({ dereferenceMaybeVault: async () => 'dead-legacy-key' }))
    const { probeIntegration } = await import('../../supabase/functions/_shared/integration-probes.ts')
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers.Authorization ?? init.headers['x-api-key'])
      return new Response('{"userEmail":"k@example.com"}', { status: 200 })
    }))
    const cursor = await probeIntegration('cursor_cloud', {} as never, { cursor_api_key_ref: 'vault://old' } as never, {}, 'p1')
    const claude = await probeIntegration('claude_code_agent', {} as never, { claude_api_key_ref: 'vault://old' } as never, {}, 'p1')
    expect(cursor.status).toBe('ok')
    expect(claude.status).toBe('ok')
    expect(seen).toEqual(['Bearer pooled-cursor', 'pooled-anthropic'])
    vi.doUnmock('../../supabase/functions/_shared/byok.ts')
    vi.doUnmock('../../supabase/functions/_shared/settings-secrets.ts')
  })
})
