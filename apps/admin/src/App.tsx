import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { AuthProvider, useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { PublicHomePage } from './pages/PublicHomePage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SetupGatePage } from './pages/SetupGatePage'
import { checkEnv } from './lib/env'
import type { ReactNode } from 'react'
import { Loading } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { EditorialErrorState } from './components/EditorialErrorState'
import { ToastProvider } from './lib/toast'
import { UpgradePromptHost } from './components/billing/UpgradePrompt'
import { loginPathForLocation } from './lib/authRedirect'
import { OfflineBanner } from './components/OfflineBanner'
import { useSessionWatcher } from './lib/sessionWatcher'

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
const OrganizationSettingsPage = lazy(() => import('./pages/OrganizationSettingsPage').then(m => ({ default: m.OrganizationSettingsPage })))
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage').then(m => ({ default: m.AcceptInvitePage })))
// Wave T (2026-04-23) — new /inbox page, lazy-loaded like every other route so
// the first-paint bundle isn't inflated for users who don't open it.
const InboxPage = lazy(() => import('./pages/InboxPage').then(m => ({ default: m.InboxPage })))
// Phase 2c (2026-04-27) — operator-only signup directory. Lazy-loaded
// like every other route so the bundle cost is zero for non-operators.
// The page itself re-checks `isSuperAdmin` and renders an opaque "Page
// not found" if a non-operator deep-links here.
const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })))
// Migration Hub Phase 2 (2026-04-29) — popup target used by the docs site
// (apps/docs/lib/migrationProgress.ts → openAdminAuthBridge) to forward a
// short-lived access token via postMessage. Mounted INSIDE ProtectedRoute
// so unauthenticated callers go through /login first, then come back here.
const DocsBridgePage = lazy(() => import('./pages/DocsBridgePage').then(m => ({ default: m.DocsBridgePage })))

/**
 * NotFoundPage — rendered for any unknown route the SPA's React Router
 * matches. Uses the editorial fallback so the visitor's experience is
 * consistent whether the page is missing or crashed. Echoes the path
 * they typed back so they can see the typo without opening devtools.
 *
 * Auth-state aware: signed-in visitors are sent to `/dashboard` (their
 * actual home); anon visitors are sent to `/` (the public landing). We
 * deliberately do not redirect — the visitor stays on the wrong URL so
 * the address bar reflects the truth and the back button works.
 */
function NotFoundPage() {
  const { pathname } = useLocation()
  const { session } = useAuth()
  const home = session
    ? { href: '/dashboard', label: 'Back to dashboard' }
    : { href: '/', label: 'Back to home' }
  // In the current routing tree, NotFoundPage is mounted under the
  // `/*` protected route (after ProtectedRoute → Layout), so anonymous
  // visitors are typically bounced to /login before they ever reach
  // this component. We still keep the `session`-aware copy/links as a
  // defensive fallback in case the routing changes or auth state is
  // transient on first paint. Either way, this renders INSIDE Layout's
  // `<main id="main-content">`, so EditorialErrorState's default wrapper
  // (`<section>`) is what we want — using `<main>` here would create
  // the nested-main landmark the Copilot review flagged.
  return (
    <EditorialErrorState
      eyebrow="404 · not found"
      headline={
        <>
          We can't find <em>that page</em>.
        </>
      }
      lead={
        session
          ? "The route you typed doesn't match any page in the console. It may have moved, been renamed, or never existed — head back to the dashboard or check the docs for the canonical name."
          : "The link you followed doesn't match any page on this site. It may have been moved or renamed — head home, or check the docs for what you're looking for."
      }
      detail={
        <code className="break-all rounded bg-[var(--mushi-paper-wash)] px-2 py-0.5">
          {pathname}
        </code>
      }
      primary={home}
      secondary={{
        href: 'https://kensaur.us/mushi-mushi/docs/',
        label: 'Open docs',
        external: true,
      }}
    />
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
  const location = useLocation()
  if (loading) return <div className="flex h-screen items-center justify-center"><Loading text="Loading..." /></div>
  if (!session) return <Navigate to={loginPathForLocation(location)} replace state={{ from: location }} />
  return <>{children}</>
}

function ResilienceLayer() {
  useSessionWatcher()
  return <OfflineBanner />
}

export function App() {
  if (envStatus.mode === 'self-hosted' && !envStatus.ready) {
    return <SetupGatePage env={envStatus} />
  }

  return (
    <AuthProvider>
      <ToastProvider>
      <ResilienceLayer />
      <UpgradePromptHost />
      <PasswordRecoveryGate>
      {/* Outer ErrorBoundary — catches render errors on PUBLIC pages too
          (PublicHomePage, LoginPage, ResetPasswordPage, the invite-accept
          flow). Without this, a crash in one of those routes would render
          a blank screen to a visitor who hasn't even authenticated yet —
          worst impression possible. The inner boundary inside
          ProtectedRoute still catches lazy-chunk crashes per-page so the
          editorial fallback can render inside the Layout chrome and offer
          "back to dashboard" instead of "back to home". */}
      <ErrorBoundary source="app-shell">
      <Routes>
        <Route path="/" element={<PublicHomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/invite/accept"
          element={
            <Suspense fallback={<Loading text="Loading invite..." />}>
              <AcceptInvitePage />
            </Suspense>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <ErrorBoundary source="protected-route">
                <Suspense fallback={<Loading text="Loading..." />}>
                <SentryRoutes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/console" element={<Navigate to="/dashboard" replace />} />
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
                  <Route path="/organization/members" element={<OrganizationSettingsPage />} />
                  <Route path="/org/:slug/settings/*" element={<OrganizationSettingsPage />} />
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/docs-bridge" element={<DocsBridgePage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </SentryRoutes>
                </Suspense>
                </ErrorBoundary>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      </ErrorBoundary>
      </PasswordRecoveryGate>
      </ToastProvider>
    </AuthProvider>
  )
}
