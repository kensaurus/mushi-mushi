/**
 * FILE: apps/admin/src/lib/releaseStations.ts
 * PURPOSE: The five release stations and the train on the tracks, from the
 *          /pipeline read (GET /v1/admin/pipeline). Home gets the same shape
 *          from its own call; this is the server's `buildStations` and
 *          `currentTrain` (_shared/project-home.ts) applied to the pipeline
 *          payload, so Fixes shows the same numbers as Home and /pipeline.
 */

import type { PipelineStage, TrainSummary } from './pipeline'

type ReleaseStationId = 'fix' | 'ci' | 'train' | 'merged' | 'deployed'

export interface ReleaseStation {
  id: ReleaseStationId
  label: string
  count: number
  /** Of `count`, stuck (needs a person or is waiting too long). */
  stuck: number
}

export interface ReleaseTrainNow {
  state: string
  prNumber: number | null
  members: number
  createdAt: string
  repo: string
  active: boolean
}

/** The pipeline stages each station adds up (server: STATION_STAGES). */
const STATION_STAGES: Array<{ id: ReleaseStationId; label: string; stages: string[] }> = [
  { id: 'fix', label: 'Fix ready', stages: ['pr', 'review'] },
  { id: 'ci', label: 'CI', stages: ['ci'] },
  { id: 'train', label: 'In train', stages: ['train'] },
  { id: 'merged', label: 'Merged', stages: ['merged'] },
  { id: 'deployed', label: 'Deployed', stages: ['deployed'] },
]

export function stationsFromStages(stages: Pick<PipelineStage, 'id' | 'count' | 'stuck'>[]): ReleaseStation[] {
  const byId = new Map(stages.map((s) => [s.id as string, s]))
  return STATION_STAGES.map((st) => ({
    id: st.id,
    label: st.label,
    count: st.stages.reduce((n, id) => n + (byId.get(id)?.count ?? 0), 0),
    stuck: st.stages.reduce((n, id) => n + (byId.get(id)?.stuck ?? 0), 0),
  }))
}

/** The train on the tracks now (building or testing), else the latest one of any repo. */
export function trainNow(summaries: TrainSummary[]): ReleaseTrainNow | null {
  const all = summaries.flatMap((s) => s.trains.map((t) => ({ state: t.state, prNumber: t.prNumber, members: t.members, createdAt: t.createdAt, repo: s.repo })))
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const active = all.find((t) => t.state === 'building' || t.state === 'testing')
  if (active) return { ...active, active: true }
  return all[0] ? { ...all[0], active: false } : null
}
