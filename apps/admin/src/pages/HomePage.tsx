/**
 * FILE: apps/admin/src/pages/HomePage.tsx
 * PURPOSE: One Home (Plan 021 Phase 3). Six pages answered "what is
 *          happening?" from different angles — Home, App activity, User
 *          activity, Users & funnels, Weekly insights and Growth — each with its
 *          own sidebar entry. They are views of one page now (lib/pageHubs.ts).
 */

import { lazy } from 'react'
import { PageHubView } from '../components/PageHubView'
import { HOME_HUB } from '../lib/pageHubs'
import { DashboardPage } from './DashboardPage'

const OverviewPage = lazy(() => import('./OverviewPage').then((m) => ({ default: m.OverviewPage })))
const ActivityPage = lazy(() => import('./ActivityPage').then((m) => ({ default: m.ActivityPage })))
const AnalyticsPage = lazy(() => import('./AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))
const IntelligencePage = lazy(() => import('./IntelligencePage').then((m) => ({ default: m.IntelligencePage })))
const GrowthPage = lazy(() => import('./GrowthPage').then((m) => ({ default: m.GrowthPage })))

export function HomePage() {
  return (
    <PageHubView
      hub={HOME_HUB}
      render={{
        today: () => <DashboardPage />,
        apps: () => <OverviewPage />,
        users: () => <ActivityPage />,
        funnels: () => <AnalyticsPage />,
        insights: () => <IntelligencePage />,
        growth: () => <GrowthPage />,
      }}
    />
  )
}
