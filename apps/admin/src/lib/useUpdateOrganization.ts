/**
 * FILE: apps/admin/src/lib/useUpdateOrganization.ts
 * PURPOSE: Single source of truth for renaming the active team (organization)
 *          from the admin client. Mirrors `useCreateOrganization` so every
 *          rename surface (OrganizationSettingsPage, future inline edits)
 *          shares the same toast / error vocabulary.
 *
 *          Posts to `PATCH /v1/org/:id`. Returns `{ update, updating }` so
 *          callers can drive their own form state and disable submit while
 *          the request is in flight.
 */

import { useCallback, useState } from 'react'
import { apiFetch } from './supabase'
import { useToast } from './toast'

interface UpdatedOrganization {
  id: string
  slug: string
  name: string
  plan_id: string
  billing_mode?: 'stripe' | 'complimentary'
  is_personal: boolean
  created_at: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

interface Options {
  onUpdated?: (org: UpdatedOrganization) => void
}

export function useUpdateOrganization({ onUpdated }: Options = {}) {
  const toast = useToast()
  const [updating, setUpdating] = useState(false)

  const update = useCallback(
    async (orgId: string, rawName: string): Promise<UpdatedOrganization | null> => {
      const name = rawName.trim()
      if (!orgId || !name) return null
      setUpdating(true)
      try {
        const res = await apiFetch<{ organization: UpdatedOrganization }>(`/v1/org/${orgId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        })
        if (!res.ok || !res.data?.organization) {
          throw new Error(res.error?.message ?? 'Update failed')
        }
        toast.success('Team renamed', name)
        onUpdated?.(res.data.organization)
        return res.data.organization
      } catch (err) {
        toast.error('Failed to rename team', err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setUpdating(false)
      }
    },
    [toast, onUpdated],
  )

  return { update, updating }
}
