/**
 * Plan 025 P6 / ADR 0074: store media uploads through the approved
 * connector-actions path, against fixtures only (no App Store Connect or
 * Google Play call is ever made). Each act re-checks the approved payload
 * hash, downloads every asset and re-hashes it before a byte leaves for the
 * store, and sends no credential to Apple's pre-signed upload URLs.
 */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

type Registry = typeof import('../../supabase/functions/_shared/connectors/index.ts')
let registry: Registry
let canonical: typeof import('../../supabase/functions/_shared/connectors/canonical.ts')
let jwt: typeof import('../../supabase/functions/_shared/connectors/jwt.ts')
let media: typeof import('../../supabase/functions/_shared/connectors/store-media-act.ts')
let actions: typeof import('../../supabase/functions/_shared/connector-actions.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  registry = await import('../../supabase/functions/_shared/connectors/index.ts')
  canonical = await import('../../supabase/functions/_shared/connectors/canonical.ts')
  jwt = await import('../../supabase/functions/_shared/connectors/jwt.ts')
  media = await import('../../supabase/functions/_shared/connectors/store-media-act.ts')
  actions = await import('../../supabase/functions/_shared/connector-actions.ts')
})

const P = '1000000a-0000-4000-8000-000000000000'
const KIT = '2000000a-0000-4000-8000-000000000000'
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const ASC_KEY = JSON.stringify({ keyId: 'ABC123', issuerId: 'iss', privateKey: ec })
const PLAY_SA = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: rsa })

function png(width: number, height: number, size = 3000): Uint8Array {
  const b = new Uint8Array(size).map((_, i) => (i * 13) & 0xff)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(b.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  b[24] = 8
  b[25] = 2
  return b
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** A db whose storage holds the given objects (path → bytes). */
function storageDb(objects: Record<string, Uint8Array>) {
  return {
    from: () => { throw new Error('no table reads in act') },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          if (bucket !== 'release-kits' || !objects[path]) return { data: null, error: { message: 'not found' } }
          return { data: new Blob([objects[path]]), error: null }
        },
      }),
    },
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Call = { method: string; url: string; headers: Record<string, string>; bytes: number }

function recorder(handler: (c: Call, init?: RequestInit) => Response) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    const body = init?.body
    const bytes = body instanceof Uint8Array ? body.length : typeof body === 'string' ? body.length : 0
    const c = { method: init?.method ?? 'GET', url, headers, bytes }
    calls.push(c)
    return handler(c, init)
  }
  return { calls, fetchImpl }
}

async function approved(action: string, payload: Record<string, unknown>) {
  return { id: 'a1', action, payload, payloadSha256: await jwt.sha256Hex(canonical.canonicalJson(payload)) }
}

function ctx(db: unknown, fetchImpl: (u: string, i?: RequestInit) => Promise<Response>, write: string | null, withUploaders = true) {
  return {
    db, organizationId: 'org-1', projectId: P, instanceId: 'inst-1', readCredential: write, writeCredential: write, config: {}, fetch: fetchImpl,
    now: () => new Date('2026-11-27T12:00:00Z'),
    // Injected only by api-ext's release-kit execute route (the api bundle never carries them).
    ...(withUploaders ? { storeMedia: media.storeMediaActs } : {}),
  }
}

