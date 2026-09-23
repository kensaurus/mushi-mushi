/**
 * FILE: packages/server/src/__tests__/diagnosis-viewed-route-contract.test.ts
 * PURPOSE: The console can write the activation step `diagnosis_viewed`, once
 *          per project, only for a project the caller can access.
 *
 * Why (2026-09-22): the setup_funnel_events CHECK (20260921000002) and
 * FunnelEventName allowed `diagnosis_viewed`, but nothing emitted it — the
 * console has no API key for POST /v1/cli/funnel. The route lives next to the
 * console test-report route in project-integrations.ts.
 *
 * Reads the route source verbatim (no Deno runtime), like the other
 * *-contract tests.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const functionsDir = resolve(__dirname, '../../supabase/functions')
const migrationsDir = resolve(__dirname, '../../supabase/migrations')

describe('POST /v1/admin/projects/:id/setup-funnel/diagnosis-viewed', () => {
  const src = readFileSync(resolve(functionsDir, 'api/routes/project-integrations.ts'), 'utf-8')
  const start = src.indexOf("app.post('/v1/admin/projects/:id/setup-funnel/diagnosis-viewed'")
  const next = src.indexOf('app.', start + 10)
  const handler = src.slice(start, next > start ? next : undefined)

  it('exists and is JWT-authenticated', () => {
    expect(start).toBeGreaterThan(-1)
    expect(handler).toMatch(/diagnosis-viewed',\s*jwtAuth,/)
  })

  it('checks project access before it emits', () => {
    // callerCanAccessProject = userCanAccessProject + the bound-API-key check.
    const accessAt = handler.indexOf('callerCanAccessProject(')
    const emitAt = handler.indexOf('emitFunnelEvent(')
    expect(accessAt).toBeGreaterThan(-1)
    expect(emitAt).toBeGreaterThan(accessAt)
    expect(handler.slice(accessAt, emitAt)).toContain('if (!access.allowed)')
  })

  it('emits diagnosis_viewed deduplicated per project', () => {
    const emit = handler.slice(handler.indexOf('emitFunnelEvent('))
    expect(emit).toContain("eventName: 'diagnosis_viewed'")
    expect(emit).toContain('dedupKey: projectId,')
    expect(emit).toContain("source: 'console'")
  })
})

describe('diagnosis_viewed is a writable setup-funnel step', () => {
  it('is typed in _shared/setup-funnel.ts', () => {
    const typed = readFileSync(resolve(functionsDir, '_shared/setup-funnel.ts'), 'utf-8')
    expect(typed).toMatch(/\|\s*'diagnosis_viewed'/)
  })

  it('is allowed by the newest setup_funnel_events CHECK', () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => readFileSync(resolve(migrationsDir, f), 'utf8').includes('setup_funnel_events_event_name_check'))
    const sql = readFileSync(resolve(migrationsDir, files.at(-1)!), 'utf8')
    const check = sql.slice(sql.lastIndexOf('add constraint setup_funnel_events_event_name_check'))
    expect(check.slice(0, check.indexOf(';'))).toContain("'diagnosis_viewed'")
  })
})
