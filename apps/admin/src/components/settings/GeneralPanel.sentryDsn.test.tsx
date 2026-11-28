/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/GeneralPanel.sentryDsn.test.tsx
 * PURPOSE: Console polish 2026-11-22. Settings → Error tracking showed an empty "Sentry DSN"
 *          field while the row said Working. Sentry connects with the org slug and auth token
 *          (Integrations, an organization default or the server environment); the DSN is an
 *          optional sign of crash reporting. The field is labelled optional and says why it can stay empty.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { PlatformResponse } from '../integrations/types'
import { sentryDsnFieldNote } from '../../lib/useSentryConnection'

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString()

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  platform: null as unknown,
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: {} })), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const data =
      path === '/v1/admin/settings'
        ? mocks.settings
        : path === '/v1/admin/integrations/platform'
          ? mocks.platform
          : path === '/v1/admin/health/history'
            ? { history: [{ id: 'h1', kind: 'sentry', status: 'ok', latency_ms: 40, message: 'HTTP 200', source: 'cron', checked_at: RECENT }] }
            : path?.startsWith('/v1/admin/integrations/inbound-deliveries')
              ? { deliveries: [{ outcome: 'accepted', created_at: RECENT, error_message: null }] }
              : null
    return { data, loading: false, error: null, reload: vi.fn() }
  },
}))

import { GeneralPanel } from './GeneralPanel'

const viaProject: PlatformResponse = {
  platform: { sentry: { sentry_org_slug: 'acme', sentry_auth_token_ref: 'sntrys_…abcd' } },
  sourceByField: { sentry_org_slug: 'project', sentry_auth_token_ref: 'project' },
}

describe('sentryDsnFieldNote', () => {
  const working = { state: 'working' as const }
  it('explains an empty DSN while Sentry is connected, naming where the connection comes from', () => {
    expect(sentryDsnFieldNote({ dsnSaved: false, shared: working, platform: viaProject })).toMatch(/Integrations page/)
    const viaOrg: PlatformResponse = { platform: { sentry: {} }, sourceByField: { sentry_org_slug: 'org', sentry_auth_token_ref: 'org' } }
    expect(sentryDsnFieldNote({ dsnSaved: false, shared: working, platform: viaOrg })).toMatch(/your organization's/)
    const viaEnv: PlatformResponse = { platform: { sentry: {} }, sourceByField: { sentry_org_slug: 'env', sentry_auth_token_ref: 'env' } }
    expect(sentryDsnFieldNote({ dsnSaved: false, shared: working, platform: viaEnv })).toMatch(/the server's/)
  })

  it('says nothing with a DSN saved, Sentry not connected, or the verdict not read yet', () => {
    expect(sentryDsnFieldNote({ dsnSaved: true, shared: working, platform: viaProject })).toBeNull()
    expect(sentryDsnFieldNote({ dsnSaved: false, shared: { state: 'not_connected' }, platform: viaProject })).toBeNull()
    expect(sentryDsnFieldNote({ dsnSaved: false, shared: null, platform: viaProject })).toBeNull()
    expect(sentryDsnFieldNote({ dsnSaved: false, shared: working, platform: { platform: { sentry: {} } } })).toBeNull()
  })
})

describe('GeneralPanel Sentry DSN field', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      // Sentry and the webhook sit in the Advanced group (ADR 0069); a link into it opens it.
      root.render(createElement(MemoryRouter, { initialEntries: ['/settings#error-tracking'] }, createElement(GeneralPanel)))
      for (let i = 0; i < 5; i += 1) await Promise.resolve()
    })
  }

  it('labels the DSN optional and says why it is empty while Sentry works', async () => {
    mocks.settings = { sentry_dsn: null }
    mocks.platform = viaProject
    await render()
    const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent?.includes('Sentry DSN'))
    expect(label?.textContent).toContain('Sentry DSN (optional)')
    const dsn = container.querySelector<HTMLInputElement>('input[placeholder*="ingest.sentry.io"]')!
    expect(dsn.value).toBe('')
    expect(container.querySelector('[data-testid="sentry-dsn-note"]')?.textContent).toContain(
      'No DSN saved, and none is needed: Sentry is connected through the org slug and auth token on the Integrations page, which import, enrichment and resolve-on-merge use.',
    )
    // Mushi Mushi never sends events to the DSN (configDocs): the note must not say it does.
    expect(container.querySelector('[data-testid="sentry-dsn-note"]')?.textContent).not.toMatch(/as events|forward/i)
  })

  it('shows no note once a DSN is saved', async () => {
    mocks.settings = { sentry_dsn: 'https://pub@o0.ingest.sentry.io/1' }
    mocks.platform = viaProject
    await render()
    expect(container.querySelector('[data-testid="sentry-dsn-note"]')).toBeNull()
  })

  it('shows no note when Sentry is not connected', async () => {
    mocks.settings = { sentry_dsn: null }
    mocks.platform = { platform: { sentry: {} }, sourceByField: {} }
    await render()
    expect(container.querySelector('[data-testid="sentry-dsn-note"]')).toBeNull()
  })
})
