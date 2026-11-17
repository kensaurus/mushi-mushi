import { describe, expect, it } from 'vitest'
import { tickVisibility } from './CiTimeline'

/** Which of the 13 ticks (0–12) show at a width: narrow, ≥ 56rem, ≥ 100rem. */
function shown(width: 'narrow' | 'mid' | 'wide'): number[] {
  return Array.from({ length: 13 }, (_, i) => i).filter((i) => {
    const c = tickVisibility(i)
    if (width === 'narrow') return !c.startsWith('hidden')
    if (width === 'mid') return c === '' || c.includes('hidden @4xl:block')
    return c === '' || c.includes('@min-[100rem]:block') || c.includes('@4xl:block')
  })
}

describe('timeline ticks', () => {
  it('shows 4, then 6, then 12 evenly spaced steps as the timeline widens', () => {
    expect(shown('narrow')).toEqual([0, 3, 6, 9, 12])
    expect(shown('mid')).toEqual([0, 2, 4, 6, 8, 10, 12])
    expect(shown('wide')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})