describe('App Store Connect: upload_screenshots', () => {
  const bytes = png(1290, 2796)
  const path = `${P}/${KIT}/screenshot_after-1-home.png`
  const payload = { kitId: KIT, appleId: '6761582648', locale: 'en-US', displayType: 'APP_IPHONE_67', assets: [{ path, sha256: sha256(bytes), bytes: bytes.length, mime: 'image/png', fileName: 'screenshot_after-1-home.png' }] }

  const apple = (c: Call, init?: RequestInit) => {
    if (c.url.includes('/appStoreVersions?')) return json(200, { data: [{ id: 'v-live', attributes: { versionString: '1.3', appVersionState: 'READY_FOR_DISTRIBUTION' } }, { id: 'v-next', attributes: { versionString: '1.4', appVersionState: 'PREPARE_FOR_SUBMISSION' } }] })
    if (c.url.includes('/appStoreVersions/v-next/appStoreVersionLocalizations')) return json(200, { data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }] })
    if (c.url.includes('/appScreenshotSets?')) return json(200, { data: [] })
    if (c.method === 'POST' && c.url.endsWith('/v1/appScreenshotSets')) return json(201, { data: { id: 'set-1' } })
    if (c.method === 'POST' && c.url.endsWith('/v1/appScreenshots')) {
      const half = Math.floor(bytes.length / 2)
      return json(201, { data: { id: 'shot-1', attributes: { uploadOperations: [
        { method: 'PUT', url: 'https://store-030.blobstore.apple.com/part1', offset: 0, length: half, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] },
        { method: 'PUT', url: 'https://store-030.blobstore.apple.com/part2', offset: half, length: bytes.length - half, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] },
      ] } } })
    }
    if (c.url.startsWith('https://store-030.blobstore.apple.com/')) return new Response(null, { status: 200 })
    if (c.method === 'PATCH' && c.url.endsWith('/v1/appScreenshots/shot-1')) {
      const body = JSON.parse(String(init?.body))
      expect(body.data.attributes).toEqual({ uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') })
      return json(200, { data: { id: 'shot-1' } })
    }
    return json(404, {})
  }

  it('reserves, uploads each part without a JWT, and commits with the MD5', async () => {
    const { calls, fetchImpl } = recorder(apple)
    const c = registry.getConnector('app_store_connect')
    expect(c.capabilities).toContain('act')
    expect(c.actions).toEqual(['upload_screenshots', 'upload_app_preview'])
    const r = await c.act!(ctx(storageDb({ [path]: bytes }), fetchImpl, ASC_KEY) as never, await approved('upload_screenshots', payload))
    expect(r).toMatchObject({ ok: true, result: { setId: 'set-1', uploaded: ['shot-1'], version: '1.4' } })
    const puts = calls.filter((x) => x.url.startsWith('https://store-030'))
    expect(puts).toHaveLength(2)
    expect(puts.reduce((n, x) => n + x.bytes, 0)).toBe(bytes.length)
    for (const p of puts) expect(Object.keys(p.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
    for (const x of calls.filter((y) => y.url.startsWith('https://api.appstoreconnect.apple.com'))) expect(x.headers.Authorization).toMatch(/^Bearer /)
  })

  it('sends nothing to Apple when the stored file changed after approval', async () => {
    const { calls, fetchImpl } = recorder(apple)
    const changed = png(1290, 2796, 3001)
    const r = await registry.getConnector('app_store_connect').act!(ctx(storageDb({ [path]: changed }), fetchImpl, ASC_KEY) as never, await approved('upload_screenshots', payload))
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/changed (size )?after it was approved/)
    expect(calls).toHaveLength(0)
  })

  it('refuses a payload that does not match the approved hash, and runs without a write key nowhere', async () => {
    const { calls, fetchImpl } = recorder(apple)
    const c = registry.getConnector('app_store_connect')
    expect((await c.act!(ctx(storageDb({}), fetchImpl, ASC_KEY) as never, { ...(await approved('upload_screenshots', payload)), payloadSha256: 'f'.repeat(64) })).detail).toMatch(/does not match/)
    expect((await c.act!(ctx(storageDb({}), fetchImpl, null) as never, await approved('upload_screenshots', payload))).detail).toMatch(/No write key/)
    expect(calls).toHaveLength(0)
  })

  it('says so when no version can take media', async () => {
    const { fetchImpl } = recorder((c) => (c.url.includes('/appStoreVersions?') ? json(200, { data: [{ id: 'v', attributes: { appVersionState: 'WAITING_FOR_REVIEW' } }] }) : json(404, {})))
    const r = await registry.getConnector('app_store_connect').act!(ctx(storageDb({ [path]: bytes }), fetchImpl, ASC_KEY) as never, await approved('upload_screenshots', payload))
    expect(r).toMatchObject({ ok: false, detail: expect.stringMatching(/No App Store version can take new media/) })
  })

  it('refuses an app preview that is not .mov/.mp4 before reading it', async () => {
    const { calls, fetchImpl } = recorder(apple)
    const p = { kitId: KIT, appleId: '6761582648', locale: 'en-US', previewType: 'IPHONE_67', assets: [{ path: `${P}/${KIT}/clip-1-a.webm`, sha256: 'b'.repeat(64), bytes: 10, mime: 'video/webm', fileName: 'clip-1-a.webm' }] }
    const r = await registry.getConnector('app_store_connect').act!(ctx(storageDb({}), fetchImpl, ASC_KEY) as never, await approved('upload_app_preview', p))
    expect(r).toMatchObject({ ok: false, detail: expect.stringMatching(/app previews are \.mov/) })
    expect(calls).toHaveLength(0)
  })
})

