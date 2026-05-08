/**
 * FILE: apps/admin/src/lib/useUpdateProject.ts
 * PURPOSE: Single source of truth for renaming a project from the admin
 *          client. Mirrors `useCreateProject` so every rename surface
 *          (ProjectsPage inline rename, future Settings affordance) shares
 *          the same toast / error vocabulary.
 *
 *          Posts to `PATCH /v1/admin/projects/:id`. The server enforces
 *          owner/admin authz; we don't pre-check on the client because
 *          the visible "Rename" button is already gated on the row's
 *          `canDeleteProject` rule, which mirrors the same role tiers.
 */

import { useCallback, useState } from 'react'
import { apiFetch } from './supabase'
import { useToast } from './toast'

interface UpdatedProject {
  id: string
  name: string
  slug: string
}

interface Options {
  onUpdated?: (project: UpdatedProject) => void
}

export function useUpdateProject({ onUpdated }: Options = {}) {
  const toast = useToast()
  const [updating, setUpdating] = useState(false)

  const update = useCallback(
    async (projectId: string, rawName: string): Promise<UpdatedProject | null> => {
      const name = rawName.trim()
      if (!projectId || !name) return null
      setUpdating(true)
      try {
        const res = await apiFetch<{ project: UpdatedProject }>(
          `/v1/admin/projects/${projectId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ name }),
          },
        )
        if (!res.ok || !res.data?.project) {
          throw new Error(res.error?.message ?? 'Update failed')
        }
        toast.success('Project renamed', name)
        onUpdated?.(res.data.project)
        return res.data.project
      } catch (err) {
        toast.error('Failed to rename project', err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setUpdating(false)
      }
    },
    [toast, onUpdated],
  )

  return { update, updating }
}
