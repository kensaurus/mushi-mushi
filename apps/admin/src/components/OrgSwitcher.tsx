/**
 * FILE: apps/admin/src/components/OrgSwitcher.tsx
 * PURPOSE: Header dropdown for the active organization/team context.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import {
  ACTIVE_ORG_QUERY_PARAM,
  clearActiveOrg,
  getActiveOrgIdSnapshot,
  isValidOrgId,
  setActiveOrgIdSnapshot,
} from '../lib/activeOrg'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  ACTIVE_PROJECT_STORAGE_KEY,
} from '../lib/activeProject'
import { useCreateOrganization } from '../lib/useCreateOrganization'
import { headerDropdownPanelClass } from '../lib/appChrome'
import { HeaderContextChip, HeaderContextChipSkeleton } from './ui/chrome'

export interface OrganizationSummary {
  id: string
  slug: string
  name: string
  plan_id: string
  role: string
  is_personal?: boolean
  /**
   * Org-level billing posture from `organizations.billing_mode`.
   * When `'complimentary'` the team pill renders "admin" instead of the
   * underlying `plan_id` so internal staff / sponsored orgs don't read as
   * paying customers in the global header.
   */
  billing_mode?: 'stripe' | 'complimentary'
}

/**
 * Render the right-hand chip on each org row. Complimentary orgs get a
 * distinct "admin" label that overrides the raw `plan_id` so a comp Pro org
 * never reads as "Pro" in the header. Returned as a plain string so the
 * caller stays in control of layout / wrapping.
 */
function orgPillLabel(org: OrganizationSummary): string {
  return org.billing_mode === 'complimentary' ? 'admin' : org.plan_id
}

