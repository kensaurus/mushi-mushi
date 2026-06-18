import { describe, expect, it } from 'vitest'
import { extBadgeColor, readVizToken } from './vizTokens'

describe('vizTokens', () => {
  it('maps file extensions through langVizColor', () => {
    expect(extBadgeColor('tsx')).toBe(readVizToken('viz-lang-react'))
    expect(extBadgeColor('py')).toBe(readVizToken('viz-lang-python'))
    expect(extBadgeColor('unknown-ext')).toBe(readVizToken('viz-lang-default'))
  })
})
