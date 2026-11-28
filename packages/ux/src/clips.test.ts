// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { capFlows, clampCaps, CLIP_LIMITS, clipSlug, clipUploadBody, effectiveClipCaps, fetchClipCaps, hasTimeForScreen, parseFlow, uploadClips, type ClipResult } from './clips.js'
import type { SyncConfig } from './sync.js'

describe('parseFlow', () => {
  it('reads name:/a,/b', () => {
    expect(parseFlow('signup:/,/signup')).toEqual({ name: 'signup', paths: ['/', '/signup'] })
  })
  it('names a flow without a name after its first path', () => {
    expect(parseFlow('/pricing, /checkout')).toEqual({ name: '/pricing', paths: ['/pricing', '/checkout'] })
  })
  it('keeps a colon inside a path', () => {
    expect(parseFlow('/a:b')).toEqual({ name: '/a:b', paths: ['/a:b'] })
  })
  it('refuses a flow with no paths or a non-path', () => {
    expect(() => parseFlow('signup:')).toThrow(/no paths/)
    expect(() => parseFlow('signup:pricing')).toThrow(/single \//)
    expect(() => parseFlow('x://evil.example')).toThrow(/single \//)
  })
})

describe('caps', () => {
  it('records at most 5 flows of 6 screens, with unique names', () => {
    const flows = Array.from({ length: 7 }, (_, i) => ({ name: i < 2 ? 'Home' : `f${i}`, paths: Array.from({ length: 8 }, (_, j) => `/${j}`) }))
    const { flows: out, notes } = capFlows(flows)
    expect(out).toHaveLength(CLIP_LIMITS.maxFlows)
    expect(out.every((f) => f.paths.length === CLIP_LIMITS.maxPathsPerFlow)).toBe(true)
    expect(notes.join(' ')).toMatch(/first 5 of 7 flows/)
  })
  it('clamps seconds and bytes to the hard limits', () => {
    expect(clampCaps({})).toEqual({ maxSeconds: 30, maxBytes: 25 * 1024 * 1024 })
    expect(clampCaps({ maxSeconds: 600, maxBytes: 10 * 1024 ** 3 })).toEqual({ maxSeconds: 60, maxBytes: 100 * 1024 * 1024 })
    expect(clampCaps({ maxSeconds: 1, maxBytes: 10 }).maxSeconds).toBe(5)
    expect(clampCaps({ maxSeconds: Number.NaN }).maxSeconds).toBe(30)
  })
  it('stops before a screen would run past the limit', () => {
    expect(hasTimeForScreen(0, 0, 30)).toBe(true)
    expect(hasTimeForScreen(26_000, 2000, 30)).toBe(false)
    expect(hasTimeForScreen(20_000, 8000, 30)).toBe(true)
    expect(hasTimeForScreen(21_000, 8000, 30)).toBe(false)
  })
  it('slugs names for file names', () => {
    expect(clipSlug('Sign up!')).toBe('sign-up')
    expect(clipSlug('///')).toBe('flow')
  })
})

describe('uploadClips', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })
  const cfg: SyncConfig = { apiKey: 'mushi_k', projectId: '11111111-1111-4111-8111-111111111111', endpoint: 'https://api.test', mode: 'local' }

  function clip(): ClipResult {
    dir = mkdtempSync(join(tmpdir(), 'clips-'))
    const file = join(dir, 'signup.webm')
    writeFileSync(file, Buffer.from('webm-bytes'))
    return { name: 'signup', file, bytes: 10, durationMs: 12_345.6, width: 390, height: 844, paths: ['/', '/signup'] }
  }

  it('sends the kit upload body', () => {
    expect(clipUploadBody([clip()]).files[0]).toEqual({
      name: 'signup.webm', kind: 'clip', mime: 'video/webm', bytes: 10, source: 'playwright', platform: 'web',
      durationMs: 12346, width: 390, height: 844, surfacePath: '/', label: 'signup',
    })
  })

  it('reserves, PUTs the file, then finalizes with its sha256', async () => {
    const c = clip()
    const calls: Array<{ url: string; method?: string; body?: unknown; headers?: Record<string, string> }> = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body, headers: init?.headers as Record<string, string> })
      if (url.endsWith('/kit/uploads')) return new Response(JSON.stringify({ ok: true, data: { uploads: [{ name: 'signup.webm', assetId: 'a1', signedUrl: 'https://storage.test/put/a1' }] } }), { status: 201 })
      if (url.startsWith('https://storage.test/')) return new Response('', { status: 200 })
      return new Response(JSON.stringify({ ok: true, data: { id: 'a1', status: 'ready' } }), { status: 200 })
    }
    const out = await uploadClips(cfg, 'rel-1', [c], fetchImpl)
    expect(out).toEqual({ uploaded: [{ name: 'signup', assetId: 'a1' }], failed: [] })
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      `POST https://api.test/v1/admin/projects/${cfg.projectId}/releases/rel-1/kit/uploads`,
      'PUT https://storage.test/put/a1',
      `POST https://api.test/v1/admin/projects/${cfg.projectId}/releases/rel-1/kit/assets/a1/finalize`,
    ])
    expect(calls[1]!.headers).toEqual({ 'Content-Type': 'video/webm' })
    expect(calls[0]!.headers?.['X-Mushi-Api-Key']).toBe('mushi_k')
    const sha = createHash('sha256').update(Buffer.from('webm-bytes')).digest('hex')
    expect(JSON.parse(String(calls[2]!.body))).toEqual({ sha256: sha })
  })

  it('surfaces the server refusal when clips are off', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: false, error: { code: 'CLIPS_OFF', message: 'Recording clips is off for this app. Turn on "Record clips for release kits" in the kit first.' } }), { status: 403 })
    await expect(uploadClips(cfg, 'rel-1', [clip()], fetchImpl)).rejects.toThrow(/Recording clips is off for this app/)
  })

  it('reports a failed PUT without finalizing it', async () => {
    const urls: string[] = []
    const fetchImpl = async (url: string) => {
      urls.push(url)
      if (url.endsWith('/kit/uploads')) return new Response(JSON.stringify({ data: { uploads: [{ name: 'signup.webm', assetId: 'a1', signedUrl: 'https://storage.test/put/a1' }] } }), { status: 201 })
      return new Response('', { status: 500 })
    }
    const out = await uploadClips(cfg, 'rel-1', [clip()], fetchImpl)
    expect(out.failed).toEqual([{ name: 'signup', reason: 'storage answered 500' }])
    expect(urls.some((u) => u.endsWith('/finalize'))).toBe(false)
  })
})

