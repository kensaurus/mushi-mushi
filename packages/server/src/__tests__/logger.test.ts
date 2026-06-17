/**
 * FILE: logger.test.ts
 * PURPOSE: Unit tests for the Deno edge-function structured logger.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportMessage: vi.fn(),
}))

describe('edge logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    // Clear accumulated call history on the module-level reportMessage mock so
    // each test is isolated. vi.restoreAllMocks() in afterEach restores spies
    // but does NOT reset a vi.fn()'s call log, so without this an earlier test
    // that legitimately forwards to Sentry (e.g. "routes errors to console.error")
    // leaks a stale call into the "skips Sentry" assertion below.
    vi.clearAllMocks()
    vi.stubEnv('MUSHI_LOG_FORMAT', 'json')
    vi.stubEnv('MUSHI_LOG_LEVEL', 'debug')
    vi.stubEnv('SUPABASE_URL', 'https://prod.example.supabase.co')
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function loadLogger() {
    return import('../../supabase/functions/_shared/logger.ts')
  }

  it('emits structured JSON with scope and timestamp', async () => {
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:test', format: 'json' })
    logger.info('hello')

    expect(logSpy).toHaveBeenCalledOnce()
    const entry = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(entry.scope).toBe('mushi:test')
    expect(entry.msg).toBe('hello')
    expect(entry.level).toBe('info')
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('respects log level filtering', async () => {
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:test', level: 'warn', format: 'json' })

    logger.debug('hidden')
    logger.info('hidden')
    logger.warn('visible')

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('routes errors to console.error', async () => {
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:test', format: 'json' })
    logger.error('boom')

    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('redacts sensitive metadata keys', async () => {
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:test', format: 'json' })
    logger.info('auth', {
      authorization: 'Bearer sk-secret-token',
      apiKey: 'abc123',
      path: '/v1/reports',
    })

    const entry = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(entry.authorization).toBe('[redacted]')
    expect(entry.apiKey).toBe('[redacted]')
    expect(entry.path).toBe('/v1/reports')
  })

  it('marks audit events with event=audit', async () => {
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:audit', format: 'json' })
    logger.audit('report.created', { projectId: 'p-1', reportId: 'r-1' })

    const entry = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(entry.event).toBe('audit')
    expect(entry.msg).toBe('report.created')
    expect(entry.projectId).toBe('p-1')
  })

  it('child loggers inherit and extend scope', async () => {
    const { createLogger } = await loadLogger()
    const parent = createLogger({ scope: 'mushi', format: 'json', meta: { service: 'api' } })
    const child = parent.child('ingest', { reportId: 'r-1' })
    child.info('stored')

    const entry = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(entry.scope).toBe('mushi:ingest')
    expect(entry.service).toBe('api')
    expect(entry.reportId).toBe('r-1')
  })

  it('pretty format includes scope and level label', async () => {
    vi.stubEnv('MUSHI_LOG_FORMAT', 'pretty')
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:api', format: 'pretty' })
    logger.info('Server started', { port: 54321 })

    const output = String(logSpy.mock.calls[0][0])
    expect(output).toContain('INF')
    expect(output).toContain('[mushi:api]')
    expect(output).toContain('Server started')
    expect(output).toContain('port=54321')
  })

  it('setLevel changes filtering at runtime', async () => {
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:test', level: 'warn', format: 'json' })
    logger.info('hidden')
    expect(logSpy).not.toHaveBeenCalled()

    logger.setLevel('info')
    logger.info('visible')
    expect(logSpy).toHaveBeenCalledOnce()
  })

  it('skips Sentry when sentry: false is passed', async () => {
    const { reportMessage } = await import('../../supabase/functions/_shared/sentry.ts')
    const { createLogger } = await loadLogger()
    const logger = createLogger({ scope: 'mushi:test', format: 'json' })
    logger.error('expected 5xx', { status: 503, sentry: false })

    expect(errorSpy).toHaveBeenCalledOnce()
    const entry = JSON.parse(String(errorSpy.mock.calls[0][0]))
    expect(entry.sentry).toBeUndefined()
    expect(reportMessage).not.toHaveBeenCalled()
  })
})
