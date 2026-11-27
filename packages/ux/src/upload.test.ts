import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readScreens, uploadCaptures } from './upload.js'
import type { SyncConfig } from './sync.js'

function png(width = 1080, height = 2400): Buffer {
  const b = Buffer.alloc(40)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b)
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

const dirs: string[] = []
function captures(screens: Record<string, Record<string, Buffer | string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-upload-'))
  dirs.push(dir)
  for (const [name, files] of Object.entries(screens)) {
    mkdirSync(join(dir, 'pages', name), { recursive: true })
    for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, 'pages', name, file), body)
  }
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const cfg: SyncConfig = { apiKey: 'mk_test', projectId: '1a000000-0000-4000-8000-000000000000', endpoint: 'https://api.test', mode: 'local' }

describe('readScreens', () => {
  it('reads each screen, its shots and the words from its dump', () => {
    const dir = captures({
      welcome: { 'early.png': png(), 'settled.png': png(), 'window.xml': '<hierarchy><node text="Hello" clickable="false" bounds="[0,0][10,10]"/><node text="Start" clickable="true" bounds="[0,0][10,10]"/></hierarchy>' },
      checkout: { 'settled.png': png(), 'facts.json': JSON.stringify({ key: '/checkout', label: 'Checkout' }) },
      notes: { 'readme.txt': 'no screenshot here' },
    })
    const s = readScreens(dir, { scale: 2 })
    expect(s.map((x) => x.facts.key)).toEqual(['/checkout', '/welcome'])
    expect(s[1]!.shots).toEqual(['early', 'settled'])
    expect(s[1]!.facts).toMatchObject({ text: 'Hello\nStart', controls: ['Start'], viewport: { width: 540, height: 1200 } })
    expect(s[0]!.facts.label).toBe('Checkout')
  })

  it('refuses a folder without pages, a file that is not a PNG, and two screens with one key', () => {
    expect(() => readScreens(captures({}))).toThrow(/pages/)
    expect(() => readScreens(captures({ a: { 'settled.png': 'not a png' } }))).toThrow(/not a PNG.*PowerShell/)
    expect(() => readScreens(captures({ a: { 'settled.png': png(), 'facts.json': '{"key":"/same"}' }, b: { 'settled.png': png(), 'facts.json': '{"key":"/same"}' } }))).toThrow(/Two screens/)
  })
})

describe('uploadCaptures', () => {
  it('opens the run, PUTs each PNG to its signed URL, scores each screen, groups and closes the run', async () => {
    const dir = captures({ welcome: { 'settled.png': png() }, 'sign-up': { 'early.png': png(), 'settled.png': png() } })
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body ? '<png>' : null
      calls.push({ url, method: init.method ?? 'GET', body })
      const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ ok: true, data }), { status })
      if (url === 'https://api.test/v1/ux/captures') {
        const pages = (body as { pages: Array<{ facts: { key: string }; shots: string[] }> }).pages
        const uploads = pages.flatMap((p) => p.shots.map((s) => ({ page: p.facts.key, name: `${p.facts.key.slice(1)}/${s}.png`, signedUrl: `https://storage.test/${p.facts.key.slice(1)}/${s}.png` })))
        return ok({ runId: '20261127-100000-abcd', reservedUsd: 0.18, uploads }, 201)
      }
      if (url.startsWith('https://storage.test/')) return new Response('', { status: 200 })
      if (url.endsWith('/score')) return ok({ score: { overall: 7 } })
      if (url.endsWith('/group')) return ok({ causes: [] })
      if (url.endsWith('/ux-scorecard/20261127-100000-abcd')) return ok({ id: 'x' })
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    const r = await uploadCaptures(cfg, { dir, platform: 'android', device: 'Pixel 8', source: 'adb', score: true, fetchImpl })
    expect(r).toMatchObject({ runId: '20261127-100000-abcd', pages: 2, uploaded: 3, reservedUsd: 0.18, scored: 2, mean: 7, errors: [] })
    const created = calls[0]!
    expect(created.body).toMatchObject({ platform: 'android', device: 'Pixel 8', source: 'adb' })
    expect(calls.filter((c) => c.url.startsWith('https://storage.test/') && c.method === 'PUT')).toHaveLength(3)
    const closed = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/ux-scorecard/20261127-100000-abcd'))!
    // A native run closes without a start_url, so it keeps the line the upload wrote.
    expect(closed.body).toMatchObject({ status: 'done', scored_by: 'server' })
    expect(closed.body).not.toHaveProperty('start_url')
  })

  it('stops with the reason when the captures are not accepted', async () => {
    const dir = captures({ welcome: { 'settled.png': png() } })
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, error: { code: 'RUN_BUDGET_RESERVED', message: 'This run needs up to $0.13 of AI budget' } }), { status: 402 })) as unknown as typeof fetch
    await expect(uploadCaptures(cfg, { dir, platform: 'ios', fetchImpl })).rejects.toThrow(/402.*AI budget/)
  })
})
