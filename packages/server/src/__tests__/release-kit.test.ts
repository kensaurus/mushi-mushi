/**
 * Plan 025 P5 / P6, ADR 0074: the release kit (presets, inline spec checks,
 * changelog lines, the manifest a video tool reads, upload caps) and store
 * media (MD5 for App Store commits, measured image sizes, the payload a
 * person approves, every asset pinned by SHA-256).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  brandFrom,
  buildManifest,
  changelogLines,
  checkAsset,
  EmptyKitError,
  LAZYCOW_PRESET,
  surfaceName,
  kitAssetPath,
  kitReadiness,
  storeUploadPayload,
  type KitAssetRow,
} from '../../supabase/functions/_shared/release-kit.ts'
import { refuseUpload } from '../../supabase/functions/_shared/release-kit-db.ts'
import {
  checkApplePreview,
  checkPlayImage,
  imageSize,
  isPlayPromoVideoUrl,
  md5Hex,
  parsePayloadAssets,
  pngHasAlpha,
} from '../../supabase/functions/_shared/connectors/store-media.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const KIT = '2000000a-0000-4000-8000-000000000000'
const SHA = 'a'.repeat(64)

/**
 * The JSON Schema 2020-12 keywords lazycow's product-kit.schema.json uses
 * (type, const, enum, required, properties, items, anyOf, oneOf, $ref into
 * $defs, string/number/array bounds, pattern, uniqueItems, format date /
 * date-time / uri). No new dependency for one contract test. Returns the
 * paths that fail; [] = valid.
 */
type Schema = Record<string, any>
function validateSchema(root: Schema, value: unknown, schema: Schema = root, path = '$'): string[] {
  if (schema.$ref) return validateSchema(root, value, root.$defs[String(schema.$ref).replace('#/$defs/', '')], path)
  const errs: string[] = []
  const t = schema.type
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (t === 'object' && !isObj(value)) return [`${path}: not an object`]
  if (t === 'array' && !Array.isArray(value)) return [`${path}: not an array`]
  if (t === 'string' && typeof value !== 'string') return [`${path}: not a string`]
  if (t === 'integer' && !Number.isInteger(value)) return [`${path}: not an integer`]
  if (t === 'number' && typeof value !== 'number') return [`${path}: not a number`]
  if ('const' in schema && value !== schema.const) errs.push(`${path}: not ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not one of ${schema.enum.join(', ')}`)
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`)
    if (schema.maxLength != null && value.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: does not match ${schema.pattern}`)
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errs.push(`${path}: not a date`)
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errs.push(`${path}: not a date-time`)
    if (schema.format === 'uri' && !/^[a-z][a-z0-9+.-]*:/i.test(value)) errs.push(`${path}: not a uri`)
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`)
    if (schema.maximum != null && value > schema.maximum) errs.push(`${path}: above ${schema.maximum}`)
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) errs.push(`${path}: not above ${schema.exclusiveMinimum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems}`)
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems}`)
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${path}: items not unique`)
    if (schema.items) value.forEach((v, i) => errs.push(...validateSchema(root, v, schema.items, `${path}[${i}]`)))
  }
  if (isObj(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}: missing ${k}`)
    for (const [k, sub] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) {
      if (k in value) errs.push(...validateSchema(root, value[k], sub, `${path}.${k}`))
    }
  }
  if (schema.anyOf && !schema.anyOf.some((s: Schema) => validateSchema(root, value, s, path).length === 0)) errs.push(`${path}: matches none of anyOf`)
  if (schema.oneOf && schema.oneOf.filter((s: Schema) => validateSchema(root, value, s, path).length === 0).length !== 1) errs.push(`${path}: does not match exactly one of oneOf`)
  return errs
}

/** A PNG header with only IHDR filled in (enough for imageSize / pngHasAlpha). */
function pngHeader(width: number, height: number, colorType = 2): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(b.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  b[24] = 8
  b[25] = colorType
  return b
}