describe('server clip caps (read before recording)', () => {
  const cfg: SyncConfig = { apiKey: 'mushi_k', projectId: '11111111-1111-4111-8111-111111111111', endpoint: 'https://api.test', mode: 'local' }
  const MB = 1024 * 1024
  const kit = (settings: unknown, status = 200) => async (url: string) => {
    expect(url).toBe('https://api.test/v1/admin/projects/11111111-1111-4111-8111-111111111111/releases/r1/kit')
    return new Response(JSON.stringify({ ok: status < 400, data: { settings } }), { status })
  }

  it('reads the app\'s caps from the release kit, and null when it cannot', async () => {
    expect(await fetchClipCaps(cfg, 'r1', kit({ clipsEnabled: true, clipMaxSeconds: 12, clipMaxMb: 5 }))).toEqual({ clipsEnabled: true, maxSeconds: 12, maxBytes: 5 * MB })
    expect(await fetchClipCaps(cfg, 'r1', kit({}, 403))).toBeNull()
    expect(await fetchClipCaps(cfg, 'r1', kit({ clipsEnabled: 'yes' }))).toBeNull()
    expect(await fetchClipCaps(cfg, 'r1', async () => { throw new Error('offline') })).toBeNull()
  })

  it('records within the lower of the asked and the app\'s caps', () => {
    const e = effectiveClipCaps({ maxSeconds: 30, maxBytes: 25 * MB }, { clipsEnabled: true, maxSeconds: 12, maxBytes: 5 * MB })
    expect(e).toMatchObject({ maxSeconds: 12, maxBytes: 5 * MB, blocked: null })
    expect(e.notes).toHaveLength(2)
    // Asking for less than the app allows keeps the smaller value and says nothing.
    expect(effectiveClipCaps({ maxSeconds: 10, maxBytes: 2 * MB }, { clipsEnabled: true, maxSeconds: 60, maxBytes: 100 * MB })).toEqual({ maxSeconds: 10, maxBytes: 2 * MB, notes: [], blocked: null })
  })

  it('records nothing when the app has clips off, and falls back to the local caps offline', () => {
    expect(effectiveClipCaps({ maxSeconds: 30 }, { clipsEnabled: false, maxSeconds: 30, maxBytes: 25 * MB }).blocked).toMatch(/Record clips for release kits/)
    const offline = effectiveClipCaps({ maxSeconds: 30, maxBytes: 25 * MB }, null)
    expect(offline).toMatchObject({ maxSeconds: 30, maxBytes: 25 * MB, blocked: null })
    expect(offline.notes[0]).toMatch(/using the local caps/)
  })
})
