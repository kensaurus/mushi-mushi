import { useEffect, useMemo, useState } from 'react'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { Badge, Btn, Card, EmptyState, ErrorAlert, Input, PageHeader, SelectField, Tooltip } from '../components/ui'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { UpgradeBanner, UpgradeLockOverlay } from '../components/billing/UpgradeNudge'
import { useEntitlements } from '../lib/useEntitlements'
import { useUpdateOrganization } from '../lib/useUpdateOrganization'

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
  expires_at: string
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
  const [removing, setRemoving] = useState(false)
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
    () => [...(data?.members ?? [])].sort((a, b) => a.role.localeCompare(b.role) || (a.email ?? '').localeCompare(b.email ?? '')),
    [data?.members],
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

  async function confirmRemoveMember() {
    if (!activeOrgId || !pendingRemove) return
    setRemoving(true)
    const res = await apiFetch(`/v1/org/${activeOrgId}/members/${pendingRemove.user_id}`, { method: 'DELETE' })
    setRemoving(false)
    if (!res.ok) {
      toast.error('Could not remove member', res.error?.message)
      return
    }
    toast.success('Member removed', `${pendingRemove.email ?? pendingRemove.user_id} no longer has access to this organization.`)
    setPendingRemove(null)
    reload()
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
            <div className="flex items-end gap-2">
              <Btn
                type="submit"
                disabled={
                  renamingOrg || !orgNameDraft.trim() || orgNameDraft.trim() === orgName
                }
                loading={renamingOrg}
              >
                Save name
              </Btn>
              {orgNameDraft !== orgName && !renamingOrg && (
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOrgNameDraft(orgName)}
                >
                  Reset
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
                    variant="danger"
                    onClick={() => setPendingRemove(member)}
                    disabled={!canManage || member.role === 'owner'}
                    title={member.role === 'owner' ? 'Owners cannot be removed from the org' : undefined}
                  >
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {(data?.invitations?.length ?? 0) > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg">Pending invitations</h2>
          <div className="space-y-2">
            {data!.invitations.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between rounded border border-edge-subtle bg-surface-overlay/30 px-3 py-2 text-xs">
                <span className="text-fg">{invite.email}</span>
                <Badge className={ROLE_TONE[invite.role]}>{invite.role}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title="Remove this teammate?"
          body={`${pendingRemove.email ?? pendingRemove.user_id} will lose access to every project in ${data?.organization?.name ?? 'this organization'}. They can be re-invited later, but anything they had drafted in their own session will be gone.`}
          confirmLabel="Remove member"
          cancelLabel="Keep member"
          tone="danger"
          loading={removing}
          onConfirm={() => void confirmRemoveMember()}
          onCancel={() => {
            if (!removing) setPendingRemove(null)
          }}
        />
      )}
    </div>
  )
}
