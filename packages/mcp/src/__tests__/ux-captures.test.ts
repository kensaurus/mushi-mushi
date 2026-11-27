import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pngDimensions, readCapturePages } from '../ux-captures.js'

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(32)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b)
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function folder(screens: Record<string, Record<string, Buffer | string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-mcp-captures-'))
  dirs.push(dir)
  for (const [name, files] of Object.entries(screens)) {
    mkdirSync(join(dir, 'pages', name), { recursive: true })
    for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, 'pages', name, f), body)
  }
  return dir
}

describe('upload_ux_captures on stdio: reading a captures folder', () => {
  it('reads each screen with its shots and fills what was not measured', () => {
    const dir = folder({
      'sign up': { 'settled.png': png(390, 844) },
      home: { 'early.png': png(390, 844), 'settled.png': png(390, 844), 'facts.json': JSON.stringify({ label: 'Home', text: 'Welcome back' }) },
    })
    const pages = readCapturePages(dir)
    expect(pages.map((p) => p.facts.key)).toEqual(['/home', '/sign-up'])
    expect(pages[0]).toMatchObject({ shots: ['early', 'settled'], facts: { label: 'Home', text: 'Welcome back', axe: null, settleMs: null, viewport: { width: 390, height: 844 } } })
  })

  it('refuses what cannot be uploaded', () => {
    expect(() => readCapturePages(folder({}))).toThrow(/pages/)
    expect(() => readCapturePages(folder({ a: { 'settled.png': 'text' } }))).toThrow(/not a PNG/)
    expect(pngDimensions(new Uint8Array(4))).toBeNull()
  })
})
