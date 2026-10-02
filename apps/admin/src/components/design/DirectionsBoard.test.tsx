/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/DirectionsBoard.test.tsx
 * PURPOSE: The Directions board on glot's three art directions:
 *   (a) all three render, exactly one is marked Active, contrast ratios show,
 *       and every phone mock has exactly one filled CTA;
 *   (b) directionMock resolves every role for all three without undefined
 *       colours (the three directions name some roles differently);
 *   (c) nothing on the board uses a fixed width over 360 px (no horizontal
 *       scroll at 390 px).
 *
 * Data: __fixtures__/glot-directions.json, generated from the real server
 * route over glot's direction token files (packages/server recipe fixtures).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignDirectionsResponse } from '../../lib/recipeTypes'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { DirectionsBoardView } from './DirectionsBoard'
import { resolveDirectionRoles } from './directionMock'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── Fixture ──────────────────────────────────────────────────────────────────

const FIXTURE = join(__dirname, '__fixtures__', 'glot-directions.json')
// Generated from the real GET /design/directions route over glot's token files:
//   WRITE_ADMIN_FIXTURE=1 vitest run src/__tests__/recipe-routes.test.ts  (packages/server)
const DATA = JSON.parse(readFileSync(FIXTURE, 'utf8')) as DesignDirectionsResponse

// ── Render harness ───────────────────────────────────────────────────────────

describe('DirectionsBoard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: { dryRun: true, files: [], denied: [], pr: null } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(data: DesignDirectionsResponse = DATA) {
    act(() => {
      root.render(createElement(DirectionsBoardView, { projectId: 'glot', data }))
    })
  }

  it('(a) renders the three glot directions, one Active, ratios, and one CTA per phone mock', () => {
    render()
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="direction-card"]'))
    expect(cards.map((c) => c.dataset.direction).sort()).toEqual(['nang-lamp', 'pha-khram', 'soi-signpaint'])
    for (const name of ['Soi Signpaint', 'Pha Khram', 'Nang Lamp']) expect(container.textContent).toContain(name)

    const active = container.querySelectorAll('[data-testid="active-badge"]')
    expect(active).toHaveLength(1)
    expect(active[0]?.closest('[data-testid="direction-card"]')?.getAttribute('data-direction')).toBe('soi-signpaint')

    const ratios = Array.from(container.querySelectorAll('[data-testid="direction-contrast-ratio"]')).map((e) => e.textContent)
    expect(ratios.some((r) => /^\d+\.\d{2}:1$/.test(r ?? ''))).toBe(true)

    const mocks = container.querySelectorAll('[data-testid="phone-mock"]')
    expect(mocks).toHaveLength(3)
    mocks.forEach((m) => expect(m.querySelectorAll('[data-mock="cta"]')).toHaveLength(1))

    // "Set active direction" only on the two inactive cards.
    const activateButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Set active direction',
    )
    expect(activateButtons).toHaveLength(2)
  })

  it('renders the fixture facts: manifest order, assets, failing and unresolved pairs, notes, read-only cards', () => {
    expect(DATA.specimen.script).toBe('thai')
    expect(DATA.specimen.word).toBe('น้ำ')
    expect(DATA.directions.map((d) => d.name)).toEqual(['soi-signpaint', 'pha-khram', 'nang-lamp'])
    render()
    // Cards render in manifest order.
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-testid="direction-card"]')).map((c) => c.dataset.direction),
    ).toEqual(['soi-signpaint', 'pha-khram', 'nang-lamp'])
    const card = (name: string) => container.querySelector<HTMLElement>(`[data-direction="${name}"]`)
    const rows = (name: string, verdict: 'pass' | 'fail' | 'unknown') =>
      Array.from(card(name)?.querySelectorAll('tbody tr') ?? []).filter((r) => r.querySelector(`[data-verdict="${verdict}"]`))
    const ratio = (row: Element | undefined) => row?.querySelector('[data-testid="direction-contrast-ratio"]')?.textContent

    for (const name of ['soi-signpaint', 'pha-khram', 'nang-lamp']) {
      expect(card(name)?.querySelectorAll('[data-testid="direction-contrast-ratio"]')).toHaveLength(7)
      // The prompt word is drawn in every phone mock.
      expect(card(name)?.querySelector('[data-mock="word"]')?.textContent).toBe('น้ำ')
    }

    // Failing pairs: Soi 1 (reward 1.63), Pha 1 (action.primary on raised 2.73),
    // Nang 2 (tone.mid 1.93, tone.high 2.41) plus 1 unresolved (text.onAction, not judged).
    expect(rows('soi-signpaint', 'fail').map(ratio)).toEqual(['1.63:1'])
    expect(rows('pha-khram', 'fail').map(ratio)).toEqual(['2.73:1'])
    expect(rows('nang-lamp', 'fail').map(ratio).sort()).toEqual(['1.93:1', '2.41:1'])
    expect(rows('nang-lamp', 'unknown')).toHaveLength(1)
    expect(ratio(rows('nang-lamp', 'unknown')[0])).toBe('—')
    expect(rows('soi-signpaint', 'unknown')).toHaveLength(0)

    // Assets: Soi 7 (6 shown + "+1 more"), Pha 1, Nang 0.
    expect(DATA.directions.map((d) => d.assets.length)).toEqual([7, 1, 0])
    expect(card('soi-signpaint')?.querySelectorAll('[data-testid="direction-asset"]')).toHaveLength(6)
    expect(card('soi-signpaint')?.textContent).toContain('+1 more assets')
    expect(card('pha-khram')?.querySelectorAll('[data-testid="direction-asset"]')).toHaveLength(1)
    const phaImg = card('pha-khram')?.querySelector('img')
    expect(phaImg?.getAttribute('loading')).toBe('lazy')
    expect(phaImg?.getAttribute('src')).toContain('/v1/design-assets/')
    expect(card('nang-lamp')?.querySelectorAll('[data-testid="direction-asset"]')).toHaveLength(0)
    expect(card('nang-lamp')?.textContent).toContain('No assets declared.')

    // Soi's note shows; inactive cards are labelled read-only in text.
    expect(card('soi-signpaint')?.querySelector('[data-testid="direction-note"]')?.textContent).toContain(
      'earned-progress mechanic',
    )
    expect(card('soi-signpaint')?.querySelector('[data-testid="read-only-badge"]')).toBeNull()
    for (const name of ['pha-khram', 'nang-lamp']) {
      expect(card(name)?.querySelector('[data-testid="read-only-badge"]')?.textContent).toBe('Read-only — inactive')
      // Read-only still allows both PR actions.
      const labels = Array.from(card(name)?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim())
      expect(labels).toContain('Set active direction')
      expect(labels).toContain('Duplicate / edit direction')
    }

    // Nothing has been scanned: the active card says so; inactive cards explain why.
    expect(card('soi-signpaint')?.textContent).toContain('Not scanned yet')
    expect(card('pha-khram')?.textContent).toContain('Not scanned — only the active direction is scanned')
  })

  it('previews an activate change as a dry run', async () => {
    render()
    const card = container.querySelector('[data-direction="pha-khram"]')
    const btn = Array.from(card?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === 'Set active direction')
    await act(async () => {
      btn?.click()
      await Promise.resolve()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledTimes(1)
    const [path, init] = api.apiFetchMutate.mock.calls[0] as [string, { body: string }]
    expect(path).toBe('/v1/admin/projects/glot/design/changes')
    expect(JSON.parse(init.body)).toEqual({ kind: 'activate', direction: 'pha-khram', dryRun: true })
  })

  it('shows editable.reason instead of the action buttons when editing is off', () => {
    render({ ...DATA, editable: { enabled: false, reason: 'Connect GitHub to propose changes.' } })
    expect(container.textContent).toContain('Connect GitHub to propose changes.')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Set active direction'))).toBe(false)
  })

  it('loads each Google Fonts stylesheet once and removes it on unmount', () => {
    render()
    const links = () => document.head.querySelectorAll('link[data-mushi-font-sheet]')
    expect(links()).toHaveLength(DATA.fontStylesheets.length)
    act(() => root.unmount())
    expect(links()).toHaveLength(0)
    root = createRoot(container)
  })

  it('(c) uses no fixed width over 360px anywhere on the board', () => {
    render()
    const tooWide: string[] = []
    const pxOf = (v: string) => (/^(\d+(?:\.\d+)?)px$/.exec(v.trim()) ? parseFloat(v) : null)
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      for (const prop of ['width', 'minWidth'] as const) {
        const px = pxOf(el.style[prop])
        if (px !== null && px > 360) tooWide.push(`${el.tagName} style.${prop}=${el.style[prop]}`)
      }
      const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') ?? ''
      for (const token of cls.split(/\s+/)) {
        const scale = /^(?:[\w-[\]]+:)*(?:min-)?w-(\d+(?:\.\d+)?)$/.exec(token)
        if (scale && parseFloat(scale[1] ?? '0') * 4 > 360) tooWide.push(`${el.tagName} .${token}`)
        const arbitrary = /^(?:[\w-[\]]+:)*(?:min-)?w-\[(\d+(?:\.\d+)?)px\]$/.exec(token)
        if (arbitrary && parseFloat(arbitrary[1] ?? '0') > 360) tooWide.push(`${el.tagName} .${token}`)
      }
    }
    expect(tooWide).toEqual([])
    // The phone frame is min(300px, 100%): full width, capped at 300px.
    container.querySelectorAll('[data-testid="phone-mock"]').forEach((m) => {
      expect(m.classList.contains('w-full')).toBe(true)
      expect(m.classList.contains('max-w-75')).toBe(true)
    })
  })
})

