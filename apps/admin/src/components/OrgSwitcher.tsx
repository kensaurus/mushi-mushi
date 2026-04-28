/**
 * FILE: apps/admin/src/components/OrgSwitcher.tsx
 * PURPOSE: Header dropdown for the active organization/team context.
 */

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import {
  ACTIVE_ORG_QUERY_PARAM,
  getActiveOrgIdSnapshot,
  setActiveOrgIdSnapshot,
} from '../lib/activeOrg'

export interface OrganizationSummary {
  id: string
  slug: string
  name: string
  plan_id: string
  role: string
  is_personal?: boolean
}

export function OrgSwitcher() {
  const { data, loading } = usePageData<{ organizations: OrganizationSummary[] }>('/v1/org')
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (loading || !data?.organizations?.length) return
    const fromUrl = searchParams.get(ACTIVE_ORG_QUERY_PARAM)
    const fromStorage = getActiveOrgIdSnapshot()
    const candidate = fromUrl ?? fromStorage
    const known = data.organizations.find((o) => o.id === candidate)
    if (known) {
      if (fromStorage !== known.id) setActiveOrgIdSnapshot(known.id)
      return
    }
    setActiveOrgIdSnapshot(data.organizations[0].id)
  }, [loading, data, searchParams])

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (loading) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/40 px-2 py-1 text-2xs text-fg-faint">
        Loading team…
      </div>
    )
  }
  const orgs = data?.organizations ?? []
  if (orgs.length === 0) return null

  const activeId = searchParams.get(ACTIVE_ORG_QUERY_PARAM) ?? getActiveOrgIdSnapshot() ?? orgs[0].id
  const active = orgs.find((o) => o.id === activeId) ?? orgs[0]

  function pick(id: string) {
    setActiveOrgIdSnapshot(id)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_ORG_QUERY_PARAM, id)
    setSearchParams(next, { replace: true })
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/60 px-2 py-1 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
      >
        <span className="text-3xs uppercase tracking-wider text-fg-faint">Team</span>
        <span className="max-w-[12rem] truncate font-medium">{active.name}</span>
        <span className="rounded bg-surface-overlay px-1 text-3xs uppercase text-fg-faint">
          {active.plan_id}
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-edge-subtle bg-surface-raised shadow-raised"
        >
          {orgs.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                role="option"
                aria-selected={org.id === active.id}
                onClick={() => pick(org.id)}
                className={`flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-overlay motion-safe:transition-colors ${
                  org.id === active.id ? 'bg-surface-overlay/60 text-fg' : 'text-fg-secondary'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{org.name}</span>
                  <span className="block truncate text-3xs font-mono text-fg-faint">
                    {org.role} · {org.plan_id}
                  </span>
                </span>
                {org.id === active.id && <span className="text-2xs text-brand">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function useActiveOrgId(): string | null {
  const [searchParams] = useSearchParams()
  return searchParams.get(ACTIVE_ORG_QUERY_PARAM) ?? getActiveOrgIdSnapshot()
}
