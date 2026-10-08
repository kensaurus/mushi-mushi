/**
 * FILE: apps/admin/src/components/portfolio/ProjectGroupsBar.tsx
 * PURPOSE: Group filter chips for the portfolio, plus a small manager to
 *          create, rename, delete and fill groups (Plan 021). Owners and
 *          admins can change groups; the server enforces it.
 */

import { useState } from 'react'
import { Btn, Callout, Card } from '../ui'
import { IconPencil, IconTrash } from '../icons'
import { ConfirmDialog } from '../ConfirmDialog'
import { apiFetchMutate } from '../../lib/supabase'
import { CHIP_TONE, SELECTED_TONE, SELECTED_TONE_IDLE } from '../../lib/chipTone'
import { groupTone, projectGroupsPath, type ProjectGroup } from '../../lib/projectGroups'

interface Props {
  orgId: string
  groups: ProjectGroup[]
  /** Every app in the team, for the membership checklist. */
  apps: Array<{ projectId: string; name: string }>
  active: string | null
  onSelect: (slug: string | null) => void
  onChanged: () => void
}

export function ProjectGroupsBar({ orgId, groups, apps, active, onSelect, onChanged }: Props) {
  const [managing, setManaging] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ProjectGroup | null>(null)
  const base = projectGroupsPath(orgId)
  const current = groups.find((g) => g.slug === active) ?? null

  async function run(path: string, method: string, body: unknown) {
    setBusy(true)
    setError(null)
    const res = await apiFetchMutate(path, { method, body: JSON.stringify(body) })
    setBusy(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'That did not work. Try again.')
      return false
    }
    onChanged()
    return true
  }

  async function create() {
    const name = newName.trim()
    if (!name) return
    if (await run(base, 'POST', { name })) setNewName('')
  }

  async function toggle(group: ProjectGroup, projectId: string) {
    const next = group.project_ids.includes(projectId)
      ? group.project_ids.filter((p) => p !== projectId)
      : [...group.project_ids, projectId]
    await run(`/v1/admin/orgs/${orgId}/project-groups/${group.id}/projects`, 'PUT', { project_ids: next })
  }

  async function rename(group: ProjectGroup) {
    const name = renaming?.trim()
    if (!name || name === group.name) {
      setRenaming(null)
      return
    }
    if (await run(`/v1/admin/orgs/${orgId}/project-groups/${group.id}`, 'PATCH', { name })) {
      setRenaming(null)
      // The slug follows the name; keep the filter on the renamed group.
      if (active === group.slug) onSelect(null)
    }
  }

  async function remove(group: ProjectGroup) {
    if (await run(`/v1/admin/orgs/${orgId}/project-groups/${group.id}`, 'DELETE', {})) {
      setDeleting(null)
      if (active === group.slug) onSelect(null)
    }
  }

  const chip = (selected: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${selected ? SELECTED_TONE : SELECTED_TONE_IDLE}`

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Filter apps by group" className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(active === null)} aria-pressed={active === null} onClick={() => onSelect(null)}>
          All apps
        </button>
        {groups.map((g) => (
          <button key={g.id} type="button" className={chip(active === g.slug)} aria-pressed={active === g.slug} onClick={() => onSelect(g.slug)}>
            <span aria-hidden className={`h-2 w-2 rounded-full border ${CHIP_TONE[groupTone(g.color)]}`} />
            {g.name}
            <span className="text-fg-faint">{g.project_ids.length}</span>
          </button>
        ))}
        <Btn size="sm" variant="ghost" onClick={() => setManaging((v) => !v)} aria-expanded={managing}>
          {managing ? 'Done' : groups.length ? 'Manage groups' : 'Group your apps'}
        </Btn>
      </div>

      {managing && (
        <Card className="flex flex-col gap-3 p-3">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <label className="sr-only" htmlFor="new-group-name">New group name</label>
            <input
              id="new-group-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New group, e.g. Client work"
              maxLength={60}
              className="min-w-0 flex-1 rounded-md border border-edge-subtle bg-surface px-2 py-1 text-xs"
            />
            <Btn size="sm" type="submit" disabled={busy || !newName.trim()}>Add group</Btn>
          </form>

          {current ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {renaming !== null ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void rename(current)
                    }}
                  >
                    <label className="sr-only" htmlFor="rename-group">Group name</label>
                    <input
                      id="rename-group"
                      value={renaming}
                      onChange={(e) => setRenaming(e.target.value)}
                      maxLength={60}
                      autoFocus
                      className="min-w-0 flex-1 rounded-md border border-edge-subtle bg-surface px-2 py-1 text-xs"
                    />
                    <Btn size="sm" type="submit" disabled={busy}>Save</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Btn>
                  </form>
                ) : (
                  <p className="text-xs font-medium text-fg">Apps in “{current.name}”</p>
                )}
                {renaming === null && (
                  <span className="flex gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => setRenaming(current.name)} aria-label={`Rename ${current.name}`}><IconPencil /></Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setDeleting(current)} aria-label={`Delete ${current.name}`}><IconTrash /></Btn>
                  </span>
                )}
              </div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {apps.map((a) => (
                  <li key={a.projectId}>
                    <label className="flex items-center gap-2 text-xs text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={current.project_ids.includes(a.projectId)}
                        onChange={() => void toggle(current, a.projectId)}
                        disabled={busy}
                      />
                      {a.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-fg-muted">Pick a group above to choose its apps.</p>
          )}
          {error && <Callout tone="danger"><span role="alert">{error}</span></Callout>}
        </Card>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body="The apps stay; only the group goes."
          confirmLabel="Delete group"
          tone="danger"
          loading={busy}
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
