import { describe, it, expect } from 'vitest'
import { createCrashlyticsAdapter, translateCrashlytics } from '../crashlytics.js'
import { makeSink, makeReq } from './shared-hmac-fixtures.js'

const PROJECT_ID = 'my-firebase-project'

/** Builds a minimal unsigned JWT-shaped token with the given `aud` claim. */
function makeJwt(aud: string | string[]): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'test', aud })).toString('base64url')
  return `${header}.${payload}.fakesig`
}

describe('translateCrashlytics', () => {
  it('maps velocityAlert to critical severity', () => {
    const result = translateCrashlytics({
      alertType: 'crashlytics.velocityAlert',
      alertData: { title: 'Login crash', crashPercentage: 0.08, firstVersion: '2.1.0' },
    })
    expect(result.description).toContain('Velocity alert')
    expect(result.description).toContain('8.0%')
    expect(result.severity).toBe('critical')
    expect(result.category).toBe('bug')
    expect(result.source).toBe('crashlytics')
  })

  it('maps newFatalIssue to high severity', () => {
    const result = translateCrashlytics({
      alertType: 'crashlytics.newFatalIssue',
      alertData: { title: 'SIGABRT in libfoo', appVersion: '1.2.3' },
    })
    expect(result.description).toContain('New fatal crash')
    expect(result.description).toContain('SIGABRT in libfoo')
    expect(result.severity).toBe('high')
  })

  it('maps newNonfatalIssue to medium severity', () => {
    const result = translateCrashlytics({
      alertType: 'crashlytics.newNonfatalIssue',
      alertData: { title: 'ANR in MainActivity', appVersion: '1.2.3' },
    })
    expect(result.description).toContain('New non-fatal issue')
    expect(result.severity).toBe('medium')
  })

  it('maps regression to high severity with resolved version note', () => {
    const result = translateCrashlytics({
      alertType: 'crashlytics.regression',
      alertData: { title: 'NullPointer in checkout', resolvedVersion: '2.0.0' },
    })
    expect(result.description).toContain('Regression')
    expect(result.description).toContain('v2.0.0')
    expect(result.severity).toBe('high')
  })

  it('uses projectName option', () => {
    const result = translateCrashlytics(
      { alertType: 'crashlytics.newFatalIssue', source: { projectId: 'payload-project' } },
      'option-project',
    )
    expect(result.component).toBe('option-project')
  })

  it('falls back to source.projectId when no projectName', () => {
    const result = translateCrashlytics({
      alertType: 'crashlytics.newFatalIssue',
      source: { projectId: 'from-payload' },
    })
    expect(result.component).toBe('from-payload')
  })
})

describe('createCrashlyticsAdapter', () => {
  it('returns 401 when token header is missing', async () => {
    const { sink } = makeSink()
    const handler = createCrashlyticsAdapter({ sink, projectId: PROJECT_ID })
    const res = await handler(makeReq({ alertType: 'crashlytics.newFatalIssue' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when aud claim does not match project ID', async () => {
    const { sink } = makeSink()
    const handler = createCrashlyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt('other-project')
    const res = await handler(makeReq(
      { alertType: 'crashlytics.newFatalIssue' },
      { 'x-firebase-id-token': token },
    ))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const { sink } = makeSink()
    const handler = createCrashlyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(PROJECT_ID)
    const res = await handler({ headers: { 'x-firebase-id-token': token }, rawBody: 'bad-json' })
    expect(res.status).toBe(400)
  })

  it('returns 200 and calls sink for newFatalIssue with matching aud', async () => {
    const { sink, calls } = makeSink()
    const handler = createCrashlyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(PROJECT_ID)
    const body = { alertType: 'crashlytics.newFatalIssue', alertData: { title: 'Fatal crash' } }
    const res = await handler(makeReq(body, { 'x-firebase-id-token': token }))
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('accepts aud as array containing project ID', async () => {
    const { sink, calls } = makeSink()
    const handler = createCrashlyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(['other', PROJECT_ID])
    const body = { alertType: 'crashlytics.velocityAlert', alertData: { title: 'Velocity crash', crashPercentage: 0.05 } }
    const res = await handler(makeReq(body, { 'x-firebase-id-token': token }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
