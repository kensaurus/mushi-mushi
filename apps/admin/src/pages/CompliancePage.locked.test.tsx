/**
 * @vitest-environment jsdom
 */

/**
 * Console audit 2026-11-21, Team → Compliance on a plan without SOC 2: a
 * "needs Enterprise" banner sat over the full evidence table, with Refresh
 * evidence and two upgrade buttons. Like Single sign-on, a locked plan now
 * shows the upgrade panel alone; a plan with SOC 2 keeps the full page.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_COMPLIANCE_STATS } from '../components/compliance/types'

const mocks = vi.hoisted(() => ({ soc2: false }))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: {} })) }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null, errorCode: null }
    if (path === '/v1/admin/compliance/stats') {
      return { ...base, data: { ...EMPTY_COMPLIANCE_STATS, hasAnyProject: true, projectName: 'lets-talk', planDisplayName: 'Studio', soc2Entitlement: mocks.soc2 } }
    }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'lets-talk' } }) }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => undefined }))
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => createElement('header', null, title, children as never),
}))
vi.mock('../components/billing/UpgradePrompt', () => ({
  UpgradePrompt: () => createElement('div', { 'data-testid': 'upgrade-prompt' }, 'Locked on your current plan'),
}))

import { CompliancePage } from './CompliancePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CompliancePage)))
  })
}

describe('CompliancePage on a plan without SOC 2', () => {
  it('shows only the upgrade panel: no evidence table, no Refresh evidence', async () => {
    mocks.soc2 = false
    await render()
    expect(host.querySelector('[data-testid="compliance-locked"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="upgrade-prompt"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Refresh evidence')
    expect(host.textContent).not.toContain('SOC 2 console needs Enterprise')
  })

  it('keeps the full page once the plan has SOC 2', async () => {
    mocks.soc2 = true
    await render()
    expect(host.querySelector('[data-testid="compliance-locked"]')).toBeNull()
    expect(host.querySelector('[data-testid="upgrade-prompt"]')).toBeNull()
    expect(host.textContent).toContain('Refresh evidence')
  })
})
