import { useMemo, useState } from 'react'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { Badge, Btn, Card, EmptyState, ErrorAlert, Input, PageHeader, SelectField } from '../components/ui'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'

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

const PAID_TEAM_PLANS = new Set(['pro', 'enterprise'])

export function OrganizationSettingsPage() {
  const activeOrgId = useActiveOrgId()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Invitation['role']>('member')
  const [submitting, setSubmitting] = useState(false)
  const path = activeOrgId ? `/v1/org/${activeOrgId}/members` : null
  const { data, loading, error, reload } = usePageData<MembersResponse>(path)

  const canManage = data?.currentUserRole === 'owner' || data?.currentUserRole === 'admin'
  const teamsEnabled = PAID_TEAM_PLANS.has(data?.organization?.plan_id ?? 'hobby')

  const sortedMembers = useMemo(
    () => [...(data?.members ?? [])].sort((a, b) => a.role.localeCompare(b.role) || (a.email ?? '').localeCompare(b.email ?? '')),
    [data?.members],
  )

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

  async function removeMember(userId: string) {
    if (!activeOrgId) return
    const res = await apiFetch(`/v1/org/${activeOrgId}/members/${userId}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Could not remove member', res.error?.message)
      return
    }
    toast.success('Member removed')
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

      {!teamsEnabled && (
        <Card className="border-warn/30 bg-warn/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-fg">Teams require Pro or Enterprise</p>
              <p className="mt-1 text-xs text-fg-muted">
                Starter remains a solo workspace. Upgrade to Pro to invite teammates and share projects.
              </p>
            </div>
            <a
              href="/billing"
              className="inline-flex items-center justify-center rounded-sm bg-brand px-2 py-1 text-xs font-medium text-brand-fg shadow-card hover:bg-brand-hover"
            >
              Upgrade
            </a>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Invite teammate</h2>
            <p className="text-xs text-fg-muted">Owner and admin roles can invite members on Pro+ plans.</p>
          </div>
        </div>
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
            <Btn onClick={invite} disabled={!email || !teamsEnabled || !canManage || submitting} loading={submitting}>
              Invite
            </Btn>
          </div>
        </div>
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
                  <Btn size="sm" variant="ghost" onClick={() => void removeMember(member.user_id)} disabled={!canManage}>
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
    </div>
  )
}
