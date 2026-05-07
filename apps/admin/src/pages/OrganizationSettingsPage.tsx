import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { Badge, Btn, Card, EmptyState, ErrorAlert, Input, PageHeader, RelativeTime, SelectField, Tooltip } from '../components/ui'
import { IconCheck, IconClock, IconTrash, IconUndo } from '../components/icons'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { UpgradeBanner, UpgradeLockOverlay } from '../components/billing/UpgradeNudge'
import { useEntitlements } from '../lib/useEntitlements'
import { useUpdateOrganization } from '../lib/useUpdateOrganization'

// Undo window for soft-delete operations on this page. Long enough for the
// "wait, that wasn't who I meant" reaction (Nielsen reports ~5-10 s for
// recognition errors), short enough that the user doesn't think the action
// silently failed. Mirrors the project / key revoke windows so the rest of
// the admin reads as one cohesive system.
const UNDO_WINDOW_MS = 8000

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

interface Member {
  user_id: string
  email: string | null
  role: OrgRole
  invited_by: string | null
  created_at: string
}

interface Invitation {
  id: string
  email: string
  role: Exclude<OrgRole, 'owner'>
  // Server-resolved email of the inviter so we can render
  // "Invited 3h ago by alice@example.com" without a second fetch.
  // Nullable: legacy rows or deleted users surface as "by an admin".
  invited_by: string | null
  invited_by_email: string | null
  expires_at: string
  // Stamped by the API after Supabase auth.admin.inviteUserByEmail
  // is retried. Surfaces as "Resent · 1h ago" once we ship a Resend
  // affordance; rendered today only when the value is non-null.
  last_resent_at?: string | null
  created_at: string
}

interface MembersResponse {
  organization: { id: string; slug: string; name: string; plan_id: string } | null
  currentUserRole: OrgRole
  members: Member[]
  invitations: Invitation[]
}

const ROLE_TONE: Record<OrgRole, string> = {
  owner: 'bg-warn/10 text-warn border border-warn/30',
  admin: 'bg-brand-subtle text-brand',
  member: 'bg-ok-muted text-ok',
  viewer: 'bg-surface-overlay text-fg-muted',
}

