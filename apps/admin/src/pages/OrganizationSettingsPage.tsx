import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { Badge, Btn, Card, EmptyState, ErrorAlert, Input, PageHeader, RelativeTime, SelectField, Tooltip } from '../components/ui'
import { IconCheck, IconClock, IconCopy, IconNote, IconResend, IconTrash, IconUndo } from '../components/icons'
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

// How a teammate originally got into the workspace. Drives the
// "Founder / Invited / Direct" pill in the roster — useful at audit
// time and when an admin needs to distinguish a hand-onboarded user
// from one who clicked through an email invite.
//
// Aligned with the Postgres CHECK constraint on
// organization_members.joined_via — keep these in lockstep, or the
// FE will get cached responses with values it doesn't render.
type JoinedVia =
  | 'invitation'
  | 'sso'
  | 'personal_backfill'
  | 'founding_owner'
  | 'direct_admin'

interface Member {
  user_id: string
  email: string | null
  role: OrgRole
  invited_by: string | null
  created_at: string
  // Most recent timestamp at which this member made an authenticated
  // request to the API while having this org in context. NULL = the
  // member has never been seen in this org under the new tracking
  // (legacy rows with NULL last_active_at render as "Never active").
  last_active_at: string | null
  // Provenance — see JoinedVia. Null on legacy rows that the v1.1
  // backfill didn't classify (extremely rare; dropped by the migration).
  joined_via: JoinedVia | null
}

interface Invitation {
  id: string
  email: string
  role: Exclude<OrgRole, 'owner'>
  // Sensitive token — returned only to owner/admin actors (server-side
  // gated). Used to build the /invite/accept?token=… URL for the
  // "Copy invite link" fallback when email delivery is unreliable.
  // Null for non-manage-capable roles (defensive — the UI also gates
  // the affordance on `canManage`).
  token: string | null
  // Server-resolved email of the inviter so we can render
  // "Invited 3h ago by alice@example.com" without a second fetch.
  // Nullable: legacy rows or deleted users surface as "by an admin".
  invited_by: string | null
  invited_by_email: string | null
  expires_at: string
  // Resend metadata. resend_count is NOT NULL on the backend (defaults
  // to 0); the optional ?: keeps backwards compat with cached responses
  // from before the v1.2 migration deployed.
  last_resent_at?: string | null
  resend_count?: number
  // Stamped on first preview-page open. NULL means "never opened" —
  // surfaces as a softer "Sent" label so the operator can decide
  // whether the issue is deliverability vs ghosting.
  last_seen_at?: string | null
  // Optional 280-char personal note from the inviter. Echoed in both
  // the Members card metadata strip (truncated) and the preview screen
  // (full quote).
  note?: string | null
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

// Provenance pill metadata. Two design choices that warrant a comment:
//
//   1. We render *short* labels in the pill ("Founder", "Invited") and
//      put the longer, audit-ready phrasing in the tooltip. Pills compete
//      for horizontal space with the email + role; verbose pill text
//      pushes the role select off the row on narrow viewports.
//
//   2. `personal_backfill` is intentionally hidden from the UI. It
//      signals "this user's personal-org membership row" — useful for
//      the data layer, but rendering "Personal" or "Self" in a team
//      roster is just confusing. Personal orgs have exactly one member
//      (the owner) so the pill would always say the same thing.
const JOINED_VIA_META: Record<JoinedVia, { label: string; tooltip: string; tone: string } | null> = {
  founding_owner: {
    label: 'Founder',
    tooltip: 'Created this organization. Has been here since day one.',
    tone: 'bg-warn/10 text-warn border border-warn/30',
  },
  invitation: {
    label: 'Invited',
    tooltip: 'Joined by accepting an email invitation.',
    tone: 'bg-brand-subtle text-brand',
  },
  sso: {
    label: 'SSO',
    tooltip: 'Provisioned through your identity provider (SCIM/OIDC).',
    tone: 'bg-ok-muted text-ok',
  },
  direct_admin: {
    label: 'Direct',
    tooltip: 'Added directly by an admin tool — no email invite was used.',
    tone: 'bg-surface-overlay text-fg-muted',
  },
  personal_backfill: null,
}

// Cap mirrors the CHECK constraint on invitations.note. We mirror it
// in the input so the user gets immediate feedback when typing past
// the limit, instead of bouncing off a 400 from the API.
const NOTE_MAX_LEN = 280

export function OrganizationSettingsPage() {
  const activeOrgId = useActiveOrgId()
  const toast = useToast()
  const entitlements = useEntitlements()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Invitation['role']>('member')
  const [submitting, setSubmitting] = useState(false)
  // Personal note is collapsed by default — invitees scan invitation
  // emails fast and most invites genuinely don't need a note. Surfacing
  // a textarea unprompted dilutes the form's hierarchy. The "+ Add a
  // note" toggle keeps the surface clean while making the affordance
  // discoverable on the first invite an operator sends.
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  // Track which invites are currently being resent so the Resend button
  // shows a spinner without forcing a full page reload between clicks.
  // A Set so two admins triaging the page concurrently don't trample
  // each other's optimistic state.
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set())
  // Per-invite "just copied the link" flash, keyed by id. Cleared via
  // a setTimeout so the affordance feels like a momentary success
  // signal rather than a sticky state.
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
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