export function OrgSwitcher() {
  const orgsQuery = usePageData<{ organizations: OrganizationSummary[] }>('/v1/org', {
    scope: 'none',
  })
  const { data, loading } = orgsQuery
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  // Inline "create new team" affordance — same pattern as ProjectSwitcher
  // so users discover it in the same shape across the header.
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const newNameInputRef = useRef<HTMLInputElement | null>(null)
  const { create: createOrg, creating: submitting } = useCreateOrganization({
    onCreated: () => {
      setNewName('')
      setCreating(false)
      setOpen(false)
      orgsQuery.reload()
    },
  })
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (loading || !data?.organizations?.length) return
    const fromUrl = searchParams.get(ACTIVE_ORG_QUERY_PARAM)
    const fromStorage = getActiveOrgIdSnapshot()
    if (fromUrl && !isValidOrgId(fromUrl)) {
      const next = new URLSearchParams(searchParams)
      next.delete(ACTIVE_ORG_QUERY_PARAM)
      setSearchParams(next, { replace: true })
      clearActiveOrg()
    }
    const candidate = (fromUrl && isValidOrgId(fromUrl) ? fromUrl : null) ?? fromStorage
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

  // Auto-focus inline name input when "+ New team" is clicked. Defer to
  // next tick because the input only renders after `creating` flips true.
  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => newNameInputRef.current?.focus())
    } else {
      setNewName('')
    }
  }, [creating])

  if (loading) {
    return <HeaderContextChipSkeleton label="Loading team" />
  }
  const orgs = data?.organizations ?? []
  // Empty-state branch — previously the switcher returned `null` when a
  // user had zero org memberships. That stranded brand-new signups whose
  // personal-org trigger hadn't fired yet: with no switcher rendered
  // there was no in-product way to discover "+ New team", and the
  // POST /v1/admin/projects 400 ("You need to be an owner or admin of
  // an organization to create a project") had no recovery path in the
  // UI. The signup trigger added in 20260520300000_personal_org_on_signup
  // makes this state almost impossible going forward; the api edge
  // function's lazy-bootstrap fallback closes the rest of the gap. We
  // keep this branch as a third line of defense so a future regression
  // never silently dead-ends the user again.
  if (orgs.length === 0) {
    return (
      <div ref={containerRef} className="relative">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newName.trim() || submitting) return
              void createOrg(newName)
            }}
            className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/60 px-1.5 py-1"
          >
            <input
              ref={newNameInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setCreating(false)
                }
              }}
              placeholder="Team name"
              maxLength={120}
              className="w-32 min-w-0 rounded-sm border border-edge bg-surface-root px-2 py-0.5 text-2xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              aria-label="New team name"
            />
            <button
              type="submit"
              disabled={!newName.trim() || submitting}
              className="rounded-sm bg-brand px-2 py-0.5 text-2xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
            >
              {submitting ? '…' : 'Create'}
            </button>
          </form>
        ) : (
          <HeaderContextChip
            variant="accent"
            label={
              <>
                <span aria-hidden className="text-sm leading-none">+</span>
                <span>Create team</span>
              </>
            }
            onClick={() => setCreating(true)}
            title="You don't have any organizations yet — create your first team or workspace to start a project."
          />
        )}
      </div>
    )
  }

  const fromUrlOrg = searchParams.get(ACTIVE_ORG_QUERY_PARAM)
  const activeId =
    (fromUrlOrg && isValidOrgId(fromUrlOrg) ? fromUrlOrg : null) ??
    getActiveOrgIdSnapshot() ??
    orgs[0].id
  const active = orgs.find((o) => o.id === activeId) ?? orgs[0]

  function pick(id: string) {
    setActiveOrgIdSnapshot(id)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_ORG_QUERY_PARAM, id)
    // Dropping the pinned project when the team changes mirrors Supabase's
    // org switcher: the project switcher re-resolves against the new team's
    // project set instead of keeping a project from the previous org selected.
    next.delete(ACTIVE_PROJECT_QUERY_PARAM)
    try {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    } catch {
      // storage-disabled — URL param clear is enough
    }
    setSearchParams(next, { replace: true })
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <HeaderContextChip
        kicker="Team"
        label={active.name}
        badge={orgPillLabel(active)}
        badgeTone={active.billing_mode === 'complimentary' ? 'brand' : 'neutral'}
        title={
          active.billing_mode === 'complimentary'
            ? `Admin / complimentary org — feature set tracks the ${active.plan_id} tier`
            : undefined
        }
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {open && (
        <div
          className={`${headerDropdownPanelClass} w-72`}
        >
          <ul role="listbox" className="max-h-72 overflow-y-auto">
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
                      {org.role} · {orgPillLabel(org)}
                    </span>
                  </span>
                  {org.id === active.id && <span className="text-2xs text-brand">✓</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-edge-subtle bg-surface-raised/60">
            {/* "View team page" — shortcut into the org's members/settings
                surface so users don't have to hunt through the sidebar after
                opening this switcher. Closes the dropdown on click so the
                navigation feels intentional. */}
            <Link
              to="/organization/members"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-between gap-1.5 border-b border-edge-subtle px-2.5 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:bg-surface-overlay"
            >
              <span>View team page</span>
              <span aria-hidden className="text-fg-faint">→</span>
            </Link>
            {creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newName.trim() || submitting) return
                  void createOrg(newName)
                }}
                className="flex items-center gap-1.5 p-1.5"
              >
                <input
                  ref={newNameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setCreating(false)
                    }
                  }}
                  placeholder="New team name"
                  maxLength={120}
                  className="flex-1 min-w-0 rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  aria-label="New team name"
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || submitting}
                  className="rounded-sm bg-brand px-2 py-1 text-2xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
                >
                  {submitting ? '…' : 'Create'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-brand hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:bg-surface-overlay"
              >
                <span aria-hidden className="text-sm leading-none">+</span>
                <span>New team</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function useActiveOrgId(): string | null {
  const [searchParams] = useSearchParams()
  return searchParams.get(ACTIVE_ORG_QUERY_PARAM) ?? getActiveOrgIdSnapshot()
}
