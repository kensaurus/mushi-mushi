/**
 * FILE: apps/admin/src/lib/releaseShipView.test.ts
 * PURPOSE: The pure parts of a release's "Ship it" section: before/after
 *          pairing, dedupe wording, the store-upload body the server's
 *          storeSchema takes, changelog limits and the hand-off snippet.
 */

import { describe, expect, it } from 'vitest'
import {
  assetsForAction,
  connectorClass,
  dedupeText,
  defaultStoreForm,
  handoffSnippet,
  laneFindings,
  pairScreenshots,
  parseChangelog,
  proveCommand,
  severitySummary,
  storeUploadBody,
  type KitAsset,
  type ProofFinding,
  type StoreTarget,
} from './releaseShipView'

function asset(over: Partial<KitAsset>): KitAsset {
  return {
    id: 'a', kind: 'screenshot_after', source: 'ux_surface', storage_path: 'p/k/x.png', mime: 'image/png', bytes: 10, sha256: 'f'.repeat(64),
    width: 1290, height: 2796, duration_ms: null, fps: null, codec: null, metadata_from: 'measured', platform: 'web',
    surface_path: '/', viewport: 'mobile', label: null, status: 'ready', created_at: '2026-11-27T00:00:00Z', url: null, usableAs: null, checks: [],
    ...over,
  }
}

const ASC: StoreTarget = { connectorId: 'c1', kind: 'app_store_connect', name: 'ASC', externalId: '6761582648', actEnabled: true, actions: ['upload_screenshots', 'upload_app_preview'] }
const PLAY: StoreTarget = { connectorId: 'c2', kind: 'play_console', name: 'Play', externalId: 'com.example.app', actEnabled: true, actions: ['upload_listing_images', 'set_promo_video'] }

describe('releaseShipView', () => {
  it('pairs before and after by screen and viewport', () => {
    const pairs = pairScreenshots([
      asset({ id: 'b1', kind: 'screenshot_before', surface_path: '/pricing' }),
      asset({ id: 'a1', kind: 'screenshot_after', surface_path: '/pricing' }),
      asset({ id: 'a2', kind: 'screenshot_after', surface_path: '/', viewport: 'desktop' }),
      asset({ id: 'v1', kind: 'clip', mime: 'video/webm' }),
    ])
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ surfacePath: '/pricing', before: { id: 'b1' }, after: { id: 'a1' } })
    expect(pairs[1]).toMatchObject({ surfacePath: '/', before: null, after: { id: 'a2' } })
  })

  it('explains why a finding has no report of its own', () => {
    expect(dedupeText('vuln_watch')).toBe('Already tracked by Known holes')
    expect(dedupeText('daily_limit')).toMatch(/tomorrow/)
    expect(dedupeText(null)).toBeNull()
  })

  it('sorts a lane\'s findings worst first and summarises severities', () => {
    const f = (id: string, severity: string, lane = 'secrets'): ProofFinding => ({ id, lane, severity, title: id, rule_id: 'r', location: {}, report_id: null, deduped_by: null })
    expect(laneFindings([f('a', 'low'), f('b', 'critical'), f('c', 'high', 'dast')], 'secrets').map((x) => x.id)).toEqual(['b', 'a'])
    expect(severitySummary({ critical: 0, high: 2, medium: 1, low: 0, info: 0, total: 3 })).toBe('2 high · 1 medium')
  })

  it('colours a connector green only when both lanes are clean', () => {
    expect(connectorClass('ok', 'ok')).toContain('bg-ok')
    expect(connectorClass('ok', 'neutral')).toBe('bg-edge-subtle')
    expect(connectorClass('warn', 'ok')).toContain('bg-warn')
    expect(connectorClass('ok', 'danger')).toContain('bg-danger')
  })

  it('builds the store-upload body the server takes', () => {
    const f = { ...defaultStoreForm(ASC), assetIds: ['a1'] }
    expect(storeUploadBody(ASC, f)).toEqual({ connectorId: 'c1', action: 'upload_screenshots', locale: 'en-US', displayType: 'APP_IPHONE_67', assetIds: ['a1'] })
    expect(storeUploadBody(ASC, { ...f, action: 'upload_app_preview', deviceType: 'IPHONE_67' })).toMatchObject({ previewType: 'IPHONE_67', assetIds: ['a1'] })
    expect(storeUploadBody(PLAY, { ...defaultStoreForm(PLAY), assetIds: ['a1'], replace: true })).toEqual({ connectorId: 'c2', action: 'upload_listing_images', locale: 'en-US', imageType: 'phoneScreenshots', replace: true, assetIds: ['a1'] })
    expect(storeUploadBody(PLAY, { ...defaultStoreForm(PLAY), action: 'set_promo_video', youtubeUrl: ' https://youtu.be/abcdefghijk ' })).toEqual({ connectorId: 'c2', action: 'set_promo_video', locale: 'en-US', youtubeUrl: 'https://youtu.be/abcdefghijk', assetIds: [] })
  })

  it('offers only files a store action can take', () => {
    const list = [asset({ id: 'png' }), asset({ id: 'webm', mime: 'video/webm' }), asset({ id: 'mp4', mime: 'video/mp4' }), asset({ id: 'pending', status: 'pending' })]
    expect(assetsForAction(list, 'upload_screenshots').map((a) => a.id)).toEqual(['png'])
    expect(assetsForAction(list, 'upload_app_preview').map((a) => a.id)).toEqual(['mp4'])
  })

  it('holds the changelog to 12 lines of 140 characters', () => {
    expect(parseChangelog('one\n\n two ').lines).toEqual(['one', 'two'])
    expect(parseChangelog(Array.from({ length: 13 }, (_, i) => `l${i}`).join('\n')).problem).toMatch(/At most 12/)
    expect(parseChangelog('x'.repeat(141)).problem).toMatch(/Line 1/)
  })

  it('writes the commands a person copies', () => {
    expect(proveCommand('abc1234')).toBe('gh workflow run mushi-security.yml -f sha=abc1234')
    expect(handoffSnippet('https://k/manifest.json', 'social-9x16')).toBe('make_product_video({ kitUrl: "https://k/manifest.json", preset: "social-9x16" })')
  })
})
