import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { AuthProvider, useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SetupGatePage } from './pages/SetupGatePage'
import { checkEnv } from './lib/env'
import type { ReactNode } from 'react'
import { Loading } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './lib/toast'

// Wrap Routes ONCE, at the level where the real (parametrized) route
// definitions live — i.e. the inner Routes mounted under the auth gate.
// The outer Routes only sees `/login`, `/reset-password`, `/*`, so wrapping
// it would clobber every authenticated transaction with `/*` (React commits
// child effects before parent effects, so the parent wrapper overwrites the
// child's correctly-parametrized name on every navigation). Sentry's docs
// are explicit: this wrapper is "only needed at the top level of your app."
// See: https://docs.sentry.io/platforms/javascript/guides/react/features/react-router/v7/
const SentryRoutes = Sentry.withSentryReactRouterV7Routing(Routes)

const envStatus = checkEnv()

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })))
const ReportDetailPage = lazy(() => import('./pages/ReportDetailPage').then(m => ({ default: m.ReportDetailPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const DLQPage = lazy(() => import('./pages/DLQPage').then(m => ({ default: m.DLQPage })))
const GraphPage = lazy(() => import('./pages/GraphPage').then(m => ({ default: m.GraphPage })))
const JudgePage = lazy(() => import('./pages/JudgePage').then(m => ({ default: m.JudgePage })))
const QueryPage = lazy(() => import('./pages/QueryPage').then(m => ({ default: m.QueryPage })))
const ResearchPage = lazy(() => import('./pages/ResearchPage').then(m => ({ default: m.ResearchPage })))
const FixesPage = lazy(() => import('./pages/FixesPage').then(m => ({ default: m.FixesPage })))
const RepoPage = lazy(() => import('./pages/RepoPage').then(m => ({ default: m.RepoPage })))
const SsoPage = lazy(() => import('./pages/SsoPage').then(m => ({ default: m.SsoPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })))
const PromptLabPage = lazy(() => import('./pages/PromptLabPage').then(m => ({ default: m.PromptLabPage })))
const IntelligencePage = lazy(() => import('./pages/IntelligencePage').then(m => ({ default: m.IntelligencePage })))
const CompliancePage = lazy(() => import('./pages/CompliancePage').then(m => ({ default: m.CompliancePage })))
const StoragePage = lazy(() => import('./pages/StoragePage').then(m => ({ default: m.StoragePage })))
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then(m => ({ default: m.MarketplacePage })))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })))
const McpPage = lazy(() => import('./pages/McpPage').then(m => ({ default: m.McpPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const HealthPage = lazy(() => import('./pages/HealthPage').then(m => ({ default: m.HealthPage })))
const AntiGamingPage = lazy(() => import('./pages/AntiGamingPage').then(m => ({ default: m.AntiGamingPage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })))
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })))

function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-5xl font-bold text-fg-faint mb-2">404</p>
      <h2 className="text-lg font-semibold text-fg mb-1">Page not found</h2>
      <p className="text-sm text-fg-muted mb-6">
        <code className="text-2xs bg-surface-raised px-1.5 py-0.5 rounded">{pathname}</code> doesn't exist.
      </p>
      <Link to="/" className="text-sm text-brand hover:text-brand-hover transition-colors">
        ← Back to Dashboard
      </Link>
    </div>
  )
}

function PasswordRecoveryGate({ children }: { children: ReactNode }) {
  const { isPasswordRecovery } = useAuth()
  const { pathname } = useLocation()
  // Allow /reset-password through so the destination route can actually mount.
  // Without this, the gate redirects in a loop and ResetPasswordPage never renders.
  if (isPasswordRecovery && pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />
  }
  return <>{children}</>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center"><Loading text="Loading..." /></div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  if (envStatus.mode === 'self-hosted' && !envStatus.ready) {
    return <SetupGatePage env={envStatus} />
  }

  return (
    <AuthProvider>
      <ToastProvider>
      <PasswordRecoveryGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <ErrorBoundary>
                <Suspense fallback={<Loading text="Loading..." />}>
                <SentryRoutes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/reports/:id" element={<ReportDetailPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/queue" element={<DLQPage />} />
                  <Route path="/graph" element={<GraphPage />} />
                  <Route path="/judge" element={<JudgePage />} />
                  <Route path="/query" element={<QueryPage />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/fixes" element={<FixesPage />} />
                  <Route path="/repo" element={<RepoPage />} />
                  <Route path="/sso" element={<SsoPage />} />
                  <Route path="/audit" element={<AuditPage />} />
                  <Route path="/prompt-lab" element={<PromptLabPage />} />
                  <Route path="/fine-tuning" element={<Navigate to="/prompt-lab" replace />} />
                  <Route path="/intelligence" element={<IntelligencePage />} />
                  <Route path="/compliance" element={<CompliancePage />} />
                  <Route path="/storage" element={<StoragePage />} />
                  <Route path="/marketplace" element={<MarketplacePage />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/mcp" element={<McpPage />} />
                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route path="/health" element={<HealthPage />} />
                  <Route path="/anti-gaming" element={<AntiGamingPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/billing" element={<BillingPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </SentryRoutes>
                </Suspense>
                </ErrorBoundary>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      </PasswordRecoveryGate>
      </ToastProvider>
    </AuthProvider>
  )
}
