import { afterEach, describe, expect, it } from 'vitest'
import { HERO_ACTION_TONE_HEX, HERO_SEVERITY_HEX } from '../components/hero-flow/heroFlow.data'
import { STAGE_HEX, TONE_HEX } from '../components/flow-primitives/flowTokens'
import { extBadgeColor, readVizToken, stepStatusColor, VIZ_TOKEN_MISSING, vizColorMap } from './vizTokens'

afterEach(() => {
  const style = document.documentElement.style
  for (const name of ['viz-neutral', 'viz-edge-dark', 'viz-flow-info', 'viz-step-failed', 'viz-score-ok']) {
    style.removeProperty(`--color-${name}`)
  }
})

describe('vizTokens', () => {
  it('maps file extensions through langVizColor', () => {
    expect(extBadgeColor('tsx')).toBe(readVizToken('viz-lang-react'))
    expect(extBadgeColor('py')).toBe(readVizToken('viz-lang-python'))
    expect(extBadgeColor('unknown-ext')).toBe(readVizToken('viz-lang-default'))
  })

  it('returns the stylesheet value', () => {
    document.documentElement.style.setProperty('--color-viz-neutral', 'oklch(0.65 0.02 285)')
    expect(readVizToken('viz-neutral')).toBe('oklch(0.65 0.02 285)')
  })

  it('uses one stand-in when the stylesheet has no value', () => {
    expect(readVizToken('viz-neutral')).toBe(VIZ_TOKEN_MISSING)
  })

  it('re-reads a colour map when the stylesheet changes', () => {
    const colors = vizColorMap({ edge: 'viz-edge-dark' })
    document.documentElement.style.setProperty('--color-viz-edge-dark', 'oklch(0.2 0.01 285)')
    expect(colors.edge).toBe('oklch(0.2 0.01 285)')
    document.documentElement.style.setProperty('--color-viz-edge-dark', 'oklch(0.9 0.01 285)')
    expect(colors.edge).toBe('oklch(0.9 0.01 285)')
  })

  it('keeps chart maps live after the module has loaded', () => {
    document.documentElement.style.setProperty('--color-viz-flow-info', 'oklch(0.21 0.1 250)')
    expect(STAGE_HEX.plan).toBe('oklch(0.21 0.1 250)')
    expect(HERO_SEVERITY_HEX.info).toBe('oklch(0.21 0.1 250)')
    expect(HERO_ACTION_TONE_HEX.plan).toBe('oklch(0.21 0.1 250)')
    document.documentElement.style.setProperty('--color-viz-flow-info', 'oklch(0.81 0.1 250)')
    expect(STAGE_HEX.plan).toBe('oklch(0.81 0.1 250)')
    expect(HERO_SEVERITY_HEX.info).toBe('oklch(0.81 0.1 250)')

    document.documentElement.style.setProperty('--color-viz-score-ok', 'oklch(0.33 0.1 155)')
    expect(TONE_HEX.ok).toBe('oklch(0.33 0.1 155)')
    document.documentElement.style.setProperty('--color-viz-score-ok', 'oklch(0.77 0.1 155)')
    expect(TONE_HEX.ok).toBe('oklch(0.77 0.1 155)')

    document.documentElement.style.setProperty('--color-viz-step-failed', 'oklch(0.3 0.2 25)')
    expect(stepStatusColor('failed')).toBe('oklch(0.3 0.2 25)')
    document.documentElement.style.setProperty('--color-viz-step-failed', 'oklch(0.7 0.2 25)')
    expect(stepStatusColor('failed')).toBe('oklch(0.7 0.2 25)')
  })
})

// Getter maps are readonly. These functions are type-checked and not called:
// assigning to a getter-only property throws at runtime.
function colourMapsRejectAssignment(): void {
  // @ts-expect-error STAGE_HEX properties are readonly getters
  STAGE_HEX.plan = 'nope'
  // @ts-expect-error HERO_SEVERITY_HEX properties are readonly getters
  HERO_SEVERITY_HEX.info = 'nope'
  // @ts-expect-error HERO_ACTION_TONE_HEX properties are readonly getters
  HERO_ACTION_TONE_HEX.plan = 'nope'
  // @ts-expect-error TONE_HEX properties are readonly getters
  TONE_HEX.ok = 'nope'
}

function toneHexKeysAreClosed(): void {
  const ok: keyof typeof TONE_HEX = 'ok'
  const warn: keyof typeof TONE_HEX = 'warn'
  const urgent: keyof typeof TONE_HEX = 'urgent'
  // @ts-expect-error TONE_HEX keys are ok | warn | urgent
  const nope: keyof typeof TONE_HEX = 'nope'
  void ok
  void warn
  void urgent
  void nope
}

void colourMapsRejectAssignment
void toneHexKeysAreClosed
