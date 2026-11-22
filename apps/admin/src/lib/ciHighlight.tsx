/**
 * FILE: apps/admin/src/lib/ciHighlight.tsx
 * PURPOSE: Linked highlighting on the CI page (2026-11-17). The provider and hooks now live in
 *          the shared signal kit (`components/signal/linkedHighlight.tsx`, 2026-11-18); this
 *          module keeps the CI names and adds the CI-specific keys (app, job, machine).
 */

import { HighlightProvider, useLinked, type HighlightKey } from '../components/signal/linkedHighlight'

export type CiKey = HighlightKey

export const CiHighlightProvider = HighlightProvider
export const useCiLink = useLinked

/** The keys of one job: its app (repo), the job type, and the runner it ran on. */
export function ciJobKeys(job: { repo: string; jobName: string; runnerName?: string | null }): CiKey[] {
  const keys = [`repo:${job.repo}`, `job:${job.repo}|${job.jobName}`]
  if (job.runnerName) keys.push(`runner:${job.runnerName}`)
  return keys
}

export const ciRepoKey = (repo: string): CiKey => `repo:${repo}`
export const ciJobKey = (repo: string, jobName: string): CiKey => `job:${repo}|${jobName}`
export const ciRunnerKey = (runner: string): CiKey => `runner:${runner}`
