/**
 * Static contract for the voice inbox surface (plan C1/C3). Hono is a stubbed
 * `npm:` specifier under vitest, so the route module cannot be executed here;
 * this mirrors `route-auth-contract.test.ts` and pins the security-relevant
 * shape of the source instead:
 *
 *   - every mutating voice route is behind `adminOrApiKey({ scope: 'voice:write' })`
 *   - reporter HMAC headers are rejected up front (403)
 *   - the `voice:write` scope is mintable (project-keys allow-list) and
 *     storable (migration CHECK) and typed (auth.ts scope union)
 *   - `withIdempotency` wraps the intake POST
 *   - the retention sweep knows the voice table + bucket
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const MIGRATIONS = resolve(__dirname, '../../supabase/migrations')

const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

describe('intake-voice route contract', () => {
  const src = read('api/routes/intake-voice.ts')

  it('exports registerIntakeVoiceRoutes', () => {
    expect(src).toMatch(/export function registerIntakeVoiceRoutes\(/)
  })

  it('guards every mutating route with the narrow voice:write scope', () => {
    const mutating = [
      "app.post('/v1/intake/voice',",
      "app.post('/v1/intake/voice/upload-url',",
      "app.post('/v1/intake/voice/:id/confirm',",
      "app.post('/v1/intake/voice/:id/cancel',",
    ]
    for (const route of mutating) {
      const idx = src.indexOf(route)
      expect(idx, `${route} missing`).toBeGreaterThan(-1)
      const line = src.slice(idx, src.indexOf('\n', idx))
      expect(line, `${route} must use adminOrApiKey({ scope: 'voice:write' })`).toContain("adminOrApiKey({ scope: 'voice:write' })")
    }
  })

  it('rejects reporter HMAC headers with 403 before any work', () => {
    expect(src).toContain("c.req.header('X-Reporter-Token')")
    expect(src).toContain("c.req.header('X-Reporter-Token-Hash')")
    expect(src).toMatch(/jsonError\(c, 'FORBIDDEN', 'Reporter tokens cannot use voice intake[^']*', 403\)/)
    // Every mutating handler calls the guard.
    expect(src.match(/rejectReporterHeaders\(c\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  it('wraps the intake POST in withIdempotency and applies the ingest burst limiter', () => {
    const start = src.indexOf("app.post('/v1/intake/voice',")
    const end = src.indexOf("app.post('/v1/intake/voice/upload-url'")
    const body = src.slice(start, end)
    expect(body).toContain('withIdempotency(c, async () =>')
    expect(body).toContain("db.rpc('report_ingest_rate_limit_claim'")
    expect(body).toContain('classifyIngestRateLimitError(rateErr)')
  })

  it('never lets audio_path escape the caller project folder', () => {
    expect(src).toContain('body.audio_path.startsWith(`${projectId}/`)')
  })

  it('never selects the confirm token hash or raw channel for API readers', () => {
    const cols = src.match(/const SESSION_COLUMNS =\s*([\s\S]*?)\n\n/)?.[1] ?? ''
    expect(cols).not.toContain('confirm_token_hash')
    expect(cols).not.toContain('channel')
  })
})

describe('voice:write scope plumbing', () => {
  it('is in the API-key mint allow-list', () => {
    expect(read('api/routes/project-keys.ts')).toMatch(/ALLOWED_KEY_SCOPES = \[[^\]]*'voice:write'[^\]]*\]/)
  })

  it('is part of the auth scope union', () => {
    expect(read('_shared/auth.ts')).toMatch(/export type McpScope = [^\n]*'voice:write'/)
  })

  it('is allowed by the project_api_keys CHECK constraint migration', () => {
    const sql = readFileSync(resolve(MIGRATIONS, '20260912001000_voice_scope_settings_reports.sql'), 'utf8')
    expect(sql).toMatch(/scopes <@ array\[[^\]]*'voice:write'[^\]]*\]/)
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid')
  })
})

describe('retention sweep learns the voice table and bucket', () => {
  const src = read('retention-sweep/index.ts')
  it('expires stale confirmation gates and reaps retained audio', () => {
    expect(src).toContain("from('voice_intake_sessions')")
    expect(src).toContain("eq('status', 'awaiting_confirm')")
    expect(src).toContain("storage.from(VOICE_INTAKE_BUCKET).remove(")
    expect(src).toContain("VOICE_INTAKE_BUCKET = 'voice-intake'")
  })
})

describe('team-notify → voice return hook', () => {
  it('always runs the voice reply after the team channels, fail-soft', () => {
    const src = read('_shared/team-notify.ts')
    expect(src).toContain("import { notifyVoiceSessionsForReport } from './voice-return.ts'")
    const idx = src.indexOf('await notifyTeamChannels(db, projectId, reportId, event, details)')
    expect(idx).toBeGreaterThan(-1)
    const after = src.slice(idx, idx + 600)
    expect(after).toContain('await notifyVoiceSessionsForReport(db, projectId, reportId, event')
    expect(after).toContain('catch (err)')
  })
})
