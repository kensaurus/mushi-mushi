/**
 * FILE: apps/admin/src/components/design/designTokens.test.ts
 * PURPOSE: Edit gating, edit parsing and rule diffs for the Design page — the
 *          pieces that decide what a draft PR may contain.
 */

import { describe, expect, it } from 'vitest'
import type { DesignEditability, DesignRuleConfig, DesignToken } from '../../lib/recipeTypes'
import { diffRuleDraft, parseEditValue, ruleToDraft, swatchColor, tokenEditBlocker, tokenPx, tokenSection } from './designTokens'

function token(overrides: Partial<DesignToken>): DesignToken {
  return {
    path: 'space.md',
    type: 'dimension',
    value: { value: 16, unit: 'px' },
    display: '16px',
    hex: null,
    px: 16,
    aliasOf: null,
    cssVar: '--space-md',
    ts: 'space.md',
    rn: null,
    description: null,
    file: 'design/tokens.json',
    role: 'source',
    group: 'space',
    ...overrides,
  }
}

const EDITABLE: DesignEditability = {
  enabled: true,
  reason: null,
  tokenFiles: ['design/tokens.json'],
  manifestWritable: true,
}

describe('tokenEditBlocker', () => {
  it('allows a source token in an allowlisted file', () => {
    expect(tokenEditBlocker(token({}), EDITABLE)).toBeNull()
  })
  it('passes the server reason through when editing is off', () => {
    expect(tokenEditBlocker(token({}), { ...EDITABLE, enabled: false, reason: 'No GitHub token' })).toBe('No GitHub token')
  })
  it('refuses generated exports and files outside the allowlist', () => {
    expect(tokenEditBlocker(token({ role: 'export' }), EDITABLE)).toMatch(/generated/)
    expect(tokenEditBlocker(token({ file: 'other.json' }), EDITABLE)).toMatch(/not one of the files/)
  })
  it('refuses types it cannot edit', () => {
    expect(tokenEditBlocker(token({ type: 'shadow' }), EDITABLE)).toMatch(/Only colour/)
  })
})

describe('parseEditValue', () => {
  it('validates each editable type', () => {
    expect(parseEditValue('color', '#' + 'a1b2c3')).toEqual({ ok: true, value: '#' + 'A1B2C3' })
    expect(parseEditValue('color', 'red').ok).toBe(false)
    expect(parseEditValue('dimension', '12px')).toEqual({ ok: true, value: '12px' })
    expect(parseEditValue('dimension', '12').ok).toBe(false)
    expect(parseEditValue('duration', '220ms')).toEqual({ ok: true, value: '220ms' })
    expect(parseEditValue('number', '1.5')).toEqual({ ok: true, value: 1.5 })
    expect(parseEditValue('fontFamily', '"IBM Plex Sans Thai Looped", sans-serif')).toEqual({
      ok: true,
      value: ['IBM Plex Sans Thai Looped', 'sans-serif'],
    })
  })
})

describe('diffRuleDraft', () => {
  const rule: DesignRuleConfig = {
    id: 'raw_interactive_element',
    enabled: true,
    severity: 'warn',
    allowValues: [],
    allowFiles: ['src/legacy/**'],
    primitives: { button: 'Btn' },
    fromManifest: false,
  }
  it('returns null when nothing changed', () => {
    expect(diffRuleDraft(rule, ruleToDraft(rule))).toEqual({ ok: true, change: null })
  })
  it('sends only the changed fields', () => {
    const draft = { ...ruleToDraft(rule), severity: 'error' as const, primitives: 'button=Btn, a=Link' }
    expect(diffRuleDraft(rule, draft)).toEqual({
      ok: true,
      change: { severity: 'error', primitives: { button: 'Btn', a: 'Link' } },
    })
  })
  it('rejects a malformed primitive map', () => {
    expect(diffRuleDraft(rule, { ...ruleToDraft(rule), primitives: 'button' }).ok).toBe(false)
  })
})

describe('tokenSection', () => {
  it('sorts tokens into visual sections', () => {
    expect(tokenSection(token({ type: 'color', hex: '#' + '000000', group: 'color' }))).toBe('color')
    expect(tokenSection(token({ path: 'radius.sm', group: 'radius' }))).toBe('radius')
    expect(tokenSection(token({ path: 'font.size.body', group: 'font' }))).toBe('type')
    expect(tokenSection(token({}))).toBe('spacing')
    expect(tokenSection(token({ type: 'duration', group: 'motion' }))).toBe('motion')
    expect(tokenSection(token({ type: 'shadow', group: 'elevation' }))).toBe('other')
  })

  it('never files a generated export\'s shadow, radius or spacing under Colour', () => {
    const exported = (path: string, display: string) =>
      token({ path, group: path.split('.')[0], type: 'color', display, hex: null, px: null, role: 'export' })
    expect(tokenSection(exported('shadow.card', '0 1px 2px rgb(0 0 0 / 0.1)'))).toBe('other')
    expect(tokenSection(exported('radius.md', '8px'))).toBe('radius')
    expect(tokenSection(exported('space.lg', '1.5rem'))).toBe('spacing')
    expect(tokenSection(exported('color.brand', 'oklch(0.6 0.2 25)'))).toBe('color')
    expect(tokenSection(exported('color.alias', 'var(--brand)'))).toBe('other')
  })
})

describe('swatchColor / tokenPx', () => {
  it('paints a hex or a CSS colour function, never a shadow', () => {
    expect(swatchColor({ hex: '#' + 'AABBCC', display: 'x' })).toBe('#' + 'AABBCC')
    expect(swatchColor({ hex: null, display: 'rgb(1 2 3)' })).toBe('rgb(1 2 3)')
    expect(swatchColor({ hex: null, display: '0 1px 2px rgb(0 0 0)' })).toBeNull()
  })
  it('reads px from the server or from a px / rem display', () => {
    expect(tokenPx({ px: 4, display: '' })).toBe(4)
    expect(tokenPx({ px: null, display: '0.5rem' })).toBe(8)
    expect(tokenPx({ px: null, display: '12px' })).toBe(12)
    expect(tokenPx({ px: null, display: 'auto' })).toBeNull()
  })
})
