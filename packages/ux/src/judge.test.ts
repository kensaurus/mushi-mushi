// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { judgeSurface, unshuffle } from './judge.js'
import type { SurfaceState } from './state.js'
import type { ProbeResult } from './types.js'

const encodePng = (png: PNG): Buffer => PNG.sync.write(png)
const probes: ProbeResult = { axe: [], overflowX: false, smallTargets: 0, consoleErrors: [], cls: 0 }
const box = (x: number, y: number) => ({ x, y, width: 10, height: 10 })
const sizes = { A: { width: 100, height: 100 }, B: { width: 100, height: 100 } }

describe('unshuffle', () => {
  const answer = {
    preferred: 'A' as const,
    confidence: 'high' as const,
    summary: 's',
    better: [{ image: 'A' as const, box: box(5, 5), what: 'clear CTA', why: 'w' }],
    worse: [{ image: 'B' as const, box: box(500, 5), what: 'outside', why: 'w' }],
    design_system_breaks: [{ image: 'B' as const, box: box(1, 1), what: 'raw hex', why: 'w', token_or_rule: '--color-fg' }],
  }

  it('maps A/B back to before/after whichever way they were shown', () => {
    expect(unshuffle(answer, false, sizes, 'desktop', 'm').preferred).toBe('after')
    expect(unshuffle(answer, true, sizes, 'desktop', 'm').preferred).toBe('before')
    const v = unshuffle(answer, false, sizes, 'desktop', 'm')
    expect(v.better[0].image).toBe('after')
    expect(v.designBreaks[0]).toMatchObject({ image: 'before', tokenOrRule: '--color-fg' })
  })

  it('drops claims whose box is outside the image', () => {
    const v = unshuffle(answer, false, sizes, 'desktop', 'm')
    expect(v.worse).toEqual([])
    expect(v.droppedClaims).toBe(1)
  })
})

describe('judgeSurface', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function surfaceWithShots(): SurfaceState {
    dir = mkdtempSync(join(tmpdir(), 'mushi-ux-judge-'))
    mkdirSync(join(dir, 'shots'))
    const png = new PNG({ width: 100, height: 400 })
    png.data.fill(255)
    writeFileSync(join(dir, 'shots', 'b.png'), encodePng(png))
    writeFileSync(join(dir, 'shots', 'a.png'), encodePng(png))
    return {
      surface: { key: 'k', kind: 'page', path: '/', steps: [], label: 'Home', domHash: 'h' },
      status: 'accepted',
      note: null,
      baseline: { desktop: { png: 'shots/b.png', probes, penalty: 3 } },
      iterations: [
        {
          n: 1,
          agent: 'x',
          model: null,
          startedAt: '',
          durationMs: 1,
          outcome: 'accepted',
          reason: '',
          commitSha: 'abc',
          pixelDiff: {},
          after: { desktop: { png: 'shots/a.png', probes, penalty: 0 } },
          diffPng: {},
          logTail: '',
        },
      ],
    }
  }

  it('sends both images, caches the rubric, and reads the structured answer', async () => {
    const s = surfaceWithShots()
    const parse = vi.fn(async () => ({
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      parsed_output: { preferred: 'B', confidence: 'medium', summary: 'ok', better: [], worse: [], design_system_breaks: [] },
    }))
    const client = { beta: { messages: { parse } } } as unknown as Anthropic
    const v = await judgeSurface(s, 'desktop', { dir, repoRoot: dir, designFiles: [], client, random: () => 0.9 })
    // random 0.9 → A is the after image, so B is the original.
    expect(v?.preferred).toBe('before')
    const req = (parse.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.fallbacks).toBe('default')
    const system = req.system as Array<{ cache_control?: unknown }>
    expect(system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    const content = (req.messages as Array<{ content: Array<{ type: string }> }>)[0].content
    expect(content.filter((b) => b.type === 'image')).toHaveLength(2)
  })

  it('reports a refusal instead of a verdict', async () => {
    const s = surfaceWithShots()
    const client = {
      beta: { messages: { parse: async () => ({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, parsed_output: null }) } },
    } as unknown as Anthropic
    const v = await judgeSurface(s, 'desktop', { dir, repoRoot: dir, designFiles: [], client })
    expect(v?.error).toMatch(/declined \(cyber\)/)
  })

  it('returns null when the screen has no kept change at that viewport', async () => {
    const s = surfaceWithShots()
    const client = { beta: { messages: { parse: vi.fn() } } } as unknown as Anthropic
    expect(await judgeSurface(s, 'mobile', { dir, repoRoot: dir, designFiles: [], client })).toBeNull()
  })
})