describe('Google Play: listing images and the promo video', () => {
  const shot = png(1080, 1920)
  const path = `${P}/${KIT}/screenshot_after-1-home.png`
  const play = (c: Call) => {
    if (c.url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'tok' })
    if (c.method === 'POST' && c.url.endsWith('/edits')) return json(200, { id: 'edit-9' })
    if (c.url.includes('/upload/androidpublisher/')) return json(200, { image: { id: 'img' } })
    if (c.method === 'PATCH' && c.url.endsWith('/edits/edit-9/listings/en-US')) return json(200, {})
    if (c.url.endsWith(':commit')) return json(200, { id: 'edit-9' })
    if (c.method === 'DELETE') return json(200, {})
    return json(404, {})
  }

  it('uploads phone screenshots through the media upload base in one committed edit', async () => {
    const { calls, fetchImpl } = recorder(play)
    const payload = { kitId: KIT, package: 'com.glotit.app', language: 'en-US', imageType: 'phoneScreenshots', replace: false, assets: [{ path, sha256: sha256(shot), bytes: shot.length, mime: 'image/png', fileName: 'screenshot_after-1-home.png' }] }
    const r = await registry.getConnector('play_console').act!(ctx(storageDb({ [path]: shot }), fetchImpl, PLAY_SA) as never, await approved('upload_listing_images', payload))
    expect(r).toMatchObject({ ok: true, result: { editId: 'edit-9', imageType: 'phoneScreenshots' } })
    const upload = calls.find((x) => x.url.includes('/upload/androidpublisher/v3/applications/com.glotit.app/edits/edit-9/listings/en-US/phoneScreenshots?uploadType=media'))
    expect(upload).toMatchObject({ method: 'POST', bytes: shot.length })
    expect(upload!.headers['Content-Type']).toBe('image/png')
    expect(calls.some((x) => x.url.endsWith('/edits/edit-9:commit'))).toBe(true)
  })

  it('refuses an image Play would reject before asking Google for a token', async () => {
    const { calls, fetchImpl } = recorder(play)
    const wrong = png(1000, 1000)
    const payload = { kitId: KIT, package: 'com.glotit.app', language: 'en-US', imageType: 'featureGraphic', assets: [{ path, sha256: sha256(wrong), bytes: wrong.length, mime: 'image/png', fileName: 'fg.png' }] }
    const r = await registry.getConnector('play_console').act!(ctx(storageDb({ [path]: wrong }), fetchImpl, PLAY_SA) as never, await approved('upload_listing_images', payload))
    expect(r).toMatchObject({ ok: false, detail: expect.stringMatching(/needs 1024×500/) })
    expect(calls).toHaveLength(0)
  })

  it('sets the promo video as the listing\'s YouTube URL, and refuses anything else', async () => {
    const { calls, fetchImpl } = recorder(play)
    const ok = await registry.getConnector('play_console').act!(ctx(storageDb({}), fetchImpl, PLAY_SA) as never, await approved('set_promo_video', { kitId: KIT, package: 'com.glotit.app', language: 'en-US', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }))
    expect(ok.ok).toBe(true)
    expect(calls.some((x) => x.method === 'PATCH' && x.url.endsWith('/listings/en-US'))).toBe(true)
    const bad = await registry.getConnector('play_console').act!(ctx(storageDb({}), fetchImpl, PLAY_SA) as never, await approved('set_promo_video', { kitId: KIT, package: 'com.glotit.app', language: 'en-US', youtubeUrl: 'https://example.com/video.mp4' }))
    expect(bad).toMatchObject({ ok: false, detail: expect.stringMatching(/single YouTube video URL/) })
  })
})

