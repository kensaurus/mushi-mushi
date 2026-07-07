import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { TesterLayout } from './components/tester/TesterLayout'
import { LoginPage } from './pages/LoginPage'
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
import { BetaBanner } from './components/BetaBanner'
import { useSessionWatcher } from './lib/sessionWatcher'
import { initMushiSelf } from './lib/mushi-self'

// SentryRoutes = Routes (no wrapper).
//
// withSentryReactRouterV7Routing(Routes) causes a React hooks-order violation
// in React 19 + StrictMode (double-render): "Previous useContext, Next useRef".
// This triggers "Internal React error: Expected static flag was missing" and
// random SPA navigations (the component tree re-mounts mid-session).
//
// Route-transaction names are parameterised via reactRouterV7BrowserTracingIntegration
// (createRoutesFromChildren + matchRoutes) in lib/sentry.ts. Full parametrised
// naming via createBrowserRouter is deferred — the Sentry wrapper triggers a
// React 19 StrictMode hooks-order violation with the current Routes setup.
const SentryRoutes = Routes

const envStatus = checkEnv()

const ContentQualityPage = lazy(() => import('./pages/ContentQualityPage').then(m => ({ default: m.ContentQualityPage })))
const ContentQualityDetailPage = lazy(() => import('./pages/ContentQualityDetailPage').then(m => ({ default: m.ContentQualityDetailPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })))
const ReportDetailPage = lazy(() => import('./pages/ReportDetailPage').then(m => ({ default: m.ReportDetailPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const DLQPage = lazy(() => import('./pages/DLQPage').then(m => ({ default: m.DLQPage })))
const GraphPage = lazy(() => import('./pages/GraphPage').then(m => ({ default: m.GraphPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const JudgePage = lazy(() => import('./pages/JudgePage').then(m => ({ default: m.JudgePage })))
const QueryPage = lazy(() => import('./pages/QueryPage').then(m => ({ default: m.QueryPage })))
const ResearchPage = lazy(() => import('./pages/ResearchPage').then(m => ({ default: m.ResearchPage })))
const FixesPage = lazy(() => import('./pages/FixesPage').then(m => ({ default: m.FixesPage })))
const RepoPage = lazy(() => import('./pages/RepoPage').then(m => ({ default: m.RepoPage })))
const SsoPage = lazy(() => import('./pages/SsoPage').then(m => ({ default: m.SsoPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })))
const FullStackAuditPage = lazy(() => import('./pages/FullStackAuditPage').then(m => ({ default: m.FullStackAuditPage })))
const CodeHealthPage = lazy(() => import('./pages/CodeHealthPage').then(m => ({ default: m.CodeHealthPage })))
const PromptLabPage = lazy(() => import('./pages/PromptLabPage').then(m => ({ default: m.PromptLabPage })))
const IntelligencePage = lazy(() => import('./pages/IntelligencePage').then(m => ({ default: m.IntelligencePage })))
const CompliancePage = lazy(() => import('./pages/CompliancePage').then(m => ({ default: m.CompliancePage })))
const StoragePage = lazy(() => import('./pages/StoragePage').then(m => ({ default: m.StoragePage })))
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then(m => ({ default: m.MarketplacePage })))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })))
import { IntegrationsRouteGate } from './pages/IntegrationsRouteGate'
const ConnectPage = lazy(() => import('./pages/ConnectPage').then(m => ({ default: m.ConnectPage })))
const McpPage = lazy(() => import('./pages/McpPage').then(m => ({ default: m.McpPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const SetupCopilotPage = lazy(() => import('./pages/SetupCopilotPage').then(m => ({ default: m.SetupCopilotPage })))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage').then(m => ({ default: m.FeedbackPage })))
const FeatureBoardPage = lazy(() => import('./pages/FeatureBoardPage').then(m => ({ default: m.FeatureBoardPage })))
const HealthPage = lazy(() => import('./pages/HealthPage').then(m => ({ default: m.HealthPage })))
const QaCoveragePage = lazy(() => import('./pages/QaCoveragePage').then(m => ({ default: m.QaCoveragePage })))
const AntiGamingPage = lazy(() => import('./pages/AntiGamingPage').then(m => ({ default: m.AntiGamingPage })))
const RewardsPage = lazy(() => import('./pages/RewardsPage').then(m => ({ default: m.RewardsPage })))
const TesterSubmissionsReviewPage = lazy(() =>
  import('./pages/TesterSubmissionsReviewPage').then(m => ({ default: m.TesterSubmissionsReviewPage })),
)
const LessonsPage = lazy(() => import('./pages/LessonsPage').then(m => ({ default: m.LessonsPage })))
const ReleasesPage = lazy(() => import('./pages/ReleasesPage').then(m => ({ default: m.ReleasesPage })))
const IteratePage = lazy(() => import('./pages/IteratePage').then(m => ({ default: m.IteratePage })))
const SkillPipelinesPage = lazy(() => import('./pages/SkillPipelinesPage').then(m => ({ default: m.SkillPipelinesPage })))
const DriftPage = lazy(() => import('./pages/DriftPage').then(m => ({ default: m.DriftPage })))
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage').then(m => ({ default: m.ExperimentsPage })))
const AnomaliesPage = lazy(() => import('./pages/AnomaliesPage').then(m => ({ default: m.AnomaliesPage })))
const CostPage = lazy(() => import('./pages/CostPage').then(m => ({ default: m.CostPage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })))
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })))
const OrganizationSettingsPage = lazy(() => import('./pages/OrganizationSettingsPage').then(m => ({ default: m.OrganizationSettingsPage })))
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage').then(m => ({ default: m.AcceptInvitePage })))
const CliAuthPage = lazy(() => import('./pages/CliAuthPage').then(m => ({ default: m.CliAuthPage })))
const McpAuthPage = lazy(() => import('./pages/McpAuthPage').then(m => ({ default: m.McpAuthPage })))
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
const ExplorePage = lazy(() => import('./pages/ExplorePage').then(m => ({ default: m.ExplorePage })))

// Mushi Bounties — tester portal pages (lazy, separate chunk so devs never load them)
const TesterHomePage = lazy(() => import('./pages/tester/TesterHomePage').then(m => ({ default: m.TesterHomePage })))
const TesterAppsPage = lazy(() => import('./pages/tester/TesterAppsPage').then(m => ({ default: m.TesterAppsPage })))
const TesterWalletPage = lazy(() => import('./pages/tester/TesterWalletPage').then(m => ({ default: m.TesterWalletPage })))
const TesterSettingsPage = lazy(() => import('./pages/tester/TesterSettingsPage').then(m => ({ default: m.TesterSettingsPage })))
const TesterLearnPage = lazy(() => import('./pages/tester/TesterLearnPage').then(m => ({ default: m.TesterLearnPage })))
const TesterSubmissionsPage = lazy(() => import('./pages/tester/TesterSubmissionsPage').then(m => ({ default: m.TesterSubmissionsPage })))

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

/**
 * McpManualRedirect — legacy alias from Connect unification; canonical MCP
 * console lives at /mcp (sidebar "Agent help").
 */
function McpManualRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/mcp${search}`} replace />
}
/**
 * QaCoverageRedirect — handles legacy Slack notification URLs that used the
 * old path format `/projects/:pid/qa-coverage/:storyId`. Slack notifications
 * sent before Jun 11 2026 used this format; we now redirect to the canonical
 * query-param deep-link `/qa-coverage?project=:pid&story=:storyId` so the
 * QA Coverage page can auto-switch the project and open the story drawer.
 */
function QaCoverageRedirect() {
  const { pid, storyId } = useParams<{ pid: string; storyId: string }>()
  const query = new URLSearchParams({
    project: pid ?? '',
    story: storyId ?? '',
  }).toString()
  return (
    <Navigate
      to={`/qa-coverage?${query}`}
      replace
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
  if (loading) return <div className="flex h-full min-h-0 items-center justify-center"><Loading text="Loading…" /></div>
  if (!session) return <Navigate to={loginPathForLocation(location)} replace state={{ from: location }} />
  return <>{children}</>
}

/**
 * TesterRoute — like ProtectedRoute but:
 *   1. Redirects unauthenticated visitors to /login?as=tester
 *   2. Wave 9: Self-hosted instances see an upgrade CTA instead of the tester portal.
 *      The marketplace is cloud-only (per plan spec).
 */
function TesterRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex h-full min-h-0 items-center justify-center"><Loading text="Loading…" /></div>
  // Wave 9 self-host gate: marketplace is cloud-only.
  if (envStatus.mode === 'self-hosted') {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-8">
        <div className="max-w-md text-center space-y-4">
          <p className="text-2xl">🪲</p>
          <h1 className="text-lg font-semibold">Mushi Bounties requires Mushi Cloud</h1>
          <p className="text-sm text-fg-muted">
            The tester marketplace and reward system are hosted features — they
            require a Mushi Cloud account with Pro or higher.
          </p>
          <a
            href="https://kensaur.us/mushi-mushi/pricing"
            className="inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors"
          >
            Upgrade to Mushi Cloud →
          </a>
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to={`/login?as=tester&next=${encodeURIComponent(location.pathname)}`} replace />
  return <>{children}</>
}

function ResilienceLayer() {
  useSessionWatcher()
  return <OfflineBanner />
}

/** Lazy-initialises the Mushi self-dogfood SDK.
 *  Init is NOT gated on the session: the SDK authenticates with its own
 *  project API key, and a logged-out visitor hitting a broken login page is
 *  exactly who must still be able to report a bug (red-team #12 — reports
 *  used to be silently discarded pre-login). The session effect only
 *  attributes reports once the user is known. */
function MushiSelfMount() {
  const { session } = useAuth()
  useEffect(() => {
    void initMushiSelf(session ? { userId: session.user.id } : undefined)
  }, [session?.user?.id])
  return null
}

export function App() {
  if (envStatus.mode === 'self-hosted' && !envStatus.ready) {
    return <SetupGatePage env={envStatus} />
  }

  return (
    <AuthProvider>
      <ToastProvider>
      {/* App shell — one viewport, one primary scroll surface. BetaBanner
          lives inside the shell (not above a separate h-screen Layout) so
          we never get body + <main> double scrollbars. */}
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <BetaBanner />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResilienceLayer />
      <MushiSelfMount />
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
        {/* The marketing landing lives at the product root (kensaur.us/mushi-mushi/),
            served by the docs static export via the CloudFront internal rewrite
            (scripts/cloudfront-mushi-spa-router.js). The admin SPA root
            (/mushi-mushi/admin/) is the app itself, so `/` bounces straight to the
            dashboard — ProtectedRoute redirects to /login when unauthenticated.
            (Retired PublicHomePage so the noindex admin shell no longer duplicates
            the indexable landing.) */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Bare /signup lands directly on the signup form instead of bouncing
            through ProtectedRoute -> /login (see docs/pricing.mdx CTA and
            LoginPage's pathname-based initial mode). */}
        <Route path="/signup" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/invite/accept"
          element={
            <Suspense fallback={<Loading text="Loading invite..." />}>
              <AcceptInvitePage />
            </Suspense>
          }
        />
        {/* Public marketing page — not auth-gated; takes precedence over the
            auth-gated /integrations route inside ProtectedRoute because React
            Router v6 picks the more-specific match over `/*`. The admin
            integration config is available at /integrations/config. */}
        <Route path="/integrations" element={<IntegrationsRouteGate />} />
        {/* Mushi Bounties — tester portal shell mirrors admin Layout; purple portal theme. */}
        <Route
          path="/tester"
          element={
            <TesterRoute>
              <ErrorBoundary source="tester-portal">
                <TesterLayout />
              </ErrorBoundary>
            </TesterRoute>
          }
        >
          <Route index element={<TesterHomePage />} />
          <Route path="apps" element={<TesterAppsPage />} />
          <Route path="wallet" element={<TesterWalletPage />} />
          <Route path="learn" element={<TesterLearnPage />} />
          <Route path="settings" element={<TesterSettingsPage />} />
          <Route path="submissions" element={<TesterSubmissionsPage />} />
          <Route path="*" element={<Navigate to="/tester" replace />} />
        </Route>
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <ErrorBoundary source="protected-route">
                <Suspense fallback={<Loading text="Loading…" />}>
                <SentryRoutes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/console" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/reports/:id" element={<ReportDetailPage />} />
                  <Route path="/content" element={<ContentQualityPage />} />
                  <Route path="/content/:id" element={<ContentQualityDetailPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/queue" element={<DLQPage />} />
                  <Route path="/graph" element={<GraphPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/judge" element={<JudgePage />} />
                  <Route path="/query" element={<QueryPage />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/fixes" element={<FixesPage />} />
                  <Route path="/repo" element={<RepoPage />} />
                  <Route path="/sso" element={<SsoPage />} />
                  <Route path="/audit" element={<AuditPage />} />
                  <Route path="/fullstack-audit" element={<FullStackAuditPage />} />
                  <Route path="/code-health" element={<CodeHealthPage />} />
                  <Route path="/prompt-lab" element={<PromptLabPage />} />
                  <Route path="/fine-tuning" element={<Navigate to="/prompt-lab" replace />} />
                  <Route path="/intelligence" element={<IntelligencePage />} />
                  <Route path="/compliance" element={<CompliancePage />} />
                  <Route path="/storage" element={<StoragePage />} />
                  <Route path="/marketplace" element={<MarketplacePage />} />
                  <Route path="/integrations/config" element={<IntegrationsPage />} />
                  <Route path="/mcp" element={<McpPage />} />
                  <Route path="/mcp/manual" element={<McpManualRedirect />} />
                  <Route path="/connect" element={<ConnectPage />} />
                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route
                    path="/cli-auth"
                    element={
                      <Suspense fallback={<Loading text="Loading…" />}>
                        <CliAuthPage />
                      </Suspense>
                    }
                  />
                  {/* OAuth consent page for MCP client login (claude mcp login, Cursor, VS Code) */}
                  <Route
                    path="/mcp-auth"
                    element={
                      <Suspense fallback={<Loading text="Loading…" />}>
                        <McpAuthPage />
                      </Suspense>
                    }
                  />
                  <Route path="/setup-copilot" element={<SetupCopilotPage />} />
                  <Route path="/feedback" element={<FeedbackPage />} />
                  <Route path="/feature-board" element={<FeatureBoardPage />} />
                  <Route path="/health" element={<HealthPage />} />
                  <Route path="/qa-coverage" element={<QaCoveragePage />} />
                  {/* Legacy Slack notification link format → redirect to query-param deep-link */}
                  <Route path="/projects/:pid/qa-coverage/:storyId" element={<QaCoverageRedirect />} />
                  <Route path="/anti-gaming" element={<AntiGamingPage />} />
                  <Route path="/rewards" element={<RewardsPage />} />
                  <Route path="/rewards/tester-review" element={<TesterSubmissionsReviewPage />} />
                  <Route path="/lessons" element={<LessonsPage />} />
                  <Route path="/releases" element={<ReleasesPage />} />
                  <Route path="/iterate" element={<IteratePage />} />
                  <Route path="/skills" element={<SkillPipelinesPage />} />
                  <Route path="/drift" element={<DriftPage />} />
                  <Route path="/experiments" element={<ExperimentsPage />} />
                  <Route path="/anomalies" element={<AnomaliesPage />} />
                  <Route path="/cost" element={<CostPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/billing" element={<BillingPage />} />
                  <Route path="/organization/members" element={<OrganizationSettingsPage />} />
                  <Route path="/org/:slug/settings/*" element={<OrganizationSettingsPage />} />
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/explore" element={<ExplorePage />} />
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
      </div>
      </div>
      </ToastProvider>
    </AuthProvider>
  )
}
