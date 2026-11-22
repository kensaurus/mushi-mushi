/**
 * FILE: ops-forward.test.ts
 * PURPOSE: `api` hands Sentry outcomes to the Ops hub through api-ext
 *          (_shared/ops-forward.ts) instead of bundling the emitter: only
 *          error / fatal outcomes and resolves make the hop, with the service
 *          role, and a failed hop never throws into Sentry intake. sentry-ingest
 *          must not import the emitter itself (api's deploy size limit).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { forwardSentryOps, OPS_SENTRY_PATH, shouldForwardSentry } from '../../supabase/functions/_shared/ops-forward.ts'

const g = globalThis as { Deno?: unknown }
afterEach(() => {
  delete g.Deno
})

describe('forwardSentryOps', () => {
  it('forwards only what can reach #alerts', () => {
    expect(shouldForwardSentry({ outcome: 'created', issueId: '1', title: 'x', level: 'error' })).toBe(true)
    expect(shouldForwardSentry({ outcome: 'reopened', issueId: '1', title: 'x', level: 'fatal' })).toBe(true)
    expect(shouldForwardSentry({ outcome: 'resolved', issueId: '1', title: null })).toBe(true)
    expect(shouldForwardSentry({ outcome: 'created', issueId: '1', title: 'x', level: 'warning' })).toBe(false)
    expect(shouldForwardSentry({ outcome: 'created', issueId: null, title: 'x', level: 'error' })).toBe(false)
  })

  it('posts to api-ext with the service role, and swallows a failed hop', async () => {
    g.Deno = { env: { get: (k: string) => ({ SUPABASE_URL: 'https://proj.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] } }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 202 })
    }) as unknown as typeof fetch
    await forwardSentryOps('p1', { outcome: 'created', issueId: '42', title: 'TypeError', level: 'error' }, ok)
    expect(calls[0].url).toBe('https://proj.supabase.co/functions/v1/api-ext/v1/internal/ops/sentry')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer srk')
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ projectId: 'p1', sentry: { issueId: '42' } })
    const boom = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    await expect(forwardSentryOps('p1', { outcome: 'resolved', issueId: '42', title: null }, boom)).resolves.toBeUndefined()
  })

  it('targets the path api-ext registers', () => {
    const ops = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/ops.ts'), 'utf8')
    expect(ops).toContain(`app.post('${OPS_SENTRY_PATH}',`)
  })

  it('sentry-ingest uses the forward, not the emitter', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/sentry-ingest.ts'), 'utf8')
    expect(src).toContain("from './ops-forward.ts'")
    expect(src).not.toMatch(/ops-(events|sources|format|slack)\.ts/)
  })
})