describe('the uploaders run only where they are injected', () => {
  it('a connector without ctx.storeMedia refuses and sends nothing', async () => {
    const { calls, fetchImpl } = recorder(() => json(200, {}))
    const payload = { kitId: KIT, package: 'com.glotit.app', language: 'en-US', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }
    const r = await registry.getConnector('play_console').act!(ctx(storageDb({}), fetchImpl, PLAY_SA, false) as never, await approved('set_promo_video', payload))
    expect(r).toMatchObject({ ok: false, code: 'USE_RELEASE_KIT' })
    expect(calls).toHaveLength(0)
  })

  it('the generic execute route refuses a media action without claiming it, so the approval stays usable', async () => {
    const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')
    const payload = { kitId: KIT, package: 'com.glotit.app', language: 'en-US', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }
    const a = await approved('set_promo_video', payload)
    const db = makeFakeDb({ connector_actions: [{ id: 'act-1', organization_id: 'org-1', project_id: P, connector_instance_id: 'inst-1', action: a.action, payload, payload_sha256: a.payloadSha256, status: 'approved', requested_at: '2026-11-27T11:00:00Z', expires_at: '2026-11-27T12:30:00Z' }] })
    const r = await actions.executeConnectorAction(db as never, 'act-1', 'org-1', 'owner', { fetch: async () => json(500, {}), now: () => new Date('2026-11-27T12:00:00Z') })
    expect(r).toMatchObject({ ok: false, code: 'USE_RELEASE_KIT', status: 400 })
    expect((db as unknown as { tables: Record<string, Array<Record<string, unknown>>> }).tables.connector_actions[0].status).toBe('approved')
  })
})

describe('tenancy: a store upload reads only this app\'s kit', () => {
  it('refuses an asset outside <project>/<kit>/ before reading any byte', async () => {
    const other = '9000000a-0000-4000-8000-000000000000'
    const bytes = png(1290, 2796)
    const path = `${other}/${KIT}/screenshot_after-1-home.png`
    const payload = { kitId: KIT, appleId: '6761582648', locale: 'en-US', displayType: 'APP_IPHONE_67', assets: [{ path, sha256: sha256(bytes), bytes: bytes.length, mime: 'image/png', fileName: 'screenshot_after-1-home.png' }] }
    const { calls, fetchImpl } = recorder(() => json(200, {}))
    let read = false
    const db = { storage: { from: () => ({ download: async () => { read = true; return { data: new Blob([bytes]), error: null } } }) } }
    const r = await registry.getConnector('app_store_connect').act!(ctx(db, fetchImpl, ASC_KEY) as never, await approved('upload_screenshots', payload))
    expect(r).toMatchObject({ ok: false, detail: expect.stringMatching(/not in this app's release kit/) })
    expect(read).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('the generic request path refuses store media actions; only the kit route may ask', async () => {
    const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')
    const db = makeFakeDb({ connector_instances: [{ id: 'inst-1', kind: 'play_console', organization_id: 'org-1' }], connector_actions: [] }, { autoId: true })
    const input = { organizationId: 'org-1', instanceId: 'inst-1', action: 'set_promo_video', payload: { kitId: KIT, package: 'com.glotit.app', language: 'en-US', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }, requestedBy: 'agent:x', projectId: P }
    expect(await actions.requestConnectorAction(db as never, input)).toMatchObject({ ok: false, code: 'USE_RELEASE_KIT' })
    expect(await actions.requestConnectorAction(db as never, input, { storeMediaFromKit: true })).toMatchObject({ ok: true })
  })
})
