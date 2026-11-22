/**
 * /ci round 3 (2026-11-19): the live rows name their shared app and PR once, timeline lanes keep
 * the end that tells them apart, and a job name never shows a raw `${{ }}` expression.
 */

import { describe, expect, it } from 'vitest'
import { sharedLiveOrigin } from './CiStatusBoard'
import { splitLaneLabel } from './CiTimeline'
import { cleanJobName } from '../../lib/ciView'

const live = (app: string, prNumber: number | null) => ({ app, job: { prNumber } })

describe('sharedLiveOrigin', () => {
  it('names the app and PR once when every live job shares them', () => {
    expect(sharedLiveOrigin([live('glot.it', 1081), live('glot.it', 1081), live('glot.it', 1081)])).toEqual({ app: 'glot.it', prNumber: 1081 })
  })

  it('keeps them per row when they differ, or when there is one row', () => {
    expect(sharedLiveOrigin([live('glot.it', 1081), live('yen-yen', 1081)])).toBeNull()
    expect(sharedLiveOrigin([live('glot.it', 1081), live('glot.it', 1082)])).toBeNull()
    expect(sharedLiveOrigin([live('glot.it', 1081)])).toBeNull()
  })
})

describe('cleanJobName', () => {
  it('drops an unresolved workflow expression with its brackets', () => {
    expect(cleanJobName("Publish OTA (${{ (((inputs.track == 'beta') && 'beta') || 'production') }})")).toBe('Publish OTA')
  })

  it('stands in "…" for one inside the name and leaves plain names alone', () => {
    expect(cleanJobName('Deploy ${{ matrix.env }} web')).toBe('Deploy … web')
    expect(cleanJobName('Lint & Build')).toBe('Lint & Build')
    expect(cleanJobName('(${{ inputs.x }})')).toBe('(${{ inputs.x }})')
  })
})

describe('splitLaneLabel', () => {
  it('keeps a trailing number whole so two cut names still differ', () => {
    expect(splitLaneLabel('aw-the-wanting-mind 2')).toEqual({ head: 'aw-the-wanting-mind', tail: ' 2' })
    expect(splitLaneLabel('aw-the-wanting-mind-1118233741-576')).toEqual({ head: 'aw-the-wanting-mind-1118233741', tail: '-576' })
  })

  it('leaves a name with no suffix alone', () => {
    expect(splitLaneLabel('overseas-ci')).toEqual({ head: 'overseas-ci', tail: '' })
  })
})
