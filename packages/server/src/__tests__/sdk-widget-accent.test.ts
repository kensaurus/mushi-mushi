/**
 * Widget brand colour from the console (migration 20261122120000):
 * parse/validate, the text-on-accent contrast the server promises, explicit-only
 * emission in GET /v1/sdk/config, and the fallback select while the column is
 * not deployed yet.
 */
import { describe, expect, it } from 'vitest'
import {
  accentInk,
  coerceSdkConfigUpdate,
  contrastRatio,
  isMissingAccentColumn,
  MIN_ACCENT_TEXT_CONTRAST,
  normalizeSdkConfig,
  parseAccentColour,
  SDK_CONFIG_CONSOLE_SELECT,
  sdkConfigUpdateErrors,
  withoutAccentColumn,
} from '../../supabase/functions/_shared/sdk-config'

describe('parseAccentColour', () => {
  it('accepts #rrggbb and #rgb with or without the hash, stored lowercase', () => {
    expect(parseAccentColour('#3B5BDB')).toBe('#3b5bdb')
    expect(parseAccentColour('3b5bdb')).toBe('#3b5bdb')
    expect(parseAccentColour(' #fA0 ')).toBe('#ffaa00')
  })

  it('refuses names, functions, alpha and junk', () => {
    for (const v of ['red', 'rgb(0,0,0)', '#3b5bdb80', '#12', 'url(x)', '', 42, null, undefined]) {
      expect(parseAccentColour(v), String(v)).toBeNull()
    }
  })
})

describe('accentInk', () => {
  it('matches the WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('picks white on dark accents and black on light ones', () => {
    expect(accentInk('#1e3a8a').ink).toBe('#ffffff')
    expect(accentInk('#fde047').ink).toBe('#000000')
  })

  it('never serves text under 3:1, whatever the colour', () => {
    // Sweep the cube: the better of black/white bottoms out near 4.58:1.
    let worst = Infinity
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
          const { ink, ratio, ok } = accentInk(hex)
          expect(ok).toBe(true)
          expect(contrastRatio(hex, ink)).toBeGreaterThanOrEqual(MIN_ACCENT_TEXT_CONTRAST)
          worst = Math.min(worst, ratio)
        }
      }
    }
    expect(worst).toBeGreaterThan(4.5)
  })
})

describe('normalizeSdkConfig accent', () => {
  it('omits accent while the column is NULL (auto: match the site)', () => {
    const widget = normalizeSdkConfig({ sdk_widget_accent: null }).widget as Record<string, unknown>
    expect('accent' in widget).toBe(false)
    expect('accentText' in widget).toBe(false)
  })

  it('serves the accent with its checked text colour', () => {
    const widget = normalizeSdkConfig({ sdk_widget_accent: '#3b5bdb' }).widget as Record<string, unknown>
    expect(widget).toMatchObject({ accent: '#3b5bdb', accentText: '#ffffff' })
  })

  it('drops a stored value that is not a hex colour instead of serving it', () => {
    const widget = normalizeSdkConfig({ sdk_widget_accent: 'red; background:url(x)' }).widget as Record<string, unknown>
    expect('accent' in widget).toBe(false)
  })

  it('serves the inherit theme', () => {
    expect((normalizeSdkConfig({ sdk_widget_theme: 'inherit' }).widget as Record<string, unknown>).theme).toBe('inherit')
  })
})

describe('coerceSdkConfigUpdate accent', () => {
  it('stores a valid colour normalised, and clears it on null, empty or auto', () => {
    expect(coerceSdkConfigUpdate({ widget: { accent: '#3B5BDB' } }).sdk_widget_accent).toBe('#3b5bdb')
    for (const clear of [null, '', 'auto']) {
      expect(coerceSdkConfigUpdate({ widget: { accent: clear } }).sdk_widget_accent, String(clear)).toBeNull()
    }
  })

  it('leaves the column untouched when the field is absent or invalid', () => {
    expect('sdk_widget_accent' in coerceSdkConfigUpdate({ widget: {} })).toBe(false)
    expect('sdk_widget_accent' in coerceSdkConfigUpdate({ widget: { accent: 'blue' } })).toBe(false)
  })

  it('stores the inherit theme', () => {
    expect(coerceSdkConfigUpdate({ widget: { theme: 'inherit' } }).sdk_widget_theme).toBe('inherit')
  })
})

describe('sdkConfigUpdateErrors', () => {
  it('passes what the console sends', () => {
    expect(
      sdkConfigUpdateErrors({
        enabled: true,
        widget: { position: 'top-left', theme: 'inherit', launcher: 'banner', triggerText: null, accent: '#3b5bdb' },
      }),
    ).toEqual([])
    expect(sdkConfigUpdateErrors({ widget: { accent: 'auto' } })).toEqual([])
    expect(sdkConfigUpdateErrors({})).toEqual([])
  })

  it('names each bad field instead of saving nothing silently', () => {
    const errors = sdkConfigUpdateErrors({ widget: { accent: 'blue', position: 'middle', theme: 'neon', launcher: 'fab', triggerText: 5 } })
    expect(errors.join(' ')).toMatch(/widget\.accent/)
    expect(errors.join(' ')).toMatch(/widget\.position/)
    expect(errors.join(' ')).toMatch(/widget\.theme/)
    expect(errors.join(' ')).toMatch(/widget\.launcher/)
    expect(errors.join(' ')).toMatch(/widget\.triggerText/)
    expect(sdkConfigUpdateErrors({ widget: 'dark' })).toEqual(['widget must be an object.'])
  })
})

describe('accent column fallback', () => {
  it('recognises the missing-column errors of Postgres and PostgREST', () => {
    expect(isMissingAccentColumn({ code: '42703', message: 'column project_settings.sdk_widget_accent does not exist' })).toBe(true)
    expect(isMissingAccentColumn({ code: 'PGRST204', message: "Could not find the 'sdk_widget_accent' column of 'project_settings'" })).toBe(true)
    expect(isMissingAccentColumn({ code: '42703', message: 'column project_settings.other does not exist' })).toBe(false)
    expect(isMissingAccentColumn(null)).toBe(false)
  })

  it('re-selects without only the accent column', () => {
    const fallback = withoutAccentColumn(SDK_CONFIG_CONSOLE_SELECT)
    expect(fallback).not.toContain('sdk_widget_accent')
    expect(fallback.split(', ')).toHaveLength(SDK_CONFIG_CONSOLE_SELECT.split(', ').length - 1)
  })
})