  // "Show only inactive members" filter for paid-seat hygiene work.
  // 30-day threshold is the Vercel/Linear seat-audit default — long
  // enough that a vacationing teammate doesn't flag, short enough that
  // a quarterly review surfaces real coasters. Off by default; admins
  // toggling it are signalling "I'm here to clean house".
  const [showInactiveOnly, setShowInactiveOnly] = useState(false)
  const INACTIVE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000

  // Roster sort & filter. The default sort is "most recently active
  // first, with never-active rows sinking to the bottom" because the
  // primary question this page answers — "is this person still using
  // their seat?" — is monotonic in last_active_at. Within an activity
  // bucket we tiebreak by role weight (owners up top), then by email
  // for a stable, human-scannable order.
  const ROLE_WEIGHT: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 }
  const sortedMembers = useMemo(() => {
    const now = Date.now()
    return [...(data?.members ?? [])]
      // Hide rows that the user is currently undoing — they're already
      // pretending to be deleted from the user's POV. If the timer fires
      // and the DELETE succeeds, the next reload will drop them for real;
      // if Undo runs, we restore them in `cancelScheduledRemove`.
      .filter((m) => !pendingRemovalIds.has(m.user_id))
      .filter((m) => {
        if (!showInactiveOnly) return true
        // "Inactive" = no activity in 30d, OR never seen at all.
        if (!m.last_active_at) return true
        return now - new Date(m.last_active_at).getTime() > INACTIVE_THRESHOLD_MS
      })
      .sort((a, b) => {
        const aMs = a.last_active_at ? new Date(a.last_active_at).getTime() : null
        const bMs = b.last_active_at ? new Date(b.last_active_at).getTime() : null
        if (aMs !== null && bMs !== null && aMs !== bMs) return bMs - aMs
        if (aMs !== null && bMs === null) return -1
        if (aMs === null && bMs !== null) return 1
        const roleDelta = ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role]
        if (roleDelta !== 0) return roleDelta
        return (a.email ?? '').localeCompare(b.email ?? '')
      })
  }, [data?.members, pendingRemovalIds, showInactiveOnly, INACTIVE_THRESHOLD_MS])

  // Total count of members the org has *visible to this admin* before
  // the inactive filter narrows them down. Used for the "Showing 3 of
  // 14 members" line so toggling the filter feels reversible — the
  // user always knows how many rows the toggle is hiding.
  const totalVisibleMembers = useMemo(
    () => (data?.members ?? []).filter((m) => !pendingRemovalIds.has(m.user_id)).length,
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
    const trimmedNote = note.trim()
    const res = await apiFetch<{ invitation: Invitation; acceptUrl: string }>(
      `/v1/org/${activeOrgId}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          role,
          note: trimmedNote ? trimmedNote : undefined,
        }),
      },
    )
    setSubmitting(false)
    if (!res.ok) {
      // Targeted error UX for the two new structured failure paths the
      // backend exposes. Generic toast for everything else.
      const code = res.error?.code
      if (code === 'SEAT_CAP_REACHED') {
        toast.error('Seat cap reached', res.error?.message ?? 'Upgrade to add more teammates.')
      } else if (code === 'RATE_LIMITED') {
        toast.error('Too many invites', res.error?.message ?? 'Slow down — try again in a bit.')
      } else {
        toast.error('Invite failed', res.error?.message)
      }
      return
    }
    toast.success('Invite sent', `${email} can now join this organization.`)
    setEmail('')
    setNote('')
    setNoteOpen(false)
    reload()
  }

  async function resendInvite(inviteRow: Invitation) {
    if (!activeOrgId) return
    if (resendingIds.has(inviteRow.id)) return
    setResendingIds((prev) => new Set(prev).add(inviteRow.id))
    const res = await apiFetch<{ invitationId: string; lastResentAt: string; resendCount: number }>(
      `/v1/org/${activeOrgId}/invitations/${inviteRow.id}/resend`,
      { method: 'POST' },
    )
    setResendingIds((prev) => {
      const next = new Set(prev)
      next.delete(inviteRow.id)
      return next
    })
    if (!res.ok) {
      const code = res.error?.code
      if (code === 'RATE_LIMITED') {
        toast.error('Resend cooldown', res.error?.message ?? 'Wait before resending this invite again.')
      } else if (code === 'EXPIRED') {
        toast.error('Invitation expired', res.error?.message ?? 'Cancel and send a fresh invite.')
      } else if (code === 'ALREADY_ACCEPTED') {
        toast.error('Already accepted', 'This invite has already been used.')
      } else if (code === 'ALREADY_REVOKED') {
        toast.error('Cancelled invite', 'This invitation was cancelled. Send a new one instead.')
      } else {
        toast.error('Could not resend invite', res.error?.message)
      }
      return
    }
    toast.success('Invite resent', `${inviteRow.email} will receive a fresh email.`)
    reload()
  }

  async function copyInviteLink(inviteRow: Invitation) {
    if (!inviteRow.token) {
      toast.error('Invite link unavailable', 'Reload the page and try again.')
      return
    }
    // Build the same accept URL the auth email points at, so a forwarded
    // copy lands the invitee on the exact preview screen they would have
    // reached via the email. Useful when the email is in spam, the
    // invitee's domain blocks Supabase's mailer, or a manager wants to
    // DM the link in Slack.
    const link = `${window.location.origin}/invite/accept?token=${encodeURIComponent(inviteRow.token)}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedInviteId(inviteRow.id)
      window.setTimeout(() => {
        setCopiedInviteId((current) => (current === inviteRow.id ? null : current))
      }, 2000)
    } catch {
      toast.error('Could not copy link', 'Your browser blocked clipboard access.')
    }
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
          {/* Optional personal note. Collapsed by default — most invites
              don't need one, and keeping the textarea hidden until the
              operator opts in preserves the form's hierarchy. The note
              flows through to both the Supabase invite email body
              ({{ .Data.note }} in the template) and the preview screen
              the invitee sees before clicking Accept, so a one-line
              "we're shipping the audit-log work next week — come help"
              gives the invitee real context the generic email can't. */}
          {teamsEnabled && canManage && (
            <div className="mt-3">
              {!noteOpen ? (
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="text-xs text-brand hover:text-brand-hover focus:outline-none focus:ring-2 focus:ring-brand/40 rounded"
                >
                  + Add a personal note
                </button>
              ) : (
                <div>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <label htmlFor="invite-note" className="text-xs font-medium text-fg">
                      Personal note <span className="text-fg-faint">(optional)</span>
                    </label>
                    <span
                      className={`text-2xs ${note.length > NOTE_MAX_LEN - 20 ? 'text-warn' : 'text-fg-faint'}`}
                    >
                      {note.length}/{NOTE_MAX_LEN}
                    </span>
                  </div>
                  <textarea
                    id="invite-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX_LEN))}
                    rows={2}
                    placeholder="Hey — we're shipping the audit work next week, would love your eyes on it."
                    className="w-full rounded border border-edge-subtle bg-surface-raised px-2 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/40"
                  />
                  <p className="mt-1 text-2xs text-fg-faint">
                    Shown in the invite email and the preview screen the recipient sees before accepting.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setNote('')
                        setNoteOpen(false)
                      }}
                      className="text-brand hover:text-brand-hover"
                    >
                      Skip
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}
        </UpgradeLockOverlay>
      </Card>

      <Card className="overflow-hidden">
        {/* Header strip: count summary + "show inactive only" toggle.
            Mounted *outside* the <table> so the table can stay focused
            on roster data and the toggle stays accessible to keyboard
            users in tab order before any row interactions. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge-subtle bg-surface-overlay/30 px-3 py-2 text-2xs uppercase tracking-wider text-fg-faint">
          <span>
            {showInactiveOnly
              ? `${sortedMembers.length} of ${totalVisibleMembers} inactive (>30d)`
              : `${totalVisibleMembers} member${totalVisibleMembers === 1 ? '' : 's'}`}
          </span>
          {/* Hide the toggle entirely on tiny rosters — for a 1- or 2-
              person org there's nothing to filter, and the affordance
              just steals visual weight from the actual table. The
              breakpoint of 3 mirrors the smallest team where seat-
              audit becomes a real concern. */}
          {totalVisibleMembers >= 3 && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 normal-case tracking-normal">
              <input
                type="checkbox"
                checked={showInactiveOnly}
                onChange={(e) => setShowInactiveOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-edge-subtle bg-surface-raised text-brand focus:ring-1 focus:ring-brand/40"
              />
              <span className="text-2xs text-fg-muted">Show inactive only</span>
              <Tooltip content="Hides anyone seen in the last 30 days. Pairs with sort-by-activity so coasting paid seats surface fast.">
                <span className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-edge-subtle text-[9px] font-medium text-fg-faint">
                  ?
                </span>
              </Tooltip>
            </label>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-edge-subtle bg-surface-overlay/20 text-left text-2xs uppercase tracking-wider text-fg-faint">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Role</th>
              <th className="hidden px-3 py-2 sm:table-cell">Active</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {sortedMembers.length === 0 && showInactiveOnly && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-fg-muted">
                  No inactive members in the last 30 days. Healthy roster.
                </td>
              </tr>
            )}
            {sortedMembers.map((member) => {
              // Activity & provenance derivations live next to the row
              // so the JSX stays declarative. `joinedMeta` may be null
              // for `personal_backfill` (intentionally hidden) — see
              // JOINED_VIA_META above.
              const joinedMeta = member.joined_via ? JOINED_VIA_META[member.joined_via] : null
              const lastActiveMs = member.last_active_at
                ? Date.now() - new Date(member.last_active_at).getTime()
                : null
              const isInactive = lastActiveMs !== null && lastActiveMs > INACTIVE_THRESHOLD_MS
              const isNeverActive = member.last_active_at === null
              return (
                <tr key={member.user_id}>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-fg">{member.email ?? member.user_id}</span>
                      {joinedMeta && (
                        <Tooltip content={joinedMeta.tooltip}>
                          <Badge className={`${joinedMeta.tone} text-2xs`}>{joinedMeta.label}</Badge>
                        </Tooltip>
                      )}
                    </div>
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
                  {/* Activity column. Three states with deliberately
                      different visual weight:
                        - Never active   → "Never seen" (warn tone) so
                          it reads as a thing-to-look-at, not a neutral
                          fact.
                        - Inactive >30d  → muted timestamp, signalling
                          "this is the cohort the toggle filters to".
                        - Recently active → normal text, RelativeTime
                          handles "Just now / 3m ago / 2d ago".
                      Hidden on `<sm` to keep the row scannable on
                      mobile-width admin sessions; the 30-day cohort is
                      a power-user task that mostly happens at desktop.
                  */}
                  <td className="hidden px-3 py-2 text-xs sm:table-cell">
                    {isNeverActive ? (
                      <Tooltip content="This member has not made an authenticated request in this organization since activity tracking shipped.">
                        <span className="text-warn">Never seen</span>
                      </Tooltip>
                    ) : (
                      <span className={isInactive ? 'text-fg-faint' : 'text-fg-muted'}>
                        <RelativeTime value={member.last_active_at!} />
                      </span>
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
              )
            })}
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
              const resendCount = invite.resend_count ?? 0
              const isResending = resendingIds.has(invite.id)
              const justCopied = copiedInviteId === invite.id
              return (
                <li
                  key={invite.id}
                  className="rounded border border-edge-subtle bg-surface-overlay/30 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-fg" title={invite.email}>
                          {invite.email}
                        </span>
                        {invite.note && (
                          <Tooltip content={invite.note}>
                            <span className="inline-flex items-center text-fg-faint hover:text-fg-muted">
                              <IconNote className="size-3" />
                            </span>
                          </Tooltip>
                        )}
                      </div>
                      {/* Metadata strip — when invited, by whom, when it
                          expires, deliverability signals (last_seen_at,
                          resend_count). Inviter falls back to "an admin"
                          if the user_id couldn't be resolved (deleted
                          account, legacy row pre-migration). The
                          last_seen_at signal is the highest-leverage
                          new datum: it lets the operator distinguish
                          "ignored / spam-filtered" (never opened) from
                          "opened but did not accept" (engagement issue,
                          not deliverability). */}
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
                        {invite.last_seen_at ? (
                          <span className="text-fg-faint" title={`Opened ${new Date(invite.last_seen_at).toLocaleString()}`}>
                            · opened <RelativeTime value={invite.last_seen_at} className="text-fg-muted" />
                          </span>
                        ) : (
                          <span className="text-warn" title="The invitee hasn't opened the link yet — could be a spam filter. Try Resend or Copy link.">
                            · not opened
                          </span>
                        )}
                        {resendCount > 0 && invite.last_resent_at && (
                          <span className="text-fg-faint" title={`Last resent ${new Date(invite.last_resent_at).toLocaleString()}`}>
                            · resent {resendCount}× (last <RelativeTime value={invite.last_resent_at} className="text-fg-muted" />)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge className={ROLE_TONE[invite.role]}>{invite.role}</Badge>
                      {canManage && invite.token && (
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={() => void copyInviteLink(invite)}
                          aria-label={`Copy invite link for ${invite.email}`}
                          title={
                            justCopied
                              ? 'Copied!'
                              : 'Copy invite link to share manually (Slack, DM) when email is unreliable'
                          }
                          className={`px-2 ${justCopied ? 'text-ok' : 'text-fg-secondary hover:text-fg'}`}
                        >
                          {justCopied ? <IconCheck /> : <IconCopy />}
                        </Btn>
                      )}
                      {canManage ? (
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={() => void resendInvite(invite)}
                          disabled={isResending || expired}
                          loading={isResending}
                          aria-label={`Resend invitation to ${invite.email}`}
                          title={
                            expired
                              ? 'Invite expired — cancel and send a new one'
                              : `Resend invitation email to ${invite.email}`
                          }
                          className="px-2 text-fg-secondary hover:text-brand"
                        >
                          <IconResend />
                        </Btn>
                      ) : null}
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
