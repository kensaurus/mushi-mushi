/**
 * FILE: doctor-checks.test.ts
 * PURPOSE: The pure server-doctor checks a self-host depends on
 *          (_shared/doctor-checks.ts): info never counts as a problem, the
 *          cron URL that still points at Mushi Mushi Cloud fails, and no
 *          line ever echoes a URL path or a secret.
 */
import { describe, expect, it } from 'vitest'
import {
  consoleUrlCheck,
  doctorCheckId,
  doctorLabel,
  doctorWorst,
  llmKeyCheck,
  observabilityCheck,
  runtimeUrlCheck,
  screenshotsBucketCheck,
  sentryDsnSet,
} from '../../supabase/functions/_shared/doctor-checks.ts'

const CLOUD_REF = 'dxptnwrhwsqckaftyymj'

describe('doctorWorst', () => {
  it('info lines never raise the status', () => {
    expect(doctorWorst([{ status: 'pass' }, { status: 'info' }])).toBe('pass')
    expect(doctorWorst([{ status: 'info' }, { status: 'warn' }])).toBe('warn')
    expect(doctorWorst([{ status: 'warn' }, { status: 'fail' }])).toBe('fail')
    expect(doctorWorst([])).toBe('pass')
  })
})

describe('labels', () => {
  it('known ids get a plain-English name; per-app rows share their id', () => {
    expect(doctorCheckId('codebase_index:abc')).toBe('codebase_index')
    expect(doctorLabel('codebase_index:abc')).toBe('Code index')
    expect(doctorLabel('runtime_url')).toBe('Cron jobs call this server')
    expect(doctorLabel('platform_slack_oauth')).toBe('Slack oauth')
  })
})

describe('llmKeyCheck', () => {
  it('a server key passes and names the provider', () => {
    expect(llmKeyCheck({ envAnthropic: true, envOpenai: false, appKeys: 0 })).toMatchObject({ status: 'pass', summary: 'Anthropic key set on the server.' })
    expect(llmKeyCheck({ envAnthropic: true, envOpenai: true, appKeys: null }).summary).toBe('Anthropic and OpenAI key set on the server.')
  })
  it('an app key passes without a server key', () => {
    expect(llmKeyCheck({ envAnthropic: false, envOpenai: false, appKeys: 2 }).status).toBe('pass')
  })
  it('no key is info with a console fix, never a failure', () => {
    const c = llmKeyCheck({ envAnthropic: false, envOpenai: false, appKeys: 0 })
    expect(c).toMatchObject({ status: 'info', fixHref: '/settings?tab=byok' })
    expect(c.hint).toContain('Settings → AI keys')
    expect(llmKeyCheck({ envAnthropic: false, envOpenai: false, appKeys: null }).summary).toContain('could not be read')
  })
})

describe('runtimeUrlCheck', () => {
  it('a self-host still calling Mushi Mushi Cloud fails with the selfhost up fix', () => {
    const c = runtimeUrlCheck({ mode: 'self-hosted', supabaseUrl: `https://${CLOUD_REF}.supabase.co`, cloudRef: CLOUD_REF })
    expect(c.status).toBe('fail')
    expect(c.hint).toContain('selfhost up --skip-deploy')
    expect(c.hint).toContain('run --rm migrate')
  })
  it('Cloud calling itself passes', () => {
    expect(runtimeUrlCheck({ mode: 'hosted', supabaseUrl: `https://${CLOUD_REF}.supabase.co`, cloudRef: CLOUD_REF }).status).toBe('pass')
  })
  it('an empty URL fails; a read error warns', () => {
    expect(runtimeUrlCheck({ mode: 'self-hosted', supabaseUrl: '', cloudRef: CLOUD_REF }).status).toBe('fail')
    expect(runtimeUrlCheck({ mode: 'self-hosted', supabaseUrl: null, cloudRef: CLOUD_REF, readError: 'timeout' }).status).toBe('warn')
  })
  it('shows only the origin of the URL', () => {
    const c = runtimeUrlCheck({ mode: 'self-hosted', supabaseUrl: 'http://caddy:8000/some/path?token=abc', cloudRef: CLOUD_REF })
    expect(c).toMatchObject({ status: 'pass', summary: 'Cron jobs call http://caddy:8000.' })
    expect(c.summary).not.toContain('token')
  })
})

describe('screenshotsBucketCheck', () => {
  it('private passes, public or missing fails, unreadable warns', () => {
    expect(screenshotsBucketCheck({ bucket: { public: false } }).status).toBe('pass')
    expect(screenshotsBucketCheck({ bucket: { public: true } }).status).toBe('fail')
    expect(screenshotsBucketCheck({ bucket: null }).status).toBe('fail')
    expect(screenshotsBucketCheck({ bucket: null, readError: 'boom' }).status).toBe('warn')
  })
})

describe('consoleUrlCheck and observabilityCheck', () => {
  it('both are optional: info when unset, pass when set', () => {
    expect(consoleUrlCheck({ adminBaseUrl: undefined }).status).toBe('info')
    expect(consoleUrlCheck({ adminBaseUrl: 'https://mushi.example.com/admin' })).toMatchObject({ status: 'pass', summary: 'Links open https://mushi.example.com.' })
    expect(observabilityCheck({ langfuse: false, sentry: true }).status).toBe('info')
    expect(observabilityCheck({ langfuse: true, sentry: true }).status).toBe('pass')
  })
  it('Sentry counts SENTRY_DSN_SERVER or SENTRY_DSN', () => {
    expect(sentryDsnSet((n) => (n === 'SENTRY_DSN_SERVER' ? 'x' : undefined))).toBe(true)
    expect(sentryDsnSet((n) => (n === 'SENTRY_DSN' ? 'x' : undefined))).toBe(true)
    expect(sentryDsnSet(() => undefined)).toBe(false)
  })
})
