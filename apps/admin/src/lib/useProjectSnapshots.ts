/**
 * FILE: apps/admin/src/lib/useProjectSnapshots.ts
 * PURPOSE: Index GET /v1/admin/projects snapshot fields by project id for
 *          header/switcher chrome without duplicating setup checklist data.
 */

import { useMemo } from 'react'
import { usePageData } from './usePageData'
import type { ProjectSnapshot } from './projectSnapshotTypes'

interface ProjectsListResponse {
  projects: ProjectSnapshot[]
}

export function useProjectSnapshots() {
  const { data, loading, error, reload } = usePageData<ProjectsListResponse>('/v1/admin/projects')

  const byId = useMemo(() => {
    const map = new Map<string, ProjectSnapshot>()
    for (const p of data?.projects ?? []) {
      map.set(p.id, p)
    }
    return map
  }, [data])

  return {
    byId,
    projects: data?.projects ?? [],
    loading,
    error,
    reload,
    ready: !loading && !error,
  }
}
