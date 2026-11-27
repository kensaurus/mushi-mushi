import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPresets, parsePresets, presetsFile } from './fresh-eyes-presets.js'
import { presetFor } from './fresh-eyes.js'

describe('fresh-eyes app presets (ADR 0073: no app built in)', () => {
  const presets = parsePresets(
    JSON.stringify([{ match: 'https://example.com/app/', appHosts: ['abcd.supabase.co'], successUrl: '/app/dashboard/*', successText: 'Your first report', terminal: true }]),
  )

  it('matches the start page by origin and path prefix only', () => {
    expect(presetFor('https://example.com/app', presets)).toMatchObject({ appHosts: ['abcd.supabase.co'], success: { url: '/app/dashboard/*', text: 'Your first report' }, terminal: true })
    expect(presetFor('https://example.com/app/sign-in?x=1', presets)?.terminal).toBe(true)
    expect(presetFor('https://example.com/application', presets)).toBeNull()
    expect(presetFor('https://other.example/app', presets)).toBeNull()
    expect(presetFor('not a url', presets)).toBeNull()
    expect(presetFor('https://example.com/app', [])).toBeNull()
  })

  it('refuses a malformed file instead of dropping a check', () => {
    expect(() => parsePresets('{')).toThrow(/not JSON/)
    expect(() => parsePresets('{}')).toThrow(/array/)
    expect(() => parsePresets('[{"match":"ftp://x"}]')).toThrow(/preset 1/)
    expect(() => parsePresets('[{"match":"https://x.example","appHosts":["a b"]}]')).toThrow(/appHosts/)
    expect(() => parsePresets('[{"match":"https://x.example","terminal":"yes"}]')).toThrow(/terminal/)
  })

  it('reads the file from the config folder, or none when it is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mushi-presets-'))
    try {
      expect(presetsFile({ LOCALAPPDATA: dir })).toBe(join(dir, 'mushi', 'fresh-eyes-presets.json'))
      expect(loadPresets({ LOCALAPPDATA: dir })).toEqual([])
      const file = join(dir, 'p.json')
      writeFileSync(file, '[{"match":"https://x.example"}]')
      expect(loadPresets({ MUSHI_FRESH_EYES_PRESETS_FILE: file })).toEqual([{ match: 'https://x.example/', appHosts: [], success: {}, terminal: false }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
