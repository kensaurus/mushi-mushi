/**
 * FILE: apps/admin/src/lib/useSetupStatus.ts
 * PURPOSE: Single-source-of-truth hook for the DB-backed onboarding checklist.
 *          Wraps `usePageData('/v1/admin/setup')` and exposes typed selectors
 *          consumed by:
 *            - DashboardPage (banner mode SetupChecklist + redirect logic)
 *            - OnboardingPage (wizard mode)
 *            - per-page EmptyState nudges (e.g. "you need to install the SDK
 *              before reports show up here")
 */

import { useMemo } from 'react'
import { usePageData } from './usePageData'

export type SetupStepId =
  | 'project_created'
  | 'api_key_generated'
  | 'sdk_installed'
  | 'first_report_received'
  | 'github_connected'
  | 'sentry_connected'
  | 'byok_anthropic'
  | 'first_fix_dispatched'

export interface SetupStep {
  id: SetupStepId
  label: string
  description: string
  complete: boolean
  required: boolean
  cta_to: string
  cta_label: string
}

export interface SetupProject {
  project_id: string
  project_name: string
  project_slug: string
  created_at: string
  steps: SetupStep[]
  required_total: number
  required_complete: number
  total: number
  complete: number
  done: boolean
  report_count: number
  fix_count: number
}

export interface SetupResponse {
  has_any_project: boolean
  projects: SetupProject[]
}

interface SetupSelectors {
  /** Aggregated counts across the active project (for the banner). */
  required_total: number
  required_complete: number
  total: number
  complete: number
  done: boolean
}

export interface UseSetupStatusResult {
  /** Raw payload (null while loading). */
  data: SetupResponse | null
  loading: boolean
  error: string | null
  reload: () => void
  /** True when the current user owns at least one project. */
  hasAnyProject: boolean
  /** The active project (first one for now; will become URL-driven in wave 2). */
  activeProject: SetupProject | null
  /** Convenience selectors keyed off the active project. */
  selectors: SetupSelectors
  /** Quick check: is a particular step incomplete on the active project? */
  isStepIncomplete: (id: SetupStepId) => boolean
  /** Find a single step's metadata on the active project. */
  getStep: (id: SetupStepId) => SetupStep | null
}

const EMPTY_SELECTORS: SetupSelectors = {
  required_total: 0,
  required_complete: 0,
  total: 0,
  complete: 0,
  done: false,
}

export function useSetupStatus(activeProjectId?: string | null): UseSetupStatusResult {
  const { data, loading, error, reload } = usePageData<SetupResponse>('/v1/admin/setup')

  return useMemo(() => {
    const projects = data?.projects ?? []
    const explicit = activeProjectId
      ? projects.find(p => p.project_id === activeProjectId) ?? null
      : null
    const activeProject = explicit ?? projects[0] ?? null

    const selectors: SetupSelectors = activeProject
      ? {
          required_total: activeProject.required_total,
          required_complete: activeProject.required_complete,
          total: activeProject.total,
          complete: activeProject.complete,
          done: activeProject.done,
        }
      : EMPTY_SELECTORS

    const stepMap = new Map(activeProject?.steps.map(s => [s.id, s] as const) ?? [])

    return {
      data,
      loading,
      error,
      reload,
      hasAnyProject: Boolean(data?.has_any_project),
      activeProject,
      selectors,
      isStepIncomplete: (id: SetupStepId) => {
        if (!activeProject) return true
        const step = stepMap.get(id)
        return !step?.complete
      },
      getStep: (id: SetupStepId) => stepMap.get(id) ?? null,
    }
  }, [data, loading, error, reload, activeProjectId])
}
