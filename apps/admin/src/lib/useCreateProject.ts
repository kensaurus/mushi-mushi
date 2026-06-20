/**
 * FILE: apps/admin/src/lib/useCreateProject.ts
 * PURPOSE: Single source of truth for creating a new project from the admin
 *          client. Three call sites use it (ProjectsPage, OnboardingPage,
 *          ProjectSwitcher inline create) and all three used to duplicate
 *          the same six-line POST + toast + reload dance.
 *
 * ERROR SHAPE
 * -----------
 * Two-channel reporting: a transient toast (always) + an `error` state
 * the caller can read to render a structured `<ErrorAlert>` with the
 * actual server `{ code, message }` payload. The structured channel is
 * what makes the difference between "Something went wrong" and "You
 * need to be an owner or admin of an organization to create a project
 * — [Create a team]". Beta users have started hitting `NO_ORGANIZATION`
 * after signup and the toast alone disappears before they can act on
 * it. The error state survives until the next attempt or until the
 * caller explicitly clears it via `clearError()`.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from './supabase'
import { ACTIVE_PROJECT_QUERY_PARAM, setActiveProjectIdSnapshot } from './activeProject'
import { useToast } from './toast'

export interface CreatedProject {
  id: string
  slug: string
  name: string
  /** Raw SDK ingest key (report:write scope) — returned exactly once at project creation. */
  apiKey: string | null
  /** 12-char key prefix for display (e.g. mushi_a1b2c3). */
  keyPrefix: string | null
}

/**
 * Stable surface error code from the api edge function. Kept loose
 * (`string`) at the public boundary because new error codes ship from
 * the backend independently; only the ones the UI branches on are
 * enumerated for documentation / IDE-completion.
 */
export type CreateProjectErrorCode =
  | 'NO_ORGANIZATION'
  | 'FORBIDDEN'
  | 'INVALID_ORGANIZATION_ID'
  | 'INVALID_NAME'
  | (string & {})

export interface CreateProjectError {
  code: CreateProjectErrorCode
  message: string
}

interface Options {
  /** Called after the project is created successfully with the new id/slug. */
  onCreated?: (project: CreatedProject) => void
  /** Whether to auto-switch the active project to the newly created one
   *  (writes `?project=<id>` + localStorage). Default: true. */
  autoSelect?: boolean
}

export function useCreateProject({ onCreated, autoSelect = true }: Options = {}) {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<CreateProjectError | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const create = useCallback(
    async (rawName: string): Promise<CreatedProject | null> => {
      const name = rawName.trim()
      if (!name) {
        // Surface a structured error for the empty-name case so the
        // caller can render the same `<ErrorAlert>` and keep the UX
        // consistent with server-side validation failures.
        const empty: CreateProjectError = {
          code: 'INVALID_NAME',
          message: 'Project name is required.',
        }
        setError(empty)
        return null
      }
      setCreating(true)
      setError(null)
      try {
        const res = await apiFetch<CreatedProject>('/v1/admin/projects', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        if (!res.ok || !res.data) {
          const structured: CreateProjectError = {
            code: res.error?.code ?? 'UNKNOWN',
            message: res.error?.message ?? 'Create failed',
          }
          setError(structured)
          // Keep the toast so the user still gets the at-a-glance feedback,
          // but make the message specific so it's useful at the toast layer
          // too — the previous "Failed to create project — Create failed"
          // string was actively unhelpful.
          toast.error('Couldn\u2019t create project', structured.message)
          return null
        }
        toast.success('Project created', name)
        if (autoSelect) {
          setActiveProjectIdSnapshot(res.data.id)
          const next = new URLSearchParams(searchParams)
          next.set(ACTIVE_PROJECT_QUERY_PARAM, res.data.id)
          setSearchParams(next, { replace: true })
        }
        const created: CreatedProject = { ...res.data, name }
        onCreated?.(created)
        return created
      } catch (err) {
        // Network / fetch-level failure (offline, CORS, DNS, etc).
        // Surface it as a transport error code so callers can branch
        // separately from a backend rejection.
        const structured: CreateProjectError = {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : String(err),
        }
        setError(structured)
        toast.error('Couldn\u2019t reach the server', structured.message)
        return null
      } finally {
        setCreating(false)
      }
    },
    [toast, autoSelect, onCreated, searchParams, setSearchParams],
  )

  return { create, creating, error, clearError }
}
