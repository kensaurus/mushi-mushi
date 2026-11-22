import { describe, expect, it } from 'vitest'
import { layerTileText } from './exploreCounts'

describe('layerTileText', () => {
  it('says "Not checked" before anything is indexed, never 0', () => {
    expect(layerTileText(0, 0, 'API routes')).toEqual({ value: 'Not checked', detail: 'Index the repo first', hasCount: false })
  })

  it('says it looked and found none once files are indexed', () => {
    expect(layerTileText(0, 52, 'API routes')).toEqual({ value: 'None found', detail: 'in 52 indexed files', hasCount: false })
    expect(layerTileText(null, 1, 'API routes').detail).toBe('in 1 indexed file')
  })

  it('shows the count with its detail when there is one', () => {
    expect(layerTileText(7, 52, 'API routes')).toEqual({ value: 7, detail: 'API routes', hasCount: true })
  })
})
