import { afterEach, describe, expect, it } from 'vitest'
import { HERO_SEVERITY_HEX } from '../components/hero-flow/heroFlow.data'
import { STAGE_HEX } from '../components/flow-primitives/flowTokens'
import { extBadgeColor, readVizToken } from './vizTokens'

describe('vizTokens', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--color-viz-neutral')
    document.documentElement.style.removeProperty('--color-viz-flow-info')
  })

  it('maps file extensions through langVizColor', () => {
    expect(extBadgeColor('tsx')).toBe(readVizToken('viz-lang-react'))
    expect(extBadgeColor('py')).toBe(readVizToken('viz-lang-python'))
    expect(extBadgeColor('unknown-ext')).toBe(readVizToken('viz-lang-default'))
  })

  it('returns the stylesheet value instead of a second palette', () => {
    document.documentElement.style.setProperty('--color-viz-neutral', 'oklch(0.65 0.02 285)')
    expect(readVizToken('viz-neutral')).toBe('oklch(0.65 0.02 285)')
    document.documentElement.style.setProperty('--color-viz-neutral', 'oklch(0.11 0.02 285)')
    expect(readVizToken('viz-neutral')).toBe('oklch(0.11 0.02 285)')
  })

  it('does not keep the drifted viz-neutral fallback', () => {
    expect(readVizToken('viz-neutral')).not.toBe('oklch(0.55 0.02 285)')
  })

  it('re-reads chart colours on access so a theme change is not frozen at import', () => {
    document.documentElement.style.setProperty('--color-viz-flow-info', 'oklch(0.2 0 0)')
    expect(STAGE_HEX.plan).toBe('oklch(0.2 0 0)')
    expect(HERO_SEVERITY_HEX.info).toBe('oklch(0.2 0 0)')
    document.documentElement.style.setProperty('--color-viz-flow-info', 'oklch(0.8 0 0)')
    expect(STAGE_HEX.plan).toBe('oklch(0.8 0 0)')
    expect(HERO_SEVERITY_HEX.info).toBe('oklch(0.8 0 0)')
  })
})
