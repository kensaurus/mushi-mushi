/**
 * FILE: apps/admin/src/lib/useCreateOrganization.ts
 * PURPOSE: Single source of truth for the customer-side "create new team"
 *          flow. Mirrors `useCreateProject` so the OrgSwitcher footer in
 *          the global header (and any future onboarding step) all share
 *          the same toast / error surface.
 *
 *          Posts to `/v1/org` and, when successful, switches the active
 *          org to the freshly created workspace so the rest of the
 *          chrome (PlanBadge, header pill, page data hooks) reflects the
 *          new context immediately. Personal orgs are created by an auth
 *          trigger; this hook is exclusively for collaborative teams.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from './supabase'
import { ACTIVE_ORG_QUERY_PARAM, setActiveOrgIdSnapshot } from './activeOrg'
import { ACTIVE_PROJECT_QUERY_PARAM, clearActiveProject } from './activeProject'
import { useToast } from './toast'

interface CreatedOrganization {
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
  /** Called after the org is created with the new record. */
  onCreated?: (org: CreatedOrganization) => void
  /** Whether to switch the active org to the newly created one (writes
   *  `?org=<id>` + localStorage). Default: true. */
  autoSelect?: boolean
}

export function useCreateOrganization({ onCreated, autoSelect = true }: Options = {}) {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [creating, setCreating] = useState(false)

  const create = useCallback(
    async (rawName: string): Promise<CreatedOrganization | null> => {
      const name = rawName.trim()
      if (!name) return null
      setCreating(true)
      try {
        const res = await apiFetch<{ organization: CreatedOrganization }>('/v1/org', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        if (!res.ok || !res.data?.organization) {
          throw new Error(res.error?.message ?? 'Create failed')
        }
        const org = res.data.organization
        toast.success('Team created', name)
        if (autoSelect) {
          setActiveOrgIdSnapshot(org.id)
          clearActiveProject()
          const next = new URLSearchParams(searchParams)
          next.set(ACTIVE_ORG_QUERY_PARAM, org.id)
          next.delete(ACTIVE_PROJECT_QUERY_PARAM)
          setSearchParams(next, { replace: true })
        }
        onCreated?.(org)
        return org
      } catch (err) {
        toast.error('Failed to create team', err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setCreating(false)
      }
    },
    [toast, autoSelect, onCreated, searchParams, setSearchParams],
  )

  return { create, creating }
}
