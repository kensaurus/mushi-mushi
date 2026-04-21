/**
 * FILE: apps/admin/src/lib/useCreateProject.ts
 * PURPOSE: Single source of truth for creating a new project from the admin
 *          client. Three call sites use it (ProjectsPage, OnboardingPage,
 *          ProjectSwitcher inline create) and all three used to duplicate
 *          the same six-line POST + toast + reload dance.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from './supabase'
import { useToast } from './toast'

interface CreatedProject {
  id: string
  slug: string
}

interface Options {
  /** Called after the project is created successfully with the new id/slug. */
  onCreated?: (project: CreatedProject) => void
  /** Whether to auto-switch the active project to the newly created one
   *  (writes `?project=<id>` + localStorage). Default: true. */
  autoSelect?: boolean
}

const STORAGE_KEY = 'mushi:active_project_id'

export function useCreateProject({ onCreated, autoSelect = true }: Options = {}) {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [creating, setCreating] = useState(false)

  const create = useCallback(
    async (rawName: string): Promise<CreatedProject | null> => {
      const name = rawName.trim()
      if (!name) return null
      setCreating(true)
      try {
        const res = await apiFetch<CreatedProject>('/v1/admin/projects', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        if (!res.ok || !res.data) {
          throw new Error(res.error?.message ?? 'Create failed')
        }
        toast.success('Project created', name)
        if (autoSelect) {
          try {
            localStorage.setItem(STORAGE_KEY, res.data.id)
          } catch {
            /* private mode */
          }
          const next = new URLSearchParams(searchParams)
          next.set('project', res.data.id)
          setSearchParams(next, { replace: true })
        }
        onCreated?.(res.data)
        return res.data
      } catch (err) {
        toast.error(
          'Failed to create project',
          err instanceof Error ? err.message : String(err),
        )
        return null
      } finally {
        setCreating(false)
      }
    },
    [toast, autoSelect, onCreated, searchParams, setSearchParams],
  )

  return { create, creating }
}
