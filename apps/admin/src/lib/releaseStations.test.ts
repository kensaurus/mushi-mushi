/**
 * FILE: apps/admin/src/lib/releaseStations.test.ts
 * PURPOSE: The client's copy of the release stations names them like the
 *          server (_shared/project-home.ts buildStations): "Fixes", not
 *          "Fix PRs" (the count includes reports with no PR yet), and
 *          "Waiting to merge", not "In train" (journey walk, 2026-11-28).
 */

import { describe, expect, it } from 'vitest'
import { stationsFromStages } from './releaseStations'

describe('stationsFromStages', () => {
  it('adds the pr and review stages into Fixes, and names every station in plain words', () => {
    const stations = stationsFromStages([
      { id: 'pr', count: 2, stuck: 1 },
      { id: 'review', count: 3, stuck: 2 },
      { id: 'train', count: 4, stuck: 0 },
    ] as never)
    expect(stations.map((s) => [s.label, s.count, s.stuck])).toEqual([
      ['Fixes', 5, 3],
      ['CI', 0, 0],
      ['Waiting to merge', 4, 0],
      ['Merged', 0, 0],
      ['Deployed', 0, 0],
    ])
  })
})
