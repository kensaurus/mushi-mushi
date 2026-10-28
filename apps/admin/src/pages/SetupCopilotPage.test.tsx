/**
 * @vitest-environment jsdom
 *
 * Report fe489587, Diagnose tab: mushi-demo never installed the SDK. Its
 * read-only MCP key was last called 17 days ago (the docs demo, by curl).
 * That call is not the app. The readout must say the SDK is waiting, the
 * health card must not say Cold or "removed from a deploy", and yen-yen
 * store-build instructions must not show on another app. The verify step
 * uses the live ingest count, never a hard-coded "Ingest 4/4 and dispatch 4/4".
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const DAYS = 24 * 60 * 60 * 1000

const harness = vi.hoisted(() => ({
  slug: 'mushi-demo',
  name: 'mushi-demo',
  sdkComplete: false,
  keys: [] as Array<{
    id: string
    key_prefix: string
    label?: string | null
    scopes?: string[] | null
    is_active: boolean
    created_at: string
    last_seen_at?: string | null
    last_seen_origin?: string | null
  }>,
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: {
      admin_host: 'dxptnwrhwsqckaftyymj.supabase.co',
      projects: [
        {
          id: PROJECT,
          name: harness.name,
          slug: harness.slug,
          report_count: 1,
          last_report_at: null,
          api_keys: harness.keys,
        },
      ],
    },
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('../lib/useSetupStatus', async () => {
  const actual = await vi.importActual<typeof import('../lib/useSetupStatus')>('../lib/useSetupStatus')
  return {
    ...actual,
    useSetupStatus: () => ({
      data: {
        projects: [
          {
            project_id: PROJECT,
            project_slug: harness.slug,
            required_complete: 3,
            required_total: 4,
            done: false,
            steps: [
              {
                id: 'sdk_installed',
                label: 'Install the SDK in your app',
                complete: harness.sdkComplete,
                required: true,
              },
            ],
          },
        ],
      },
      loading: false,
      activeProject: { project_id: PROJECT },
      selectors: { required_complete: 3, required_total: 4 },
    }),
  }
})

vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => PROJECT }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../lib/useSendTestReport', () => ({ useSendTestReport: () => vi.fn() }))
vi.mock('../components/PagePosture', () => ({
  POSTURE_PRIORITY: { status: 0, nudge: 5, recommended: 10, heroOrSnapshot: 20, guide: 30 },
  PagePosture: ({ slots }: { slots: Array<{ show?: boolean; children: ReactNode }> }) =>
    createElement('div', null, ...slots.filter((s) => s.show !== false).map((s) => s.children)),
}))

import { sdkHasCheckedIn } from './SetupCopilotPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function rowValue(host: ParentNode, label: string): string {
  const dt = [...host.querySelectorAll('dt')].find((el) => el.textContent === label)
  return dt?.nextElementSibling?.textContent ?? ''
}

const mcpSeen17dAgo = {
  id: 'mcp',
  key_prefix: 'mushi_dm',
  label: 'demo-public-readonly',
  scopes: ['mcp:read'],
  is_active: true,
  created_at: new Date(Date.now() - 60 * DAYS).toISOString(),
  last_seen_at: new Date(Date.now() - 17 * DAYS).toISOString(),
  last_seen_origin: 'curl',
}
const unusedSdkKey = {
  id: 'sdk',
  key_prefix: 'mushi_b3',
  label: 'default',
  scopes: ['report:write'],
  is_active: true,
  created_at: new Date(Date.now() - DAYS).toISOString(),
  last_seen_at: null,
}

describe('sdkHasCheckedIn', () => {
  it('ignores an MCP key seen 17 days ago when the SDK key was never used', () => {
    expect(sdkHasCheckedIn([mcpSeen17dAgo, unusedSdkKey])).toBe(false)
  })

  it('counts a report:write key that has checked in', () => {
    expect(sdkHasCheckedIn([{ ...unusedSdkKey, last_seen_at: new Date().toISOString() }])).toBe(true)
  })

  it('does not count a CLI key that also has an MCP scope', () => {
    expect(
      sdkHasCheckedIn([
        { ...unusedSdkKey, id: 'cli', scopes: ['report:write', 'mcp:read'], last_seen_at: new Date().toISOString() },
        unusedSdkKey,
      ]),
    ).toBe(false)
  })
})

describe('Diagnose tab for a never-installed app (fe489587)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    harness.slug = 'mushi-demo'
    harness.name = 'mushi-demo'
    harness.sdkComplete = false
    harness.keys = [mcpSeen17dAgo, unusedSdkKey]
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function mount() {
    const { SetupCopilotPage } = await import('./SetupCopilotPage')
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/onboarding?tab=diagnose&project=${PROJECT}`] },
          createElement(SetupCopilotPage, { embedded: true }),
        ),
      )
    })
    const details = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Developer details'))
    expect(details).toBeTruthy()
    await act(async () => {
      details!.click()
    })
  }

  it('says the SDK is waiting, not Cold, and does not show yen-yen scripts or a hard-coded 4/4', async () => {
    await mount()
    const text = host.textContent ?? ''
    expect(rowValue(host, 'SDK heartbeat')).toBe('Waiting for connect')
    expect(text).toContain('SDK not connected yet')
    expect(text).not.toMatch(/cold|removed from a deploy|17d ago/i)
    expect(text).not.toContain('demo-public-readonly')
    expect(text).not.toContain('setup-yen-yen')
    expect(text).not.toContain('EXPO_PUBLIC_* is compile-time')
    expect(text).not.toContain('Ingest 4/4 and dispatch 4/4')
    expect(text).toContain('Ingest 3/4')
  })

  it('shows the yen-yen store-build script only for that app', async () => {
    harness.slug = 'yen-yen'
    harness.name = 'yen-yen'
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('setup-yen-yen-ingest-secrets.mjs')
    expect(text).toContain('EXPO_PUBLIC_* is compile-time')
    expect(rowValue(host, 'SDK heartbeat')).toBe('Waiting for connect')
  })

  it('says the SDK is live once a report:write key has checked in', async () => {
    harness.sdkComplete = true
    harness.keys = [{ ...unusedSdkKey, last_seen_at: new Date().toISOString() }]
    await mount()
    expect(rowValue(host, 'SDK heartbeat')).toBe('Live')
  })
})
