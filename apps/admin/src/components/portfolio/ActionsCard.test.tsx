/**
 * @vitest-environment jsdom
 */

/**
 * Store and payment actions (ADR 0017 / 0074): a store media upload is run
 * from its release's kit, the only place its uploader runs. Here an approved
 * one links to that release instead of offering a "Run now" the server
 * would refuse (USE_RELEASE_KIT); rollouts keep Run now. Media actions are
 * not offered in "Ask for an action" (the kit asks, pinning each file).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = '0000000b-0000-4000-8000-000000000000'
const RELEASE = '2000000a-0000-4000-8000-000000000000'

const mocks = vi.hoisted(() => ({ actions: [] as unknown[], mutate: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn(), apiFetchMutate: mocks.mutate }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { actions: mocks.actions }, loading: false, error: null, reload: vi.fn() }),
}))

import { ActionsCard, storeMediaRunPath } from './ActionsCard'

const row = (over: Record<string, unknown>) => ({
  id: 'a1', connector_instance_id: 'c1', action: 'set_rollout', payload: {}, payload_sha256: 'f'.repeat(64), reason: null,
  status: 'approved', requested_by: 'user:x', requested_at: '2026-11-27T10:00:00Z', expires_at: '2026-11-27T11:00:00Z', error: null, ...over,
})

let host: HTMLDivElement
let root: Root

function render(connectors: Array<{ id: string; name: string; actions: string[] }>) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(ActionsCard, { orgId: ORG, connectors })))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  mocks.actions = []
})

describe('ActionsCard and store media uploads', () => {
  it('links an approved store upload to its release instead of a Run now the server refuses', () => {
    mocks.actions = [row({ id: 'm1', action: 'upload_screenshots', payload: { kitId: 'k', releaseId: RELEASE, appleId: '1' } })]
    render([{ id: 'c1', name: 'App Store Connect', actions: ['upload_screenshots', 'upload_app_preview'] }])
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Run it from the release')
    expect(link?.getAttribute('href')).toBe(`/releases?release=${RELEASE}`)
    expect(host.textContent).not.toContain('Run now')
    expect(host.textContent).toContain('A store upload runs from its release')
  })

  it('keeps Run now for a rollout', () => {
    mocks.actions = [row({ action: 'set_rollout', payload: { package: 'com.x.app' } })]
    render([{ id: 'c2', name: 'Google Play', actions: ['set_rollout', 'promote_track', 'upload_listing_images', 'set_promo_video'] }])
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Run now')).toBe(true)
  })

  it('does not offer store media actions under "Ask for an action"', () => {
    render([
      { id: 'c1', name: 'App Store Connect', actions: ['upload_screenshots', 'upload_app_preview'] },
      { id: 'c2', name: 'Google Play', actions: ['set_rollout', 'upload_listing_images'] },
    ])
    const toggle = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Ask for an action'))!
    act(() => toggle.click())
    const connector = host.querySelector('select') as HTMLSelectElement
    expect([...connector.options].map((o) => o.textContent)).toEqual(['Choose…', 'Google Play'])
  })

  it('falls back to the Releases page for a request saved without its release', () => {
    expect(storeMediaRunPath({ kitId: 'k' })).toBe('/releases')
    expect(storeMediaRunPath({ releaseId: 'not-a-uuid' })).toBe('/releases')
    expect(storeMediaRunPath({ releaseId: RELEASE })).toBe(`/releases?release=${RELEASE}`)
  })
})
