/**
 * @vitest-environment jsdom
 *
 * Set up's progress rail shows the next step's one button: make the key,
 * copy the snippet, send a test bug, or open the first report.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupProject } from '../../lib/useSetupStatus'

const state = vi.hoisted(() => ({ ttfd: null as unknown }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: state.ttfd, loading: false, error: null, isValidating: false, reload: vi.fn(), lastFetchedAt: null }),
}))

import { SetupProgressRail } from './SetupProgressRail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.ttfd = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function project(key: boolean, sdk: boolean, report = false): SetupProject {
  const step = (id: string, complete: boolean) => ({ id, label: id, description: '', complete, required: true, cta_to: '/', cta_label: 'Go' })
  return {
    project_id: 'p1',
    project_name: 'Demo',
    project_slug: 'demo',
    created_at: new Date().toISOString(),
    steps: [
      step('project_created', true),
      step('api_key_generated', key),
      {
        ...step('sdk_installed', sdk),
        diagnostic: {
          last_sdk_seen_at: sdk ? new Date().toISOString() : null,
          last_sdk_origin: sdk ? 'https://app.example.com' : null,
          last_sdk_user_agent: null,
          last_sdk_endpoint_host: null,
        },
      },
      step('first_report_received', report),
    ],
    required_total: 4,
    required_complete: 1 + Number(key) + Number(sdk) + Number(report),
    total: 8,
    complete: 1,
    done: false,
    report_count: 0,
    fix_count: 0,
    merged_fix_count: 0,
  } as SetupProject
}

function render(p: SetupProject, handlers: Partial<{ onMintKey: () => void; onSendTest: () => void; onTab: () => void }> = {}, compact = false, apiKey: string | null = null) {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(SetupProgressRail, {
          project: p,
          apiKey,
          onTab: handlers.onTab ?? vi.fn(),
          onMintKey: handlers.onMintKey ?? vi.fn(),
          minting: false,
          onSendTest: handlers.onSendTest ?? vi.fn(),
          testing: false,
          compact,
        }),
      ),
    )
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

describe('SetupProgressRail', () => {
  it('without a key, the one button makes it', () => {
    const onMintKey = vi.fn()
    render(project(false, false), { onMintKey })
    expect(host.textContent).toContain('1 of 4 done. Next: make a key')
    act(() => button('Make the key')!.click())
    expect(onMintKey).toHaveBeenCalled()
  })

  // The snippet carried apiKey: 'mushi_xxx' and sent people to another tab for
  // a key they could no longer see (2026-10-28).
  it('with a key made earlier, offers to make one on the spot instead of a snippet that cannot work', () => {
    const onMintKey = vi.fn()
    render(project(true, false), { onMintKey })
    expect(host.querySelector('[data-testid="setup-next-step"]')?.textContent).toContain('npm install @mushi-mushi/')
    act(() => button('Make a key and fill it in')!.click())
    expect(onMintKey).toHaveBeenCalled()
    expect(button('Copy without a key')).toBeTruthy()
    expect(host.textContent).not.toMatch(/SDK tab/)
    expect(host.querySelector('[data-testid="setup-heartbeat"]')?.textContent).toMatch(/^Mushi has not heard from your app yet/)
  })

  it('with the key just made, the snippet carries it and Copy snippet leads', () => {
    render(project(true, false), {}, false, 'mushi_live_abc123')
    expect(host.querySelector('[data-testid="setup-next-step"]')?.textContent).toContain('mushi_live_abc123')
    expect(button('Copy snippet')).toBeTruthy()
    expect(button('Make a key and fill it in')).toBeUndefined()
  })

  it('after a heartbeat with no bug yet, offers a test bug', () => {
    const onSendTest = vi.fn()
    render(project(true, true), { onSendTest })
    expect(host.textContent).toContain('3 of 4 done. Next: get your first bug')
    expect(host.querySelector('[data-testid="setup-heartbeat"]')?.textContent).toContain('from https://app.example.com')
    act(() => button('Send a test bug')!.click())
    expect(onSendTest).toHaveBeenCalled()
  })

  it('a test bug counts like the sidebar counts it, and says it was only a test', () => {
    state.ttfd = { keyMintedAt: null, firstDiagnosisAt: null, ms: null, testDiagnosisAt: new Date().toISOString() }
    render(project(true, true, true))
    expect(host.textContent).toContain('Your app is wired up')
    expect(host.textContent).toContain('Mushi has only seen a test bug so far')
  })

  it('done: opens the first report from the app', () => {
    state.ttfd = { keyMintedAt: null, firstDiagnosisAt: new Date().toISOString(), ms: 60_000, firstReportId: 'r-123' }
    render(project(true, true, true))
    expect(host.textContent).toContain('Your app is wired up')
    const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'Open first report')
    expect(link?.getAttribute('href')).toBe('/reports/r-123')
  })

  it('compact (other tabs) shows the rail only, and a step opens its tab', () => {
    const onTab = vi.fn()
    render(project(false, false), { onTab }, true)
    expect(host.querySelector('[data-testid="setup-next-step"]')).toBeNull()
    act(() => (host.querySelector('[aria-current="step"]') as HTMLButtonElement).click())
    expect(onTab).toHaveBeenCalledWith('sdk')
  })
})
