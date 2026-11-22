import { describe, expect, it } from 'vitest'
import { groupOfflineLanes } from './LocalWorkerModels'
import type { WorkerLane } from '../../lib/workers'

// Fresh-eyes 2026-11-18: 19 rows that all said "offline" with the same model.
describe('groupOfflineLanes', () => {
  const lane = (id: string, hostId: string) => ({ id, hostId, name: id, projectName: 'app', config: {} }) as unknown as WorkerLane

  it('groups offline lanes by machine and keeps the rest as rows', () => {
    const lanes = [lane('a', 'h1'), lane('b', 'h1'), lane('c', 'h2'), lane('d', 'h3')]
    const now = (l: WorkerLane) => (l.id === 'd' ? 'taking' : 'offline') as 'taking' | 'offline'
    const names: Record<string, string> = { h1: 'alienwarex16', h2: 'nuc' }
    const { live, offline } = groupOfflineLanes(lanes, now, (id) => names[id] ?? 'unknown machine')
    expect(live.map((l) => l.id)).toEqual(['d'])
    expect(offline.map((g) => [g.host, g.lanes.length])).toEqual([
      ['alienwarex16', 2],
      ['nuc', 1],
    ])
  })
})
