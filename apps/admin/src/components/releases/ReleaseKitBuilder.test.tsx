/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/releases/ReleaseKitBuilder.test.tsx
 * PURPOSE: The release kit pairs before/after screenshots by screen, shows
 *          each asset's spec checks for the chosen preset as words (not
 *          colour alone), re-reads with ?preset= when the preset changes, and
 *          says plainly when no store connector is bound.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { ReleaseKitBuilder } from './ReleaseKitBuilder'

const PID = '11111111-1111-4111-8111-111111111111'
const RID = '22222222-2222-4222-8222-222222222222'

const asset = (over: Record<string, unknown>) => ({
  id: 'a', kind: 'screenshot_after', source: 'ux_surface', storage_path: `${PID}/kit/x.png`, mime: 'image/png', bytes: 2048, sha256: 'f'.repeat(64),
  width: 1440, height: 900, duration_ms: null, fps: null, codec: null, metadata_from: 'measured', platform: 'web',
  surface_path: '/pricing', viewport: 'desktop', label: null, status: 'ready', created_at: '2026-11-27T00:00:00Z',
  url: 'https://storage.test/signed/x.png', usableAs: null, checks: [],
  ...over,
})

const PRESETS = [
  { id: 'app_store_preview', label: 'App Store preview', output: { width: 886, height: 1920, minSeconds: 15, maxSeconds: 30, maxFps: 30, container: 'mp4', codec: 'h264', note: 'Up to 3 per language.' }, destination: 'App Store Connect' },
  { id: 'social_vertical', label: 'Social 9:16', output: { width: 1080, height: 1920, minSeconds: 6, maxSeconds: 60, maxFps: 30, container: 'mp4', codec: 'h264', note: 'Reels.' }, destination: 'lazycow publish_reel' },
]

function kit(over: Record<string, unknown> = {}) {
  return {
    kit: { id: 'k1', preset: 'app_store_preview', changelog: ['Faster checkout'], brand: { name: 'Acme', accent: '#3366ff', theme: null, logoUrl: null }, exportedAt: null, exportCount: 0 }, // mushi-mushi-allowlist: a project's own accent colour as test data, not a console colour
    release: { id: RID, version: '1.2.0', title: 'v1.2.0', status: 'draft', publishedAt: null, commitSha: null },
    assets: [
      asset({ id: 'b1', kind: 'screenshot_before', checks: [{ id: 'size', label: 'App Store size', state: 'fail', detail: '1440×900 is source material.' }] }),
      asset({ id: 'a1', kind: 'screenshot_after', checks: [{ id: 'size', label: 'App Store size', state: 'fail', detail: '1440×900 is source material.' }] }),
      asset({ id: 'v1', kind: 'clip', source: 'playwright', mime: 'video/webm', storage_path: `${PID}/kit/clip.webm`, url: 'https://storage.test/signed/clip.webm', duration_ms: 12000, metadata_from: 'declared', usableAs: 'footage', checks: [{ id: 'container', label: 'Container', state: 'pass', detail: 'WebM source footage.' }] }),
    ],
    readiness: { ready: true, screenshots: 2, videos: 1, problems: [], recommended: ['Recommended: a short recording of the app in use (optional).'] },
    presets: PRESETS,
    settings: { clipsEnabled: false, clipMaxSeconds: 30, clipMaxMb: 25 },
    storeTargets: [],
    storeActions: [],
    organizationId: 'org-1',
    ...over,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('ReleaseKitBuilder', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetchMutate.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render() {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ReleaseKitBuilder, { projectId: PID, releaseId: RID, canEdit: true })))
      await flush()
    })
  }

  it('pairs before and after by screen and shows each check in words', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: kit() })
    await render()
    expect(api.apiFetch).toHaveBeenCalledWith(`/v1/admin/projects/${PID}/releases/${RID}/kit`, { cache: 'no-store' })
    const pairs = container.querySelectorAll('[data-testid="kit-pairs"] > li')
    expect(pairs).toHaveLength(1)
    expect(pairs[0].textContent).toContain('/pricing')
    expect(pairs[0].textContent).toContain('Before')
    expect(pairs[0].textContent).toContain('After')
    expect(pairs[0].textContent).toContain('App Store size: no')
    const videos = container.querySelector('[data-testid="kit-videos"]')!
    expect(videos.querySelector('video')?.getAttribute('preload')).toBe('metadata')
    expect(videos.querySelector('video')?.hasAttribute('autoplay')).toBe(false)
    expect(videos.textContent).toContain('Container: ok')
    expect(videos.textContent).toContain('as footage')
    expect(container.querySelector('[data-testid="preset-spec"]')!.textContent).toContain('886×1920')
    expect(container.querySelector('[data-testid="kit-brand"]')!.textContent).toContain('Acme')
    expect(container.querySelector('[data-testid="store-uploads"]')!.textContent).toContain('No App Store Connect or Google Play connector')
  })

  it('saves a new preset and re-reads the checks for it', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: kit() })
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: { saved: true } })
    await render()
    const social = [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((b) => b.textContent === 'Social 9:16')!
    await act(async () => {
      social.click()
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith(`/v1/admin/projects/${PID}/releases/${RID}/kit`, { method: 'PUT', body: JSON.stringify({ preset: 'social_vertical' }) })
    expect(api.apiFetch).toHaveBeenLastCalledWith(`/v1/admin/projects/${PID}/releases/${RID}/kit?preset=social_vertical`, { cache: 'no-store' })
  })

  it('exports the kit and shows the hand-off for the video tool', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: kit() })
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: { kitUrl: 'https://storage.test/signed/manifest.json', expiresAt: '2026-11-28T10:00:00Z', preset: 'appstore-iphone', manifest: { schema: 'lazycow.release-kit', version: 1 } } })
    await render()
    const exportBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Export for a product video'))!
    await act(async () => {
      exportBtn.click()
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith(`/v1/admin/projects/${PID}/releases/${RID}/kit/export`, { method: 'POST', body: '{}' })
    expect(container.querySelector('[data-testid="kit-export"]')!.textContent).toContain('make_product_video({ kitUrl: "https://storage.test/signed/manifest.json", preset: "appstore-iphone" })')
  })

  it('reads an unapplied migration as a calm notice', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { code: 'MIGRATION_PENDING', message: 'not applied' } })
    await render()
    expect(container.textContent).toContain('not switched on for this server yet')
  })
})
