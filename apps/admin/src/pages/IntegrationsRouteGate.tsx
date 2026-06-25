/**
 * Routes /integrations for signed-in users to the admin config surface.
 * Anonymous visitors still see the public marketing page.
 */

import { Suspense, lazy } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Loading } from '../components/ui'

const PublicIntegrationsPage = lazy(() =>
  import('./PublicIntegrationsPage').then((m) => ({ default: m.PublicIntegrationsPage })),
)

export function IntegrationsRouteGate() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <Loading text="Loading…" />
  }

  if (session) {
    return (
      <Navigate
        to={{ pathname: '/integrations/config', search: location.search }}
        replace
      />
    )
  }

  return (
    <Suspense fallback={<Loading text="Loading…" />}>
      <PublicIntegrationsPage />
    </Suspense>
  )
}
