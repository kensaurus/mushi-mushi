/**
 * FILE: apps/admin/src/pages/AppsPage.tsx
 * PURPOSE: Apps (/portfolio) and the views that used to sit on Home (ADR 0069):
 *          every app side by side first, then Overview, User activity, Users &
 *          funnels, Weekly insights and Growth (lib/pageHubs.ts APPS_HUB).
 *          Home is one list of next actions, with no view tabs; its old
 *          `/dashboard?view=<id>` links redirect here.
 */

import { lazy } from 'react'
import { PageHubView } from '../components/PageHubView'
import { APPS_HUB } from '../lib/pageHubs'

const PortfolioPage = lazy(() => import('./PortfolioPage').then((m) => ({ default: m.PortfolioPage })))
const OverviewPage = lazy(() => import('./OverviewPage').then((m) => ({ default: m.OverviewPage })))
const ActivityPage = lazy(() => import('./ActivityPage').then((m) => ({ default: m.ActivityPage })))
const AnalyticsPage = lazy(() => import('./AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))
const IntelligencePage = lazy(() => import('./IntelligencePage').then((m) => ({ default: m.IntelligencePage })))
const GrowthPage = lazy(() => import('./GrowthPage').then((m) => ({ default: m.GrowthPage })))

export function AppsPage() {
  return (
    <PageHubView
      hub={APPS_HUB}
      render={{
        all: () => <PortfolioPage />,
        apps: () => <OverviewPage />,
        users: () => <ActivityPage />,
        funnels: () => <AnalyticsPage />,
        insights: () => <IntelligencePage />,
        growth: () => <GrowthPage />,
      }}
    />
  )
}
