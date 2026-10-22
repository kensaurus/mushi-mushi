/**
 * Classifier tests for _shared/error-codes.ts. They lived beside the module as
 * a Deno test, but deno-check.yml skips _shared/*.test.ts and vitest only
 * collects src/**, so they never ran in CI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DB_TRANSIENT_VOLUME_THRESHOLD,
  DB_TRANSIENT_VOLUME_WINDOW_MS,
  dbDiagnosticMessage,
  dbErrorFingerprint,
  dbFailureMessage,
  emitDbTransientVolumeAlert,
  isTransientDbConnectionError,
  logDbFailure,
  resetDbTransientVolume,
} from '../../supabase/functions/_shared/error-codes.ts'

const assertEquals = (actual: unknown, expected: unknown) => expect(actual).toBe(expected)

describe('isTransientDbConnectionError', () => {

  // ── The two real production issues this classifier must catch ─────────────────
  // (MUSHI-MUSHI-SERVER-1P / -1M — see sentry.ts precedent for the pattern.)

  it('SERVER-1P: Supabase pooler reset ("delayed connect error: 111") is transient', () => {
    const err = {
      message:
        'upstream connect error or disconnect/reset before headers. retried and the ' +
        'latest reset reason: remote connection failure, transport failure reason: ' +
        'delayed connect error: 111',
      code: null,
    }
    assertEquals(isTransientDbConnectionError(err), true)
  })

  it('gateway "upstream request timeout" (no SQLSTATE) is transient (MUSHI-cd3477a9)', () => {
    // Kong/Envoy plain-text or JSON body when PostgREST does not answer in
    // time. The project_members read on GET /v1/admin/onboarding/stats threw
    // this and Sentry filed it because only "upstream connect error" matched.
    assertEquals(isTransientDbConnectionError({ message: 'upstream request timeout', code: null }), true)
    assertEquals(isTransientDbConnectionError({ message: 'upstream request timeout', code: '' }), true)
    // A real SQLSTATE still wins, including a statement timeout.
    assertEquals(
      isTransientDbConnectionError({ message: 'upstream request timeout', code: '57014' }),
      false,
    )
    assertEquals(
      isTransientDbConnectionError({ message: 'upstream request timeout', code: 'P0001' }),
      false,
    )
    // A nearby sentence is not the gateway body.
    assertEquals(
      isTransientDbConnectionError({ message: 'request timeout while calling the provider', code: null }),
      false,
    )
  })

  it('SERVER-1M: Cloudflare 522 origin-timeout HTML page is transient', () => {
    const err = {
      message:
        '<!DOCTYPE html><title>supabase.co | 522: Connection timed out</title>' +
        '<span class="code-label">Error code 522</span>',
      code: null,
    }
    assertEquals(isTransientDbConnectionError(err), true)
  })

  // MUSHI-61dfa948: a gateway HTML page with no "522" marker was reported as
  // `Error: <!DOCTYPE html>`.
  it('an HTML gateway page or named 502/503/504/520-524 status is transient', () => {
    assertEquals(
      isTransientDbConnectionError({
        message: '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>cloudflare</body></html>',
        code: null,
      }),
      true,
    )
    assertEquals(
      isTransientDbConnectionError({ message: '<html><body>503 Service Unavailable</body></html>', code: '' }),
      true,
    )
    assertEquals(isTransientDbConnectionError({ message: '502 Bad Gateway', code: null }), true)
    assertEquals(isTransientDbConnectionError({ message: '503 Service Temporarily Unavailable', code: null }), true)
    assertEquals(isTransientDbConnectionError({ message: '504 Gateway Time-out', code: null }), true)
    assertEquals(isTransientDbConnectionError({ message: 'Error code 520', code: null }), true)
    assertEquals(isTransientDbConnectionError({ message: 'Error code: 521', code: null }), true)
    assertEquals(
      isTransientDbConnectionError({ message: '520: Web server returned an unknown error', code: null }),
      true,
    )
  })

  it('a coded SQL error is reported even when its text contains an HTML page', () => {
    assertEquals(
      isTransientDbConnectionError({
        message: '<!DOCTYPE html><title>502 Bad Gateway</title>',
        code: '42703',
      }),
      false,
    )
  })

  // ── Must NOT hide real bugs: genuine coded SQLSTATE errors always report ───────

  it('real DB errors with a SQLSTATE are NOT transient (never silenced)', () => {
    assertEquals(isTransientDbConnectionError({ message: 'column x does not exist', code: '42703' }), false)
    assertEquals(isTransientDbConnectionError({ message: 'permission denied', code: '42501' }), false)
    assertEquals(isTransientDbConnectionError({ message: 'duplicate key', code: '23505' }), false)
    // PL/pgSQL RAISE EXCEPTION carries P0001 — even if its text mentions a network
    // token, the code wins and it is reported (the review's top false-negative risk).
    assertEquals(
      isTransientDbConnectionError({ message: 'RAISE: connection timed out for provider', code: 'P0001' }),
      false,
    )
    // Pool exhaustion / statement timeout are real capacity signals — keep paging.
    // A timeout whose text also contains a doctype is still a coded SQLSTATE.
    assertEquals(isTransientDbConnectionError({ message: 'too many connections', code: '53300' }), false)
    assertEquals(isTransientDbConnectionError({ message: 'canceling statement due to statement timeout', code: '57014' }), false)
    assertEquals(
      isTransientDbConnectionError({
        message: 'canceling statement due to statement timeout <!DOCTYPE html>',
        code: '57014',
      }),
      false,
    )
  })

  // ── Genuine connection-family SQLSTATEs ARE transient ─────────────────────────

  it('connection_exception SQLSTATE class 08 (and 57P03) is transient', () => {
    assertEquals(isTransientDbConnectionError({ message: 'connection failure', code: '08006' }), true)
    assertEquals(isTransientDbConnectionError({ message: 'unable to establish', code: '08001' }), true)
    assertEquals(isTransientDbConnectionError({ message: 'cannot connect now', code: '57P03' }), true)
  })

  // ── PostgREST schema-cache reload (MUSHI-MUSHI-SERVER-1M) ─────────────────────

  it('hosted gateway "Project not specified." is transient, including a bare PGRST code', () => {
    // postgrest-js keeps a non-JSON gateway body as { message } (no code).
    assertEquals(isTransientDbConnectionError({ message: 'Project not specified.' }), true)
    assertEquals(isTransientDbConnectionError({ message: 'Project not specified', code: null }), true)
    assertEquals(
      isTransientDbConnectionError({
        message: 'Bad request - please check your parameters: Project not specified.',
        code: null,
      }),
      true,
    )
    // `PGRST` is 5 letters, so it looks like a SQLSTATE. It is the PostgREST
    // prefix, not a class, and must not hide this gateway body.
    assertEquals(isTransientDbConnectionError({ message: 'Project not specified.', code: 'PGRST' }), true)
  })

  it('a real SQLSTATE or a different sentence containing those words is NOT transient', () => {
    assertEquals(isTransientDbConnectionError({ message: 'Project not specified.', code: 'P0001' }), false)
    assertEquals(isTransientDbConnectionError({ message: 'the project not specified in the payload', code: null }), false)
    assertEquals(isTransientDbConnectionError({ message: 'column missing', code: 'PGRST' }), false)
  })

  it('PGRST002 (schema cache reload) is transient, by code or by its message', () => {
    const message = 'Could not query the database for the schema cache. Retrying.'
    assertEquals(isTransientDbConnectionError({ message, code: 'PGRST002' }), true)
    assertEquals(isTransientDbConnectionError({ message: '', code: 'pgrst002' }), true)
    assertEquals(isTransientDbConnectionError({ message, code: null }), true)
  })

  it('other "schema cache" PostgREST errors are real bugs, NOT transient', () => {
    // A missing column / function is schema drift: it fails on every call.
    assertEquals(
      isTransientDbConnectionError({
        message: "Could not find the 'foo' column of 'reports' in the schema cache",
        code: 'PGRST204',
      }),
      false,
    )
    assertEquals(
      isTransientDbConnectionError({
        message: 'Could not find the function public.write_codebase_graph without parameters in the schema cache',
        code: 'PGRST202',
      }),
      false,
    )
  })

  // ── False-positive guards from code review ────────────────────────────────────

  it('a bare "522" substring in an unrelated message is NOT transient', () => {
    // e.g. a real validation/constraint error whose text happens to contain 522.
    assertEquals(isTransientDbConnectionError({ message: 'value 5220 exceeds maximum allowed', code: null }), false)
    assertEquals(isTransientDbConnectionError({ message: 'row 522 failed check constraint', code: null }), false)
    assertEquals(isTransientDbConnectionError({ message: 'value 5020 exceeds maximum allowed', code: null }), false)
    assertEquals(isTransientDbConnectionError({ message: 'error code 5200', code: null }), false)
    assertEquals(
      isTransientDbConnectionError({ message: 'expected a tag like <html> in the template', code: null }),
      false,
    )
  })

  it('generic "connection refused" (persistent misconfig) is NOT auto-silenced', () => {
    // A dead host / wrong port produces this forever — must remain visible.
    assertEquals(isTransientDbConnectionError({ message: 'connection refused', code: null }), false)
  })

  // ── Supabase API gateway "Project not specified." (MUSHI 89ac1103) ─────────
  // Plain-text 400 from the hosted gateway when the host has no project ref.
  // webhook_audit_log.project_id is nullable and is not part of the insert.

  it('Supabase gateway "Project not specified." is transient when it has no SQLSTATE', () => {
    assertEquals(isTransientDbConnectionError({ message: 'Project not specified.', code: null }), true)
    assertEquals(isTransientDbConnectionError({ message: 'Project not specified.\n' }), true)
    assertEquals(
      isTransientDbConnectionError({
        message: 'Bad request - please check your parameters: Project not specified.',
        code: '',
      }),
      true,
    )
  })

  it('a real RAISE or a longer "project" message is NOT the gateway error', () => {
    assertEquals(
      isTransientDbConnectionError({ message: 'Project not specified.', code: 'P0001' }),
      false,
    )
    assertEquals(
      isTransientDbConnectionError({ message: 'project not specified for this row', code: null }),
      false,
    )
  })

  // ── Null / shape safety ───────────────────────────────────────────────────────

  it('null / undefined / empty errors are not transient', () => {
    assertEquals(isTransientDbConnectionError(null), false)
    assertEquals(isTransientDbConnectionError(undefined), false)
    assertEquals(isTransientDbConnectionError({}), false)
    assertEquals(isTransientDbConnectionError({ message: undefined, code: undefined }), false)
  })
})

describe('dbDiagnosticMessage', () => {
  it('keeps a gateway title and drops the HTML body', () => {
    const message =
      '<!DOCTYPE html><html><head><title>supabase.co | 502: Bad gateway</title></head>' +
      '<body><script>secret()</script></body></html>'
    expect(dbDiagnosticMessage(message)).toBe('[upstream gateway error] supabase.co | 502: Bad gateway')
    expect(dbDiagnosticMessage(message)).not.toContain('<')
    expect(dbDiagnosticMessage('502 Bad Gateway')).toBe('[upstream gateway error] 502 Bad Gateway')
    expect(dbDiagnosticMessage('column missing')).toBe('column missing')
  })
})

describe('dbFailureMessage / dbErrorFingerprint', () => {
  it('keeps a real message, and falls through empty message to details then code', () => {
    expect(dbFailureMessage({ message: 'canceling statement due to statement timeout', code: '57014' })).toBe(
      'canceling statement due to statement timeout',
    )
    expect(dbFailureMessage({ message: '  ', code: '57014', details: 'process 1' })).toBe('process 1')
    expect(dbFailureMessage({ message: '', code: 'XX000' })).toBe('Unknown DB error (XX000)')
    expect(dbFailureMessage(null)).toBe('Unknown DB error (unknown)')
  })

  it('never puts a gateway HTML page in the exception text', () => {
    expect(
      dbFailureMessage({ message: '<!DOCTYPE html><title>502 Bad Gateway</title><script>x()</script>', code: '42703' }),
    ).toBe('[upstream gateway error] 502 Bad Gateway')
    expect(dbFailureMessage({ message: '', code: '57014', details: '<html><body>oops</body></html>' })).not.toContain('<')
  })

  it('folds uuids and long numeric ids into the fingerprint', () => {
    const path = '/v1/admin/projects/1000000a-0000-4000-8000-000000000000/reports/42'
    expect(dbErrorFingerprint('57014', path)).toEqual(['db-error', '57014', '/v1/admin/projects/:id/reports/:n'])
    expect(dbErrorFingerprint('  ', '/v1/admin/reports')).toEqual(['db-error', 'unknown', '/v1/admin/reports'])
    expect(dbErrorFingerprint(null, '')).toEqual(['db-error', 'unknown', 'unknown'])
  })
})

describe('logDbFailure', () => {
  const spyLogger = () => {
    const calls: Array<{ level: 'warn' | 'error'; msg: string; meta?: Record<string, unknown> }> = []
    return {
      calls,
      warn: (msg: string, meta?: Record<string, unknown>) => calls.push({ level: 'warn', msg, meta }),
      error: (msg: string, meta?: Record<string, unknown>) => calls.push({ level: 'error', msg, meta }),
    }
  }

  it('a pooler outage is a warn (no Sentry event) and reports transient', () => {
    const logger = spyLogger()
    const err = { message: 'upstream connect error ... delayed connect error: 111', code: null }
    expect(logDbFailure(logger, 'failed to load jobs', err, { err: err.message })).toBe(true)
    expect(logger.calls).toEqual([
      { level: 'warn', msg: 'failed to load jobs', meta: { err: err.message, db_code: null, transient: true } },
    ])
  })

  it('PGRST002 is classified from the code, not just the text', () => {
    const logger = spyLogger()
    expect(logDbFailure(logger, 'Failed to fetch qa_stories', { message: 'x', code: 'PGRST002' })).toBe(true)
    expect(logger.calls[0].level).toBe('warn')
  })

  it('a gateway "Project not specified." is a warn, not a Sentry error', () => {
    const logger = spyLogger()
    const err = { message: 'Project not specified.', code: null as string | null }
    expect(logDbFailure(logger, 'audit insert failed', err, { scope: 'webhook-middleware', err: err.message })).toBe(true)
    expect(logger.calls[0].level).toBe('warn')
    expect(logger.calls[0].meta).toMatchObject({ transient: true, scope: 'webhook-middleware' })
  })

  it('a real error, a statement timeout, or a missing error object stays an error', () => {
    const logger = spyLogger()
    expect(logDbFailure(logger, 'a', { message: 'column x does not exist', code: '42703' }, { k: 1 })).toBe(false)
    expect(logDbFailure(logger, 'b', { message: 'canceling statement due to statement timeout', code: '57014' })).toBe(false)
    expect(logDbFailure(logger, 'c', null)).toBe(false)
    expect(logger.calls.map((c) => c.level)).toEqual(['error', 'error', 'error'])
    expect(logger.calls[0].meta).toEqual({ k: 1 })
  })
})

describe('db_transient_error volume alert', () => {
  beforeEach(() => resetDbTransientVolume())

  function record(path: string, now: number) {
    const reports: Array<{ msg: string; ctx: { tags: Record<string, string>; fingerprint: string[] } }> = []
    const warned: Array<Record<string, unknown>> = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((line?: unknown) => {
      warned.push(JSON.parse(String(line)) as Record<string, unknown>)
    })
    let alerted = false
    try {
      alerted = emitDbTransientVolumeAlert(
        path,
        (msg, ctx) => reports.push({ msg, ctx }),
        { scope: 'mushi:test', method: 'GET', requestId: 'r1' },
        now,
      )
    } finally {
      spy.mockRestore()
    }
    return { alerted, reports, warned }
  }

  it('stays quiet below the threshold and alerts once when one route keeps timing out', () => {
    const path = '/api/v1/admin/onboarding/stats'
    const t = 1_700_000_000_000
    for (let i = 0; i < DB_TRANSIENT_VOLUME_THRESHOLD - 1; i++) {
      const hit = record(path, t + i)
      expect(hit.alerted).toBe(false)
      expect(hit.reports).toEqual([])
      expect(hit.warned).toEqual([])
    }
    const hot = record(path, t + DB_TRANSIENT_VOLUME_THRESHOLD)
    expect(hot.alerted).toBe(true)
    expect(hot.reports).toHaveLength(1)
    expect(hot.reports[0]!.msg).toContain(path)
    expect(hot.reports[0]!.msg).toContain(String(DB_TRANSIENT_VOLUME_THRESHOLD))
    expect(hot.reports[0]!.ctx).toMatchObject({
      tags: { path, method: 'GET', event: 'db_transient_error_volume' },
      extra: { count: DB_TRANSIENT_VOLUME_THRESHOLD, window_ms: DB_TRANSIENT_VOLUME_WINDOW_MS },
      fingerprint: ['db-transient-volume', path],
    })
    expect(hot.warned).toHaveLength(1)
    expect(hot.warned[0]).toMatchObject({
      event: 'db_transient_error_volume',
      level: 'warn',
      scope: 'mushi:test',
      path,
      method: 'GET',
      requestId: 'r1',
      count: DB_TRANSIENT_VOLUME_THRESHOLD,
      window_ms: DB_TRANSIENT_VOLUME_WINDOW_MS,
    })
    expect(record(path, t + DB_TRANSIENT_VOLUME_THRESHOLD + 1).alerted).toBe(false)
  })

  it('folds project ids into one route and does not share that count with another route', () => {
    const t = 1_700_000_000_000
    const a = '/v1/admin/projects/1000000a-0000-4000-8000-000000000000/members'
    const b = '/v1/admin/projects/2000000b-0000-4000-8000-000000000000/members'
    for (let i = 0; i < DB_TRANSIENT_VOLUME_THRESHOLD - 1; i++) {
      expect(record(a, t + i).alerted).toBe(false)
    }
    const hot = record(b, t + 50)
    expect(hot.alerted).toBe(true)
    expect(hot.reports[0]!.ctx.tags.path).toBe('/v1/admin/projects/:id/members')
    expect(hot.reports[0]!.ctx.fingerprint).toEqual([
      'db-transient-volume',
      '/v1/admin/projects/:id/members',
    ])
    expect(record('/v1/admin/onboarding/stats', t + 51).alerted).toBe(false)
  })

  it('alerts again after the window slides past the earlier timeouts', () => {
    const path = '/v1/admin/reports'
    const t = 1_700_000_000_000
    for (let i = 0; i < DB_TRANSIENT_VOLUME_THRESHOLD; i++) record(path, t + i)
    const later = t + DB_TRANSIENT_VOLUME_WINDOW_MS + 5
    for (let i = 0; i < DB_TRANSIENT_VOLUME_THRESHOLD - 1; i++) {
      expect(record(path, later + i).alerted).toBe(false)
    }
    expect(record(path, later + DB_TRANSIENT_VOLUME_THRESHOLD).alerted).toBe(true)
  })
})
