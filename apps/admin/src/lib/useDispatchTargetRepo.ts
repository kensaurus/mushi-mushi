/**
 * FILE: apps/admin/src/lib/useDispatchTargetRepo.ts
 * PURPOSE: Which linked repo a "Dispatch fix" opens its PR against.
 *
 * Path-glob routing cannot tell two repos apart when both own `src/**`, or
 * when a bundled backend's stack frames are `dist/*.mjs`, so a project with
 * several linked repos lets the person choose. The choice starts on the repo
 * the server would pick anyway (the primary) and is sent as `targetRepoId`
 * only when there is more than one repo to choose from.
 */

import { useState } from 'react'
import { usePageData } from './usePageData'

/** The project_repos columns the picker reads (GET /v1/admin/repo/repos). */
interface LinkedRepo {
  id: string
  repo_url: string
  default_branch: string | null
  is_primary: boolean
}

export interface DispatchTargetRepo {
  repos: LinkedRepo[]
  /** The selected repo id; '' means "the project default" (no primary row). */
  targetRepoId: string
  setTargetRepoId: (id: string) => void
  /** The selected repo, for the confirm copy; null for the project default. */
  target: LinkedRepo | null
  /** What to send as `targetRepoId`: undefined unless there is a choice. */
  dispatchTargetRepoId: string | undefined
}

export function useDispatchTargetRepo(projectId: string | null | undefined): DispatchTargetRepo {
  const { data } = usePageData<LinkedRepo[]>(
    projectId ? `/v1/admin/repo/repos?project_id=${encodeURIComponent(projectId)}` : null,
  )
  const repos = Array.isArray(data) ? data : []
  const [choice, setChoice] = useState<string | null>(null)
  const primaryId = repos.find((r) => r.is_primary)?.id ?? ''
  const targetRepoId = choice !== null && (choice === '' || repos.some((r) => r.id === choice)) ? choice : primaryId
  const target = repos.find((r) => r.id === targetRepoId) ?? null
  return {
    repos,
    targetRepoId,
    setTargetRepoId: setChoice,
    target,
    dispatchTargetRepoId: repos.length > 1 && targetRepoId ? targetRepoId : undefined,
  }
}
