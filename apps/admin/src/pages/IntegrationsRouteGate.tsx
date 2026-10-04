/**
 * Routes /integrations for signed-in users to the admin config surface.
 * Anonymous visitors still see the public marketing page.
 *
 * Canonical console route: /integrations/config. /integrations stays because
 * it is the public marketing page (and external links point at it); signed-in
 * users are redirected with the query AND the hash, so a deep link such as
 * /integrations#platform-card-sentry still lands on the Sentry card.
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
        to={{ pathname: '/integrations/config', search: location.search, hash: location.hash }}
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