function asset(p: Partial<KitAssetRow>): KitAssetRow {
  return {
    id: crypto.randomUUID(), kind: 'screenshot_after', source: 'ux_surface', storage_path: `${P}/${KIT}/screenshot_after-1-home.png`, mime: 'image/png',
    bytes: 1000, sha256: SHA, width: 1290, height: 2796, duration_ms: null, fps: null, codec: null, metadata_from: 'measured', platform: 'web',
    surface_path: '/', viewport: 'mobile', label: '/ after', status: 'ready', created_at: '2026-11-27T00:00:00Z', ...p,
  }
}

describe('store media helpers', () => {
  it('MD5 matches node:crypto (App Store commit checksum) across block boundaries', () => {
    expect(md5Hex(new Uint8Array())).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    for (const n of [55, 56, 63, 64, 65, 127, 128, 1000, 70_000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff)
      expect(md5Hex(bytes)).toBe(createHash('md5').update(bytes).digest('hex'))
    }
  })

  it('measures PNG and JPEG sizes from the file', () => {
    expect(imageSize(pngHeader(1290, 2796))).toEqual({ width: 1290, height: 2796 })
    expect(pngHasAlpha(pngHeader(10, 10, 6))).toBe(true)
    expect(pngHasAlpha(pngHeader(10, 10, 2))).toBe(false)
    // SOI, APP0 (len 4), SOF0 with height 500 and width 1024.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xf4, 0x04, 0x00, 0x03, 0x01, 0x22, 0x00])
    expect(imageSize(jpeg)).toEqual({ width: 1024, height: 500 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('checks Apple previews on the published spec, video metadata as declared', () => {
    const ok = checkApplePreview('IPHONE_67', { mime: 'video/mp4', bytes: 20e6, width: 886, height: 1920, durationMs: 20_000, fps: 30, codec: 'h264', metadataFrom: 'declared' })
    expect(ok.every((c) => c.state !== 'fail')).toBe(true)
    expect(ok.find((c) => c.id === 'duration')?.state).toBe('declared')
    const bad = checkApplePreview('IPHONE_67', { mime: 'video/webm', bytes: 20e6, width: 1080, height: 1920, durationMs: 40_000, fps: 60, codec: 'vp8', metadataFrom: 'declared' })
    expect(bad.filter((c) => c.state === 'fail').map((c) => c.id).sort()).toEqual(['codec', 'duration', 'format', 'fps', 'size'])
  })

  it('checks Play images: fixed sizes, 320–3840 px and 2.3:1, no alpha', () => {
    expect(checkPlayImage('featureGraphic', { mime: 'image/png', bytes: 1, width: 1024, height: 500, durationMs: null, fps: null, codec: null, metadataFrom: 'measured', hasAlpha: false }).every((c) => c.state === 'pass')).toBe(true)
    expect(checkPlayImage('phoneScreenshots', { mime: 'image/png', bytes: 1, width: 300, height: 2000, durationMs: null, fps: null, codec: null, metadataFrom: 'measured' }).some((c) => c.state === 'fail')).toBe(true)
    expect(checkPlayImage('phoneScreenshots', { mime: 'image/png', bytes: 1, width: 1080, height: 1920, durationMs: null, fps: null, codec: null, metadataFrom: 'measured', hasAlpha: true }).find((c) => c.id === 'alpha')?.state).toBe('fail')
  })

  it('takes a single YouTube video as the Play promo, nothing else', () => {
    expect(isPlayPromoVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isPlayPromoVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isPlayPromoVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe(false)
    expect(isPlayPromoVideoUrl('https://www.youtube.com/playlist?list=PL1')).toBe(false)
    expect(isPlayPromoVideoUrl('https://vimeo.com/1')).toBe(false)
  })

  it('validates payload assets as release-kit paths with a hash', () => {
    expect(parsePayloadAssets([{ path: `${P}/${KIT}/a.png`, sha256: SHA, bytes: 10, mime: 'image/png', fileName: 'a.png' }], 10)).toHaveLength(1)
    expect(parsePayloadAssets([{ path: '../etc/passwd', sha256: SHA, bytes: 10, mime: 'image/png', fileName: 'a.png' }], 10)).toMatch(/not a release-kit path/)
    expect(parsePayloadAssets([], 10)).toMatch(/no assets/)
  })
})

describe('the release kit', () => {
  it('turns release Markdown into short plain changelog lines', () => {
    const md = '## v1.4\n\n- **Faster** checkout ([#12](https://x))\n- Fixed the `login` loop\n* ' + 'x'.repeat(200)
    const lines = changelogLines(md)
    expect(lines.slice(0, 2)).toEqual(['Faster checkout (#12)', 'Fixed the login loop'])
    expect(lines[2]).toHaveLength(140)
    expect(changelogLines('Fixed one thing. Then another!')).toEqual(['Fixed one thing.', 'Then another!'])
  })

  it('takes brand tokens from the project and widget settings, with kit overrides', () => {
    expect(brandFrom({ name: 'Glot' }, { sdk_widget_accent: '#FF8800', sdk_widget_theme: 'dark' })).toEqual({ name: 'Glot', accent: '#ff8800', theme: 'dark', logoUrl: null })
    expect(brandFrom({ name: 'Glot' }, { sdk_widget_accent: 'red' }, { name: 'Glot it', logoUrl: 'http://insecure' })).toMatchObject({ name: 'Glot it', accent: null, logoUrl: null })
  })

  it('says a WebM clip is footage, not a store preview, and checks screenshots under the preset', () => {
    const clip = asset({ kind: 'clip', source: 'playwright', mime: 'video/webm', width: 390, height: 844, metadata_from: 'declared' })
    expect(checkAsset(clip, 'app_store_preview')).toMatchObject({ usableAs: 'footage' })
    expect(checkAsset(asset({}), 'app_store_preview')).toMatchObject({ usableAs: 'APP_IPHONE_67' })
    expect(checkAsset(asset({ width: 1440, height: 900 }), 'app_store_preview').checks[0].state).toBe('fail')
  })

  it('knows what a kit still needs, in lazycow\'s terms', () => {
    expect(kitReadiness([], 'social_vertical')).toMatchObject({ ready: false, problems: [expect.stringMatching(/needs something to show/)] })
    expect(kitReadiness([asset({})], 'social_vertical').ready).toBe(true)
    // App Store previews render from full-screen phone "after" screens alone; footage is only recommended.
    const phoneOnly = kitReadiness([asset({ width: 1290, height: 2796 })], 'app_store_preview')
    expect(phoneOnly).toMatchObject({ ready: true, problems: [] })
    expect(phoneOnly.recommended).toEqual([expect.stringMatching(/^Recommended: a short recording .*optional; screens alone work/)])
    // A phone viewport without a measured size counts as phone-shaped.
    expect(kitReadiness([asset({ width: null, height: null, viewport: 'mobile' })], 'app_store_preview').ready).toBe(true)
    // A desktop-only kit has nothing to show full screen on a phone.
    const desktop = kitReadiness([asset({ width: 1440, height: 900, viewport: 'desktop' })], 'app_store_preview')
    expect(desktop).toMatchObject({ ready: false, problems: [expect.stringMatching(/phone-shaped \(portrait\) "after" screen, or a recording/)] })
    // A recording alone is enough, and then nothing is recommended for the App Store.
    const clip = asset({ kind: 'device_recording', source: 'upload', mime: 'video/mp4', width: 886, height: 1920 })
    expect(kitReadiness([asset({ width: 1440, height: 900 }), clip], 'app_store_preview')).toMatchObject({ ready: true, problems: [], recommended: [] })
    // Social cuts recommend "before" screens; the rendered product video is not footage.
    const social = kitReadiness([asset({}), asset({ kind: 'product_video', source: 'lazycow', mime: 'video/mp4' })], 'social_vertical')
    expect(social.recommended).toHaveLength(2)
    expect(social.videos).toBe(1)
  })

  it('carries the release id in a store upload payload, so the team\'s action list can link to where it runs', () => {
    const shot = asset({})
    const r = storeUploadPayload(KIT, [shot], { kind: 'app_store_connect', action: 'upload_screenshots', externalId: '6761582648', locale: 'en-US', displayType: 'APP_IPHONE_67', assetIds: [shot.id], releaseId: 'r-1' })
    expect(r).toMatchObject({ ok: true, payload: { kitId: KIT, releaseId: 'r-1', appleId: '6761582648' } })
  })

  const manifestInput = (assets: KitAssetRow[], urls: Map<string, string>, preset: 'social_vertical' | 'app_store_preview' = 'social_vertical') => ({
    kitId: KIT, now: new Date('2026-11-27T00:00:00Z'), ttlSec: 3600, project: { id: P, name: 'Glot' },
    release: { id: 'r1', version: '1.4.0', title: 'Faster', status: 'published', publishedAt: '2026-11-26T09:00:00Z', commitSha: 'abc1234' },
    preset, brand: brandFrom({ name: 'Glot' }, { sdk_widget_accent: '#5B8CFF', sdk_widget_theme: 'dark' }), changelog: ['Faster checkout'],
    assets, urls, securityProof: { state: 'proven', headline: 'Security proof: scans green for abc1234.' },
    stores: ['app-store' as const], kitUrl: 'https://s.example/manifest.json?token=k', returnTo: '/v1/x',
  })

  it('builds lazycow\'s release-kit v1: screens with before/after, recordings, every asset signed with its size and hash', () => {
    const before = asset({ kind: 'screenshot_before', storage_path: `${P}/${KIT}/screenshot_before-1-home.png` })
    const after = asset({})
    const clip = asset({ kind: 'clip', source: 'playwright', mime: 'video/webm', width: 390, height: 844, surface_path: '/signup', label: 'signup', metadata_from: 'declared' })
    const pending = asset({ status: 'pending', kind: 'clip', mime: 'video/mp4' })
    const urls = new Map([[before.id, 'https://s.example/b?token=1'], [after.id, 'https://s.example/a?token=2'], [clip.id, 'https://s.example/c?token=3'], [pending.id, 'https://s.example/p']])
    const m = buildManifest(manifestInput([before, after, clip, pending], urls))
    expect(m).toMatchObject({ schema: 'lazycow.release-kit', version: 1, app: { name: 'Glot', stores: ['app-store'] }, release: { version: '1.4.0', date: '2026-11-26', title: 'Faster' } })
    expect(m.brand?.colors).toEqual({ primary: '#5b8cff', accent: '#5b8cff', background: '#0f1115', text: '#f4f5f7' })
    expect(m.screens).toEqual([{
      id: 'home-mobile', surface: 'Home', viewport: { width: 1290, height: 2796, device: 'phone', platform: 'web' },
      before: { url: 'https://s.example/b?token=1', type: 'image/png', bytes: 1000, sha256: SHA },
      after: { url: 'https://s.example/a?token=2', type: 'image/png', bytes: 1000, sha256: SHA },
    }])
    expect(m.recordings).toEqual([{ id: 'rec-signup', surface: 'signup', viewport: { width: 390, height: 844, device: 'phone', platform: 'web' }, file: { url: 'https://s.example/c?token=3', type: 'video/webm', bytes: 1000, sha256: SHA }, caption: 'signup' }])
    expect(m.changelog).toEqual(['Faster checkout'])
    expect(m.expiresAt).toBe('2026-11-27T01:00:00.000Z')
    // Mushi's own fields ride along under `mushi` (lazycow ignores unknown fields).
    expect(m.mushi.handoff).toEqual({ tool: 'make_product_video', args: { kitUrl: 'https://s.example/manifest.json?token=k', preset: 'social-9x16' }, returnTo: '/v1/x' })
    expect(m.mushi.assets.map((a) => a.id)).toEqual([before.id, after.id, clip.id])
    expect(m.mushi.preset.output).toMatchObject({ width: 1080, height: 1920 })
    expect(LAZYCOW_PRESET.app_store_preview).toBe('appstore-iphone')
  })

  it('refuses an empty kit, and never uses a relative or non-https asset link', () => {
    const after = asset({})
    expect(() => buildManifest(manifestInput([after], new Map([[after.id, '/relative/a.png']])))).toThrow(EmptyKitError)
    expect(() => buildManifest(manifestInput([], new Map()))).toThrow(EmptyKitError)
  })

  it('names screens from their path and keeps ids unique and within lazycow\'s pattern', () => {
    expect(surfaceName('/settings/billing', null)).toBe('Settings billing')
    expect(surfaceName('/', '/ after')).toBe('Home')
    expect(surfaceName('/p/3f2a9c1e-aaaa/edit', null)).toBe('P edit')
    const a = asset({ surface_path: '/x', label: null })
    const b = asset({ surface_path: '/x', label: null, viewport: 'mobile' })
    const m = buildManifest(manifestInput([a, b], new Map([[a.id, 'https://s.example/a'], [b.id, 'https://s.example/b']])))
    const ids = m.screens!.map((s) => s.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/)
  })

  it('validates against a copy of lazycow-studio docs/product-kit.schema.json (the contract)', () => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/lazycow-release-kit.schema.json'), 'utf8'))
    // The schema's own example passes, so the validator below reads it right.
    expect(validateSchema(schema, schema.examples[0])).toEqual([])
    const before = asset({ kind: 'screenshot_before' })
    const after = asset({ width: 2880, height: 18000, viewport: 'desktop' })
    const clip = asset({ kind: 'device_recording', source: 'upload', mime: 'video/mp4', width: null, height: null, viewport: null, platform: 'ios', label: 'Onboarding on iPhone' })
    const urls = new Map([[before.id, 'https://s.example/b?t=1'], [after.id, 'https://s.example/a?t=2'], [clip.id, 'https://s.example/c?t=3']])
    for (const preset of ['social_vertical', 'app_store_preview'] as const) {
      const m = buildManifest({ ...manifestInput([before, after, clip], urls, preset), changelog: Array.from({ length: 40 }, (_, i) => `Line ${i} ${'x'.repeat(200)}`) })
      expect(validateSchema(schema, m)).toEqual([])
    }
    // And it catches a broken one.
    expect(validateSchema(schema, { schema: 'lazycow.release-kit', version: 1, app: { name: 'x' } })).not.toEqual([])
  })

  it('names kit objects safely inside the project and kit folder', () => {
    expect(kitAssetPath(P, KIT, 'clip', 'Sign up / flow!!.webm', 3)).toBe(`${P}/${KIT}/clip-3-Sign-up-flow.webm`)
  })

  it('caps uploads: clips opt-in, size and length limits, a video count', () => {
    const settings = { clipsEnabled: false, clipMaxSeconds: 30, clipMaxMb: 25 }
    const clip = { name: 'signup.webm', kind: 'clip' as const, mime: 'video/webm' as const, bytes: 5e6, source: 'playwright' as const, durationMs: 20_000 }
    expect(refuseUpload(clip, settings, 0)?.code).toBe('CLIPS_OFF')
    expect(refuseUpload(clip, { ...settings, clipsEnabled: true }, 0)).toBeNull()
    expect(refuseUpload({ ...clip, durationMs: 45_000 }, { ...settings, clipsEnabled: true }, 0)?.code).toBe('TOO_LONG')
    expect(refuseUpload({ ...clip, bytes: 30 * 1048576 }, { ...settings, clipsEnabled: true }, 0)?.code).toBe('TOO_LARGE')
    expect(refuseUpload({ ...clip, kind: 'device_recording', source: 'upload', mime: 'video/mp4' }, settings, 12)?.code).toBe('TOO_MANY')
    // A person's own device recording does not need the clip opt-in.
    expect(refuseUpload({ ...clip, kind: 'device_recording', source: 'upload', mime: 'video/mp4' }, settings, 0)).toBeNull()
  })
})

describe('store upload payloads', () => {
  const shot = asset({})
  it('pins every asset by path and SHA-256 for the approval', () => {
    const r = storeUploadPayload(KIT, [shot], { kind: 'app_store_connect', action: 'upload_screenshots', externalId: '6761582648', locale: 'en-US', displayType: 'APP_IPHONE_67', assetIds: [shot.id] })
    expect(r).toEqual({ ok: true, payload: { kitId: KIT, appleId: '6761582648', locale: 'en-US', displayType: 'APP_IPHONE_67', assets: [{ path: shot.storage_path, sha256: SHA, bytes: 1000, mime: 'image/png', fileName: 'screenshot_after-1-home.png' }] } })
  })

  it('refuses an asset that fails the target\'s spec, is not ready, or is not in the kit', () => {
    expect(storeUploadPayload(KIT, [shot], { kind: 'app_store_connect', action: 'upload_screenshots', externalId: '1', locale: 'en-US', displayType: 'APP_IPAD_PRO_3GEN_129', assetIds: [shot.id] })).toMatchObject({ ok: false, message: expect.stringMatching(/Size/) })
    const pending = asset({ status: 'pending', sha256: null })
    expect(storeUploadPayload(KIT, [pending], { kind: 'play_console', action: 'upload_listing_images', externalId: 'com.x.app', locale: 'en-US', imageType: 'phoneScreenshots', assetIds: [pending.id] })).toMatchObject({ ok: false })
    expect(storeUploadPayload(KIT, [], { kind: 'play_console', action: 'upload_listing_images', externalId: 'com.x.app', locale: 'en-US', imageType: 'phoneScreenshots', assetIds: [shot.id] })).toMatchObject({ ok: false, message: 'An asset is not in this kit.' })
    expect(storeUploadPayload(KIT, [], { kind: 'play_console', action: 'upload_screenshots', externalId: 'com.x.app', locale: 'en-US', assetIds: [] })).toMatchObject({ ok: false })
  })

  it('builds the Play promo payload from a YouTube URL', () => {
    expect(storeUploadPayload(KIT, [], { kind: 'play_console', action: 'set_promo_video', externalId: 'com.x.app', locale: 'en-US', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', assetIds: [] }))
      .toEqual({ ok: true, payload: { kitId: KIT, package: 'com.x.app', language: 'en-US', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' } })
  })
})

describe('baselines from ux_baselines (loop-timeline, migration 20261127130000_ux_timeline)', () => {
  it('pairs this release (by id, or by version once the release row is gone) with the previous one, newest capture winning', async () => {
    const { uxBaselinesSource } = await import('../../supabase/functions/_shared/release-kit-db.ts')
    const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')
    const row = (r: Record<string, unknown>) => ({ project_id: P, surface_key: 'settings', path: '/settings', label: 'Settings', viewport: 'mobile', release_id: null, score: 7, ...r })
    const db = makeFakeDb({
      ux_baselines: [
        row({ release_id: 'r-new', version: '1.4.0', capture_path: `${P}/baselines/settings-new-old.png`, created_at: '2026-11-26T00:00:00Z' }),
        row({ release_id: 'r-new', version: '1.4.0', capture_path: `${P}/baselines/settings-new.png`, created_at: '2026-11-27T00:00:00Z' }),
        row({ version: '1.3.0', capture_path: `${P}/baselines/settings-old.png`, created_at: '2026-11-01T00:00:00Z' }),
        row({ surface_key: 'home', path: '/', label: 'Home', version: '1.3.0', capture_path: `${P}/baselines/home-old.png`, created_at: '2026-11-01T00:00:00Z' }),
        row({ release_id: 'r-other', version: '0.9.0', capture_path: `${P}/baselines/settings-ancient.png`, created_at: '2026-01-01T00:00:00Z' }),
      ],
    })
    const release = { id: 'r-new', project_id: P, version: '1.4.0', title: 'x', body_md: '', status: 'published', published_at: '2026-11-27T01:00:00Z', created_at: '2026-11-27T00:00:00Z', commit_sha: null }
    const pairs = await uxBaselinesSource.pairs(db as never, release, { id: 'r-prev', version: '1.3.0', published_at: '2026-11-02T00:00:00Z' })
    expect(pairs).toEqual([{
      surfacePath: '/settings', label: 'Settings', viewport: 'mobile', source: 'ux_baseline',
      before: { bucket: 'ux-captures', path: `${P}/baselines/settings-old.png`, score: 7, capturedAt: '2026-11-01T00:00:00Z' },
      after: { bucket: 'ux-captures', path: `${P}/baselines/settings-new.png`, score: 7, capturedAt: '2026-11-27T00:00:00Z' },
    }])
  })

  it('reads as "not there" (null) when the table is missing, so the kit falls back to UX-run thumbnails', async () => {
    const { uxBaselinesSource } = await import('../../supabase/functions/_shared/release-kit-db.ts')
    const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')
    const db = makeFakeDb({}, { failRead: (t) => (t === 'ux_baselines' ? { code: '42P01', message: 'relation "ux_baselines" does not exist' } : null) })
    const release = { id: 'r', project_id: P, version: '1', title: 'x', body_md: '', status: 'draft', published_at: null, created_at: '', commit_sha: null }
    expect(await uxBaselinesSource.pairs(db as never, release, null)).toBeNull()
  })
})
