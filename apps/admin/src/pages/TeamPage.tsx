/**
 * FILE: apps/admin/src/pages/TeamPage.tsx
 * PURPOSE: One Team page (Plan 021 Phase 3): members, billing, AI spend, audit
 *          log, single sign-on, compliance and storage were seven sidebar
 *          entries. They are views of /team now (lib/pageHubs.ts); plan-gated
 *          views only show for teams that have the feature.
 */

import { lazy } from 'react'
import { PageHubView } from '../components/PageHubView'
import { TEAM_HUB } from '../lib/pageHubs'

const OrganizationSettingsPage = lazy(() =>
  import('./OrganizationSettingsPage').then((m) => ({ default: m.OrganizationSettingsPage })),
)
const BillingPage = lazy(() => import('./BillingPage').then((m) => ({ default: m.BillingPage })))
const CostPage = lazy(() => import('./CostPage').then((m) => ({ default: m.CostPage })))
const AuditPage = lazy(() => import('./AuditPage').then((m) => ({ default: m.AuditPage })))
const SsoPage = lazy(() => import('./SsoPage').then((m) => ({ default: m.SsoPage })))
const CompliancePage = lazy(() => import('./CompliancePage').then((m) => ({ default: m.CompliancePage })))
const StoragePage = lazy(() => import('./StoragePage').then((m) => ({ default: m.StoragePage })))

export function TeamPage() {
  return (
    <PageHubView
      hub={TEAM_HUB}
      render={{
        members: () => <OrganizationSettingsPage />,
        billing: () => <BillingPage />,
        spend: () => <CostPage />,
        audit: () => <AuditPage />,
        sso: () => <SsoPage />,
        compliance: () => <CompliancePage />,
        storage: () => <StoragePage />,
      }}
    />
  )
}
