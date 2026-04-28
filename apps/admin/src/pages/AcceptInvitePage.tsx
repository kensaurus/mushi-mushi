import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { setActiveOrgIdSnapshot } from '../lib/activeOrg'
import { useAuth } from '../lib/auth'
import { Card, Loading } from '../components/ui'
import { loginPathForLocation } from '../lib/authRedirect'

export function AcceptInvitePage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const loginTo = useMemo(() => loginPathForLocation(location), [location])

  useEffect(() => {
    if (loading || !session || !token || status !== 'idle') return
    setStatus('accepting')
    void apiFetch<{ organizationId: string }>('/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then((res) => {
      if (!res.ok || !res.data?.organizationId) {
        setStatus('error')
        setMessage(res.error?.message ?? 'Invitation could not be accepted.')
        return
      }
      setActiveOrgIdSnapshot(res.data.organizationId)
      setStatus('success')
      setTimeout(() => navigate('/dashboard', { replace: true }), 900)
    })
  }, [loading, navigate, session, status, token])

  if (!token) return <Navigate to="/dashboard" replace />
  if (loading) return <Loading text="Checking invite" />
  if (!session) return <Navigate to={loginTo} replace state={{ from: location }} />

  return (
    <main className="grid min-h-screen place-items-center bg-surface p-6">
      <Card className="max-w-md p-6 text-center">
        {status === 'accepting' && <Loading text="Joining team" />}
        {status === 'success' && (
          <>
            <p className="text-lg font-semibold text-fg">You're in.</p>
            <p className="mt-2 text-sm text-fg-muted">Opening the shared workspace…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <p className="text-lg font-semibold text-fg">Invite could not be accepted</p>
            <p className="mt-2 text-sm text-fg-muted">{message}</p>
            <Link to="/dashboard" className="mt-4 inline-flex text-sm text-brand hover:text-brand-hover">
              Back to dashboard
            </Link>
          </>
        )}
      </Card>
    </main>
  )
}