describe('(b) directionMock', () => {
  const COLOR_ROLES = [
    'canvas',
    'raised',
    'text',
    'textMuted',
    'textOnRaised',
    'choiceBg',
    'choiceFg',
    'action',
    'onAction',
    'reward',
    'line',
  ] as const

  it.each(DATA.directions.map((d) => [d.name, d] as const))('resolves every role for %s', (_name, direction) => {
    const roles = resolveDirectionRoles(direction.tokens)
    for (const role of COLOR_ROLES) {
      expect(typeof roles[role]).toBe('string')
      expect(roles[role].length).toBeGreaterThan(0)
    }
    // glot declares all the core roles, so they come from data, not defaults.
    for (const role of ['canvas', 'text', 'action', 'onAction', 'choiceBg', 'choiceFg'] as const) {
      expect(roles[role]).toMatch(/^#[0-9a-f]{6,8}$/i)
    }
    expect(roles.fontDisplay).not.toBe('inherit')
    expect(Number.isFinite(roles.radiusPx)).toBe(true)
  })

  it('falls back to CSS keywords, never undefined, when a direction has no tokens', () => {
    const roles = resolveDirectionRoles([])
    for (const role of COLOR_ROLES) {
      expect(roles[role]).toBeTruthy()
      expect(roles[role]).not.toMatch(/^#/)
    }
    expect(roles.fontBody).toBe('inherit')
    expect(roles.defaulted).toContain('canvas')
  })
})
