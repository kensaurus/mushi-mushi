/**
 * FILE: apps/admin/src/lib/useDispatchTargetRepo.ts
 * PURPOSE: Which linked repo a "Dispatch fix" opens its PR against.
 *
 * Path-glob routing cannot tell two repos apart when both own `src/**`, or
 * when a bundled backend's stack frames are `dist/*.mjs`, so a project with
 * several linked repos lets the person choose. The choice starts on the repo
 * the server would pick anyway (the primary) and is sent as `targetRepoId`
 * only when there is more than one repo to choose from.
 *
 * A Sentry report names the build it came from (`soloboss-backend@4.72.0`).
 * When exactly one linked repo matches that name better than the others, the
 * choice starts there instead: Solo Boss's backend errors started on its
 * primary documentation repo, so a dispatched fix went to the wrong code
 * (2026-11-24).
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
  /** The repo the report's release names, when one matches clearly. */
  suggestedRepoId?: string | null
}

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The one repo whose name matches the release's package name best
 * (`soloboss-backend@4.72.0` → `solo-boss-cloud_backend`), or null on a tie,
 * no match, or fewer than two repos.
 * @internal Exported for unit tests only.
 */
export function repoMatchingRelease(repos: readonly LinkedRepo[], release: string | null | undefined): string | null {
  if (!release || repos.length < 2) return null
  const pkg = release.replace(/@[^@]*$/, '') // drop "@4.72.0", keep a scope
  const tokens = words(pkg)
  if (tokens.length === 0) return null
  const scored = repos.map((r) => {
    const name = squash(r.repo_url.replace(/\.git$/, '').split('/').pop() ?? '')
    return { id: r.id, score: tokens.filter((t) => name.includes(t)).length }
  })
  const best = Math.max(...scored.map((x) => x.score))
  const top = scored.filter((x) => x.score === best)
  return best > 0 && top.length === 1 ? top[0].id : null
}

export function useDispatchTargetRepo(
  projectId: string | null | undefined,
  /** The build the report came from (reports.sentry_release), to start on the matching repo. */
  release?: string | null,
): DispatchTargetRepo {
  const { data } = usePageData<LinkedRepo[]>(
    projectId ? `/v1/admin/repo/repos?project_id=${encodeURIComponent(projectId)}` : null,
  )
  const repos = Array.isArray(data) ? data : []
  const [choice, setChoice] = useState<string | null>(null)
  const primaryId = repos.find((r) => r.is_primary)?.id ?? ''
  const suggestedId = repoMatchingRelease(repos, release)
  const startId = suggestedId ?? primaryId
  const targetRepoId = choice !== null && (choice === '' || repos.some((r) => r.id === choice)) ? choice : startId
  const target = repos.find((r) => r.id === targetRepoId) ?? null
  return {
    repos,
    targetRepoId,
    setTargetRepoId: setChoice,
    target,
    suggestedRepoId: suggestedId,
    // The primary is the server's own default, and leaving it unsent keeps the
    // normal cross-repo fan-out; a non-primary pick means that repo only.
    dispatchTargetRepoId: repos.length > 1 && targetRepoId && targetRepoId !== primaryId ? targetRepoId : undefined,
  }
}
