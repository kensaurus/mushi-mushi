/**
 * @vitest-environment jsdom
 *
 * Report fe489587, Diagnose tab: mushi-demo's only activity was a read-only
 * MCP key last called 17 days ago. The heartbeat row and the page summary
 * must say the SDK has not checked in. The yen-yen secrets scripts stay on
 * yen-yen; the generic EXPO_PUBLIC rebuild note stays for every project.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageContext } from '../lib/pageContext'

vi.mock('../lib/useSendTestReport', () => ({ useSendTestReport: () => vi.fn() }))
vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: null })),
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const DAYS = 24 * 60 * 60 * 1000

const h = vi.hoisted(() => ({
  slug: 'mushi-demo',
  sdkSeen: false,
}))

function keys() {
  return [
    {
      id: 'mcp',
      key_prefix: 'mushi_dm',
      label: 'demo-public-readonly',
      scopes: ['mcp:read'],
      is_active: true,
      created_at: new Date(Date.now() - 60 * DAYS).toISOString(),
      last_seen_at: new Date(Date.now() - 17 * DAYS).toISOString(),
      last_seen_origin: 'curl',
    },
    {
      id: 'sdk',
      key_prefix: 'mushi_b3',
      label: 'default',
      scopes: ['report:write'],
      is_active: true,
      created_at: new Date(Date.now() - DAYS).toISOString(),
      last_seen_at: h.sdkSeen ? new Date().toISOString() : null,
    },
  ]
}

vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => PROJECT }))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: {
      admin_host: 'dxptnwrhwsqckaftyymj.supabase.co',
      projects: [{
        id: PROJECT,
        name: h.slug,
        slug: h.slug,
        report_count: 1,
        last_report_at: null,
        api_keys: keys(),
      }],
    },
    error: null,
    reload: vi.fn(),
  }),
}))
vi.mock('../lib/useSetupStatus', () => ({
  SETUP_STEPS: { sdkInstalled: 'sdk_installed' },
  useSetupStatus: () => ({
    data: {
      projects: [{
        project_id: PROJECT,
        project_slug: h.slug,
        steps: [
          { id: 'project_created', label: 'Create your first project', complete: true, required: true },
          { id: 'api_key_generated', label: 'Generate an API key', complete: true, required: true },
          { id: 'sdk_installed', label: 'Install the SDK in your app', complete: false, required: true },
          { id: 'first_report_received', label: 'Receive your first bug report', complete: true, required: true },
        ],
        required_complete: 3,
        required_total: 4,
        done: false,
      }],
    },
    selectors: { required_complete: 3, required_total: 4 },
    activeProject: { project_id: PROJECT },
    loading: false,
  }),
}))

import { SetupCopilotPage } from './SetupCopilotPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function SummaryProbe() {
  const summary = usePageContext()?.summary ?? ''
  return createElement('p', { 'data-testid': 'page-summary' }, summary)
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  h.slug = 'mushi-demo'
  h.sdkSeen = false
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/onboarding?tab=diagnose&project=${PROJECT}`]}>
        <SetupCopilotPage embedded />
        <SummaryProbe />
      </MemoryRouter>,
    )
  })
  const details = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Developer details'))
  act(() => { details?.click() })
}

function heartbeat(): string {
  const dt = [...host.querySelectorAll('dt')].find((el) => el.textContent === 'SDK heartbeat')
  return dt?.parentElement?.querySelector('dd')?.textContent ?? ''
}

describe('Diagnose tab on a never-installed app (fe489587)', () => {
  it('does not treat a 17-day-old MCP key as the SDK checking in', () => {
    render()
    const text = host.textContent ?? ''
    expect(heartbeat()).toBe('Waiting for connect')
    expect(host.querySelector('[data-testid="page-summary"]')?.textContent).toContain('SDK pending')
    expect(host.querySelector('[data-testid="page-summary"]')?.textContent).toContain('Ingest 3/4')
    expect(text).toContain('SDK not connected yet')
    expect(text).toContain('Ingest 3/4')
    expect(text).not.toMatch(/cold|removed from|17d ago|SDK live|Ingest 4\/4 and dispatch 4\/4/i)
    expect(text).not.toContain('demo-public-readonly')
    expect(text).not.toContain('setup-yen-yen')
    // Other apps still get the compile-time rebuild note (review of PR 883).
    expect(text).toContain('EXPO_PUBLIC_* is compile-time')
  })

  it('a real SDK heartbeat still reads as live', () => {
    h.sdkSeen = true
    render()
    expect(heartbeat()).toBe('Live')
    expect(host.querySelector('[data-testid="page-summary"]')?.textContent).toContain('SDK live')
    expect(host.textContent ?? '').not.toMatch(/17d ago|demo-public-readonly/)
  })

  it('keeps the yen-yen secrets scripts on yen-yen', () => {
    h.slug = 'yen-yen'
    render()
    const text = host.textContent ?? ''
    expect(text).toContain('node scripts/setup-yen-yen-ingest-secrets.mjs')
    expect(text).toContain('node scripts/setup-yen-yen-reporter-secrets.mjs')
    expect(text).toContain('EXPO_PUBLIC_* is compile-time')
    expect(heartbeat()).toBe('Waiting for connect')
  })
})
