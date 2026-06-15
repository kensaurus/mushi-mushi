/**
 * FILE: apps/admin/src/lib/useActivationStatus.ts
 * PURPOSE: Unified activation cockpit hook — replaces dual fetches from
 *          `/v1/admin/setup` + `/v1/admin/onboarding/stats` on first-run pages.
 */

import { useMemo } from 'react'
import type { ZodType } from 'zod'
import { usePageData } from './usePageData'
import { ActivationResponseSchema } from './apiSchemas'
import type { OnboardingStats } from '../components/onboarding/types'
import type { SetupResponse } from './useSetupStatus'

export type ActivationPhase = 'ingest' | 'dispatch' | 'loop'

export interface ActivationTopPriority {
  label: string
  to: string
  tone: 'plan' | 'do' | 'idle'
}

export interface ActivationPreflight {
  ready: boolean
  checks: Array<{ key: string; ready: boolean; label: string }>
}

export interface ActivationResponse {
  setup: SetupResponse
  stats: OnboardingStats
  preflight: ActivationPreflight | null
  phase: ActivationPhase
  top_priority: ActivationTopPriority
  feature_flags?: { activation_cockpit_v2?: boolean }
}

export function isActivationCockpitV2Enabled(): boolean {
  if (typeof import.meta.env.VITE_ACTIVATION_COCKPIT_V2 === 'string') {
    return import.meta.env.VITE_ACTIVATION_COCKPIT_V2 !== 'false'
  }
  return true
}

export function useActivationStatus(projectId: string | null) {
  const enabled = isActivationCockpitV2Enabled()
  const path = enabled
    ? projectId
      ? `/v1/admin/activation?project_id=${encodeURIComponent(projectId)}`
      : '/v1/admin/activation'
    : null

  // `ActivationResponseSchema` uses `.passthrough()`, so its inferred output
  // type carries an index signature that isn't structurally identical to the
  // curated `ActivationResponse` interface above. A single narrowing cast keeps
  // the runtime validation while satisfying `usePageData`'s `ZodType<T>` param.
  const query = usePageData<ActivationResponse>(path, {
    schema: ActivationResponseSchema as ZodType<ActivationResponse>,
  })

  const activeProject = useMemo(() => {
    if (!projectId || !query.data?.setup.projects?.length) {
      return query.data?.setup.projects?.[0] ?? null
    }
    return query.data.setup.projects.find((p) => p.project_id === projectId) ?? query.data.setup.projects[0] ?? null
  }, [projectId, query.data?.setup.projects])

  const selectors = useMemo(() => {
    if (!activeProject) {
      return {
        required_total: 0,
        required_complete: 0,
        total: 0,
        complete: 0,
        done: false,
      }
    }
    return {
      required_total: activeProject.required_total,
      required_complete: activeProject.required_complete,
      total: activeProject.total,
      complete: activeProject.complete,
      done: activeProject.done,
    }
  }, [activeProject])

  return {
    ...query,
    setup: query.data?.setup ?? null,
    stats: query.data?.stats ?? null,
    preflight: query.data?.preflight ?? null,
    phase: query.data?.phase ?? 'ingest',
    topPriority: query.data?.top_priority ?? null,
    activeProject,
    selectors,
    hasAnyProject: Boolean(query.data?.setup.has_any_project),
    isStepIncomplete: (stepId: string) => {
      const step = activeProject?.steps.find((s) => s.id === stepId)
      return step ? !step.complete : true
    },
    getStep: (stepId: string) => activeProject?.steps.find((s) => s.id === stepId) ?? null,
  }
}
