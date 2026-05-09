import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { setActiveOrgIdSnapshot } from '../lib/activeOrg'
import { useAuth } from '../lib/auth'
import { Badge, Btn, Card, DetailRows, Loading, RelativeTime } from '../components/ui'
import { loginPathForLocation } from '../lib/authRedirect'

type PreviewStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

interface PreviewResponse {
  status: PreviewStatus
  invitation: {
    id: string
    email: string
    role: 'admin' | 'member' | 'viewer'
    note: string | null
    expires_at: string
    created_at: string
  }
  organization: { id: string; name: string; slug: string } | null
  inviter: { email: string | null; name: string | null }
}

const ROLE_TONE: Record<PreviewResponse['invitation']['role'], string> = {
  admin: 'bg-brand-subtle text-brand',
  member: 'bg-ok-muted text-ok',
  viewer: 'bg-surface-overlay text-fg-muted',
}

const ROLE_DESCRIPTION: Record<PreviewResponse['invitation']['role'], string> = {
  admin: 'Full access to manage projects, settings, and teammates.',
  member: 'Can read every project and triage reports across the org.',
  viewer: 'Read-only access — can review reports but not modify them.',
}

export function AcceptInvitePage() {
  const { session, loading: sessionLoading } = useAuth()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const loginTo = useMemo(() => loginPathForLocation(location), [location])

  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<{ code: string; message: string } | null>(null)
  const [acceptDone, setAcceptDone] = useState(false)

  // Resolve the token into preview metadata (org, role, inviter, status)
  // BEFORE asking the user to accept. This is the single biggest change
  // vs the old blind-POST flow: invitees now see "Join Acme as Member,
  // invited by alice@example.com" with the personal note inline, instead
  // of clicking a link and getting silently dropped into a workspace
  // they can't even name. Preview is unauthenticated — the token is the
  // bearer — so we don't gate it on `session`.
  useEffect(() => {
    if (!token) {
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    void apiFetch<PreviewResponse>(`/v1/invitations/preview?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      cache: 'no-store',
    }).then((res) => {
      if (cancelled) return
      if (!res.ok || !res.data) {
        setPreviewError(res.error?.message ?? 'Invitation not found.')
      } else {
        setPreview(res.data)
      }
      setPreviewLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  async function acceptInvite() {
    if (!token) return
    setAccepting(true)
    setAcceptError(null)
    const res = await apiFetch<{ organizationId: string }>('/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
      cache: 'no-store',
    })
    setAccepting(false)
    if (!res.ok || !res.data?.organizationId) {
      setAcceptError({
        code: res.error?.code ?? 'INVITE_ACCEPT_FAILED',
        message: res.error?.message ?? 'Invitation could not be accepted.',
      })
      return
    }
    setActiveOrgIdSnapshot(res.data.organizationId)
    setAcceptDone(true)
    setTimeout(() => navigate('/dashboard', { replace: true }), 900)
  }

  if (!token) return <Navigate to="/dashboard" replace />
  if (sessionLoading || previewLoading) return <Loading text="Checking invite…" />

  // Hard-error states reachable before sign-in. Showing these without
  // forcing a login first means an invitee who clicks a stale link
  // doesn't waste their time logging in only to be told the invite
  // expired. Auth is only required to ACCEPT, not to LOOK.
  if (previewError || !preview) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-lg font-semibold text-fg">Invitation not found</p>
          <p className="mt-2 text-sm text-fg-muted">
            {previewError ?? 'This invite link is invalid. Ask the person who sent it to resend.'}
          </p>
          <Link to="/dashboard" className="mt-4 inline-flex text-sm text-brand hover:text-brand-hover">
            Back to dashboard
          </Link>
        </Card>
      </main>
    )
  }

  if (preview.status === 'expired' || preview.status === 'revoked') {
    const expired = preview.status === 'expired'
    return (
      <main className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-lg font-semibold text-fg">
            {expired ? 'This invitation has expired' : 'This invitation was cancelled'}
          </p>
          <p className="mt-2 text-sm text-fg-muted">
            {expired
              ? 'Invitations are valid for 7 days. Ask '
              : 'The team admin cancelled this invite. Ask '}
            <span className="font-medium text-fg">{preview.inviter.email ?? 'the team admin'}</span>
            {' to send a fresh one.'}
          </p>
          <Link to="/dashboard" className="mt-4 inline-flex text-sm text-brand hover:text-brand-hover">
            Back to dashboard
          </Link>
        </Card>
      </main>
    )
  }

  if (preview.status === 'accepted') {
    return (
      <main className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-lg font-semibold text-fg">You've already joined</p>
          <p className="mt-2 text-sm text-fg-muted">
            This invitation was already accepted. Open the workspace to pick up where you left off.
          </p>
          <Link to="/dashboard" className="mt-4 inline-flex text-sm text-brand hover:text-brand-hover">
            Open dashboard
          </Link>
        </Card>
      </main>
    )
  }

  // Auth gate happens AFTER status checks: an invitee who clicked a
  // stale link should learn it's stale without being forced through a
  // login they don't actually need.
  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-md p-6">
          <h1 className="text-lg font-semibold text-fg">
            {preview.inviter.name ?? preview.inviter.email ?? 'A teammate'} invited you
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Sign in as <span className="font-medium text-fg">{preview.invitation.email}</span> to join{' '}
            <span className="font-medium text-fg">{preview.organization?.name ?? 'this team'}</span>.
          </p>
          <Btn
            type="button"
            onClick={() => navigate(loginTo, { state: { from: location } })}
            className="mt-4 w-full"
          >
            Sign in to accept
          </Btn>
        </Card>
      </main>
    )
  }

  // Normal preview-then-accept path. Surface every datum the email
  // promised — org, role, inviter, expiry, optional note — so accepting
  // is an informed click rather than a leap of faith. The note in
  // particular is what the inviter typed in the Members form; rendering
  // it as a quoted block (not a paragraph) signals "this is from a
  // human, not the system".
  const inviterLabel = preview.inviter.name ?? preview.inviter.email ?? 'A teammate'
  const emailMismatchHint =
    acceptError?.code === 'EMAIL_MISMATCH' ? (
      <p className="mt-2 text-xs text-warn">
        You're signed in as <span className="font-medium">{session.user.email}</span> but this invite is for{' '}
        <span className="font-medium">{preview.invitation.email}</span>. Sign out and sign back in with the
        invited email to accept.
      </p>
    ) : null

  return (
    <main className="grid min-h-screen place-items-center bg-surface p-6">
      <Card className="w-full max-w-md p-6">
        <p className="text-xs uppercase tracking-wider text-fg-faint">You've been invited</p>
        <h1 className="mt-1 text-xl font-semibold text-fg">
          Join {preview.organization?.name ?? 'this team'}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          <span className="font-medium text-fg">{inviterLabel}</span>
          {preview.inviter.email && preview.inviter.name ? (
            <span className="text-fg-faint"> ({preview.inviter.email})</span>
          ) : null}{' '}
          invited you to join as
        </p>

        <div className="mt-3 flex items-center gap-2">
          <Badge className={ROLE_TONE[preview.invitation.role]}>{preview.invitation.role}</Badge>
          <span className="text-xs text-fg-muted">{ROLE_DESCRIPTION[preview.invitation.role]}</span>
        </div>

        {preview.invitation.note && (
          <blockquote className="mt-4 rounded-md border-l-2 border-brand/60 bg-surface-overlay/40 px-3 py-2 text-sm italic text-fg-muted">
            &ldquo;{preview.invitation.note}&rdquo;
            <footer className="mt-1 text-2xs not-italic text-fg-faint">— {inviterLabel}</footer>
          </blockquote>
        )}

        <DetailRows
          className="mt-4"
          items={[
            {
              label: 'Sent to',
              value: preview.invitation.email,
              mono: true,
              tone: 'info',
              hint: 'Email address this invitation was sent to.',
            },
            {
              label: 'Expires',
              value: <RelativeTime value={preview.invitation.expires_at} />,
              hint: 'Invitations expire automatically — accept before this time.',
            },
          ]}
        />

        {acceptDone ? (
          <div className="mt-5 rounded-md bg-ok-muted/40 px-3 py-2 text-center text-sm text-ok">
            You're in. Opening {preview.organization?.name ?? 'the workspace'}…
          </div>
        ) : (
          <>
            <Btn
              type="button"
              onClick={acceptInvite}
              disabled={accepting}
              loading={accepting}
              className="mt-5 w-full"
            >
              Accept invitation
            </Btn>
            {acceptError && (
              <div className="mt-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                {acceptError.message}
                {emailMismatchHint}
              </div>
            )}
            <p className="mt-3 text-2xs text-fg-faint">
              Signed in as <span className="font-medium">{session.user.email}</span>.{' '}
              <Link to="/dashboard" className="text-brand hover:text-brand-hover">
                Decide later
              </Link>
            </p>
          </>
        )}
      </Card>
    </main>
  )
}