export function OrganizationSettingsPage() {
  const activeOrgId = useActiveOrgId()
  const toast = useToast()
  const entitlements = useEntitlements()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Invitation['role']>('member')
  const [submitting, setSubmitting] = useState(false)
  // Local draft for the org rename input. Initialised lazily once the
  // server returns the org's current name (see effect below) so admins
  // can edit in-place without losing the field on background refetch.
  const [orgNameDraft, setOrgNameDraft] = useState('')
  // Pending-remove holds the member targeted by the Remove button. Replaces
  // the previous one-click DELETE which fired without any confirmation —
  // a single misclick could evict a teammate from every project in the org.
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null)
  // Soft-delete state. The DELETE call is deferred for `UNDO_WINDOW_MS` so
  // the user has a chance to back out from the toast. We optimistically
  // hide the row in the meantime so the page reads as if the action
  // already succeeded — matches Gmail's "Message sent / Undo" pattern.
  // Two stores so concurrent removes don't race: the Set drives render
  // filtering, the Map keeps each scheduled timeout addressable by id.
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(new Set())
  const removeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Same soft-delete pattern as members: cancelling an invite optimistically
  // hides the row, the DELETE call is deferred for `UNDO_WINDOW_MS`, and the
  // toast is the user's only affordance for backing out. Distinct from the
  // member structures so a "cancel invite" toast can't undo a "remove
  // teammate" action and vice versa.
  const [pendingCancelIds, setPendingCancelIds] = useState<Set<string>>(new Set())
  const cancelTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const path = activeOrgId ? `/v1/org/${activeOrgId}/members` : null
  const { data, loading, error, reload } = usePageData<MembersResponse>(path)

  const canManage = data?.currentUserRole === 'owner' || data?.currentUserRole === 'admin'
  // Renames are owner/admin-only on the backend; mirror it on the client so
  // members and viewers see a read-only chip instead of a disabled input
  // (the latter reads as broken UX rather than gating).
  const canRename = canManage
  const orgName = data?.organization?.name ?? ''

  // Hydrate / re-hydrate the rename draft whenever the server's name
  // changes. This handles two cases: the very first response after mount,
  // and any background refetch (StrictMode, focus, signal change). We
  // intentionally don't sync mid-edit — overwriting the user's keystrokes
  // every time the server echoes a stale value is the worst kind of
  // "controlled input fights the typing" bug.
  useEffect(() => {
    setOrgNameDraft(orgName)
  }, [orgName])

  const { update: updateOrg, updating: renamingOrg } = useUpdateOrganization({
    onUpdated: () => {
      // Reload local view so the page header / "current name" reflects
      // the new value immediately. The header pill (OrgSwitcher) refetches
      // on next mount/navigation; rename is rare enough that we don't need
      // a global cache-busting event for it.
      reload()
    },
  })
  // Source of truth: server-resolved entitlements (reflects all gating
  // including legacy grandfathered plans). Falls back to the org's
  // declared plan_id only while entitlements are still loading so the
  // page never reads as "locked" mid-fetch on a paid org.
  const teamsEnabled = entitlements.loading
    ? data?.organization?.plan_id === 'pro' || data?.organization?.plan_id === 'enterprise'
    : entitlements.has('teams')

  const sortedMembers = useMemo(
    () =>
      [...(data?.members ?? [])]
        // Hide rows that the user is currently undoing — they're already
        // pretending to be deleted from the user's POV. If the timer fires
        // and the DELETE succeeds, the next reload will drop them for real;
        // if Undo runs, we restore them in `cancelScheduledRemove`.
        .filter((m) => !pendingRemovalIds.has(m.user_id))
        .sort(
          (a, b) =>
            a.role.localeCompare(b.role) ||
            (a.email ?? '').localeCompare(b.email ?? ''),
        ),
    [data?.members, pendingRemovalIds],
  )

  async function submitRenameOrg() {
    if (!activeOrgId) return
    const next = orgNameDraft.trim()
    if (!next || next === orgName) return
    await updateOrg(activeOrgId, next)
  }

  async function invite() {
    if (!activeOrgId) return
    setSubmitting(true)
    const res = await apiFetch<{ invitation: Invitation }>(`/v1/org/${activeOrgId}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error('Invite failed', res.error?.message)
      return
    }
    toast.success('Invite sent', `${email} can now join this organization.`)
    setEmail('')
    reload()
  }

  async function changeRole(userId: string, nextRole: OrgRole) {
    if (!activeOrgId) return
    const res = await apiFetch(`/v1/org/${activeOrgId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: nextRole }),
    })
    if (!res.ok) {
      toast.error('Could not update role', res.error?.message)
      return
    }
    toast.success('Role updated')
    reload()
  }

  // Cancel any in-flight remove timers when the page unmounts so the DELETE
  // never lands after the user has navigated away (otherwise a user who
  // hits Remove and then immediately leaves would still evict a teammate
  // they meant to keep, with no toast left to undo from). Same logic applies
  // to in-flight invite cancellations — we don't want a stranded timer to
  // revoke an invitation seconds after the admin closes the tab.
  useEffect(() => {
    const memberTimers = removeTimers.current
    const inviteTimers = cancelTimers.current
    return () => {
      memberTimers.forEach((t) => clearTimeout(t))
      memberTimers.clear()
      inviteTimers.forEach((t) => clearTimeout(t))
      inviteTimers.clear()
    }
  }, [])

  const visibleInvitations = useMemo(
    () => (data?.invitations ?? []).filter((i) => !pendingCancelIds.has(i.id)),
    [data?.invitations, pendingCancelIds],
  )

  function cancelScheduledRemove(userId: string) {
    const timer = removeTimers.current.get(userId)
    if (timer) clearTimeout(timer)
    removeTimers.current.delete(userId)
    setPendingRemovalIds((prev) => {
      if (!prev.has(userId)) return prev
      const next = new Set(prev)
      next.delete(userId)
      return next
    })
  }

  function scheduleRemoveMember(member: Member) {
    if (!activeOrgId) return
    const orgId = activeOrgId
    const id = member.user_id
    const label = member.email ?? id

    // Optimistically hide the row. The toast becomes the user's only
    // affordance for the next 8 s — if they want this back, they have to
    // use the Undo action.
    setPendingRemovalIds((prev) => new Set(prev).add(id))
    setPendingRemove(null)

    const timer = setTimeout(async () => {
      removeTimers.current.delete(id)
      const res = await apiFetch(`/v1/org/${orgId}/members/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        // Restore the row so the user can retry. Surface the server's
        // message verbatim — most failures here are auth-shaped ("only
        // owners can remove other admins") and benefit from the literal
        // wording.
        setPendingRemovalIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        toast.error('Could not remove member', res.error?.message)
        return
      }
      // Successful DELETE — stop hiding the row optimistically and let the
      // server-side reload truth-up the list.
      setPendingRemovalIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      reload()
    }, UNDO_WINDOW_MS)

    removeTimers.current.set(id, timer)

    toast.push({
      tone: 'success',
      title: 'Member removed',
      description: `${label} will lose access in a few seconds.`,
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => cancelScheduledRemove(id),
      },
    })
  }

  function cancelScheduledInviteCancel(invitationId: string) {
    const timer = cancelTimers.current.get(invitationId)
    if (timer) clearTimeout(timer)
    cancelTimers.current.delete(invitationId)
    setPendingCancelIds((prev) => {
      if (!prev.has(invitationId)) return prev
      const next = new Set(prev)
      next.delete(invitationId)
      return next
    })
  }

  function scheduleCancelInvite(invite: Invitation) {
    if (!activeOrgId) return
    const orgId = activeOrgId
    const id = invite.id
    const label = invite.email

    // Optimistically hide the invite row. The toast is the user's only
    // affordance for the next 8 s — they can back out with Undo, otherwise
    // the timer fires and we issue the DELETE for real.
    setPendingCancelIds((prev) => new Set(prev).add(id))

    const timer = setTimeout(async () => {
      cancelTimers.current.delete(id)
      const res = await apiFetch(`/v1/org/${orgId}/invitations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        // Restore the row so the admin can see the invite still exists
        // and retry. The 'ALREADY_ACCEPTED' branch is benign — surface a
        // gentle nudge so the operator knows why nothing happened.
        setPendingCancelIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        const code = res.error?.code
        if (code === 'ALREADY_ACCEPTED') {
          toast.error('Invitation already accepted', `${label} is now a member — remove them from the roster instead.`)
        } else {
          toast.error('Could not cancel invitation', res.error?.message)
        }
        return
      }
      setPendingCancelIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      reload()
    }, UNDO_WINDOW_MS)

    cancelTimers.current.set(id, timer)

    toast.push({
      tone: 'success',
      title: 'Invitation cancelled',
      description: `${label} won't be able to join.`,
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => cancelScheduledInviteCancel(id),
      },
    })
  }

  if (!activeOrgId) return <EmptyState title="No team selected" description="Create a project first, then invite teammates from here." />
  if (loading) return <PanelSkeleton rows={5} label="Loading members" />
  if (error) return <ErrorAlert message={error} onRetry={reload} />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Members"
        description="Invite teammates, set their role, and share every project inside this organization."
      >
        <Badge className={teamsEnabled ? 'bg-ok-muted text-ok' : 'bg-warn/10 text-warn'}>
          {data?.organization?.plan_id ?? 'hobby'} plan
        </Badge>
      </PageHeader>

      {/* Team identity — rename the organization. Owner and admin only;
          everyone else sees a read-only chip so the UI doesn't lie about
          who can edit. Slug is shown for context but is intentionally not
          editable here: it's embedded in shareable URLs and Stripe
          metadata, so a cosmetic rename should never invalidate links. */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-fg">Team identity</h2>
            <p className="text-xs text-fg-muted">
              {canRename
                ? 'Rename the team. Visible in the header pill, invitations, and billing receipts.'
                : 'Only owners and admins can rename the team.'}
            </p>
          </div>
          {data?.organization?.slug && (
            <code className="text-2xs font-mono text-fg-faint" title="Team handle (immutable)">
              {data.organization.slug}
            </code>
          )}
        </div>
        {canRename ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitRenameOrg()
            }}
            className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
          >
            <Input
              label="Team name"
              value={orgNameDraft}
              maxLength={120}
              placeholder={orgName}
              onChange={(e) => setOrgNameDraft(e.target.value)}
              disabled={renamingOrg}
            />
            <div className="flex items-end gap-1">
              <Btn
                type="submit"
                disabled={
                  renamingOrg || !orgNameDraft.trim() || orgNameDraft.trim() === orgName
                }
                loading={renamingOrg}
                aria-label="Save team name"
                title="Save team name"
                className="px-2"
              >
                <IconCheck />
              </Btn>
              {orgNameDraft !== orgName && !renamingOrg && (
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOrgNameDraft(orgName)}
                  aria-label="Reset to current name"
                  title="Reset to current name"
                  className="px-2"
                >
                  <IconUndo />
                </Btn>
              )}
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm text-fg">
            <span className="font-medium">{orgName || '—'}</span>
          </div>
        )}
      </Card>

      {/* Plan-aware nudge: when the user lacks the `teams` entitlement
          (Hobby/Free org), surface a single editorial banner with a
          targeted "Upgrade to Pro" CTA. The banner self-removes once
          the user upgrades — see UpgradeBanner's internal gating. */}
      <UpgradeBanner
        flag="teams"
        density="comfy"
        taglineOverride="Teams ship with Pro and Enterprise. Upgrade to invite teammates, assign roles, and share every project."
      />

      {/* Invite teammate. The form stays mounted (so users see the
          shape they'd interact with after upgrading) but is wrapped in
          UpgradeLockOverlay when teams is locked. The overlay dims the
          form, blocks pointer events, and centers an Upgrade CTA — much
          stronger nudge than the previous "disabled inputs" affordance,
          which read as broken UX rather than gating. */}
      <Card className="p-4 relative">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Invite teammate</h2>
            <p className="text-xs text-fg-muted">
              {teamsEnabled
                ? 'Owner and admin roles can invite members on Pro+ plans.'
                : 'Preview — invite teammates after upgrading.'}
            </p>
          </div>
        </div>
        <UpgradeLockOverlay
          flag="teams"
          headline="Teams require Pro"
          taglineOverride="Invite teammates, set their role per project, and share every project in this org."
        >
          <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto]">
            <Input
              label="Email"
              value={email}
              placeholder="kensaurus@gmail.com"
              onChange={(e) => setEmail(e.target.value)}
              disabled={!teamsEnabled || !canManage}
            />
            <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Invitation['role'])} disabled={!teamsEnabled || !canManage}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </SelectField>
            <div className="flex items-end">
              {!canManage && teamsEnabled ? (
                <Tooltip content="Only owners and admins can invite new teammates. Ask your org owner to invite, or have them promote you to admin from this page.">
                  <span className="inline-flex">
                    <Btn disabled>Invite</Btn>
                  </span>
                </Tooltip>
              ) : (
                <Btn
                  onClick={invite}
                  disabled={!email || !teamsEnabled || !canManage || submitting}
                  loading={submitting}
                >
                  Invite
                </Btn>
              )}
            </div>
          </div>
        </UpgradeLockOverlay>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-edge-subtle bg-surface-overlay/30 text-left text-2xs uppercase tracking-wider text-fg-faint">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {sortedMembers.map((member) => (
              <tr key={member.user_id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-fg">{member.email ?? member.user_id}</div>
                  <div className="font-mono text-3xs text-fg-faint">{member.user_id}</div>
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <select
                      value={member.role}
                      onChange={(e) => void changeRole(member.user_id, e.target.value as OrgRole)}
                      className="rounded border border-edge-subtle bg-surface-raised px-2 py-1 text-xs text-fg"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <Badge className={ROLE_TONE[member.role]}>{member.role}</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingRemove(member)}
                    disabled={!canManage || member.role === 'owner'}
                    aria-label={`Remove ${member.email ?? member.user_id}`}
                    title={
                      member.role === 'owner'
                        ? 'Owners cannot be removed from the org'
                        : `Remove ${member.email ?? member.user_id}`
                    }
                    className="px-2 text-fg-secondary hover:text-danger hover:bg-danger-muted/15"
                  >
                    <IconTrash />
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {visibleInvitations.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">Pending invitations</h2>
            <span className="text-2xs text-fg-faint">{visibleInvitations.length} open</span>
          </div>
          <ul className="space-y-2">
            {visibleInvitations.map((invite) => {
              // Pre-compute expiry signal so a near-expiry invite reads as
              // "decaying soon" rather than just another row. We treat
              // anything in the next 24h as a warn tone — past that, the
              // server already hides expired invites from the response.
              const expiresMs = new Date(invite.expires_at).getTime() - Date.now()
              const expiresSoon = expiresMs > 0 && expiresMs < 24 * 60 * 60 * 1000
              const expired = expiresMs <= 0
              const inviterLabel = invite.invited_by_email ?? (invite.invited_by ? 'an admin' : null)
              return (
                <li
                  key={invite.id}
                  className="rounded border border-edge-subtle bg-surface-overlay/30 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-fg" title={invite.email}>
                        {invite.email}
                      </div>
                      {/* Metadata strip — when invited, by whom, and when it
                          expires. Each piece links to a tooltip with the
                          absolute timestamp so admins can audit a row
                          without leaving the page. Inviter falls back to
                          "an admin" if the user_id couldn't be resolved
                          (deleted account, legacy row pre-migration). */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-faint">
                        <span className="inline-flex items-center gap-1">
                          Invited <RelativeTime value={invite.created_at} className="text-fg-muted" />
                        </span>
                        {inviterLabel && (
                          <span className="text-fg-faint">
                            by <span className="text-fg-muted">{inviterLabel}</span>
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 ${expired ? 'text-danger' : expiresSoon ? 'text-warn' : 'text-fg-faint'}`}
                          title={`Expires ${new Date(invite.expires_at).toLocaleString()}`}
                        >
                          <IconClock className="size-3" />
                          {expired ? 'expired' : 'expires'} <RelativeTime value={invite.expires_at} className={expired ? 'text-danger' : expiresSoon ? 'text-warn' : 'text-fg-muted'} />
                        </span>
                        {invite.last_resent_at && (
                          <span className="text-fg-faint">
                            · resent <RelativeTime value={invite.last_resent_at} className="text-fg-muted" />
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={ROLE_TONE[invite.role]}>{invite.role}</Badge>
                      {canManage ? (
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={() => scheduleCancelInvite(invite)}
                          aria-label={`Cancel invitation for ${invite.email}`}
                          title={`Cancel invitation for ${invite.email}`}
                          className="px-2 text-fg-secondary hover:text-danger hover:bg-danger-muted/15"
                        >
                          <IconTrash />
                        </Btn>
                      ) : (
                        <Tooltip content="Only owners and admins can cancel invitations.">
                          <span className="inline-flex">
                            <Btn size="sm" variant="ghost" disabled className="px-2 text-fg-faint">
                              <IconTrash />
                            </Btn>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title="Remove this teammate?"
          body={`${pendingRemove.email ?? pendingRemove.user_id} will lose access to every project in ${data?.organization?.name ?? 'this organization'} after a short undo window. They can be re-invited later, but anything they had drafted in their own session will be gone.`}
          confirmLabel="Remove member"
          cancelLabel="Keep member"
          tone="danger"
          onConfirm={() => scheduleRemoveMember(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
