/**
 * FILE: apps/admin/src/components/tester/TesterLayout.tsx
 * PURPOSE: Tester portal app shell — mirrors admin Layout (sidebar + sub-header
 *          + scrollable main) with a purple accent portal theme via data-portal.
 */

import { useEffect, useState, Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Loading } from '../ui'
import { useAuth } from '../../lib/auth'
import { useTesterStatus, reputationTier } from '../../lib/useTesterStatus'
import { appChromeHeaderClass, appChromeMainClass, mobileNavBelowAppChromeClass } from '../../lib/appChrome'
import { PAGE_SHELL_CLASS } from '../../lib/pageLayout'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { PortalToggle } from '../PortalSwitcher'
import { SidebarUserCard } from '../SidebarUserCard'
import { ThemeSidebarToggle } from '../ThemeSidebarToggle'
import { RouteProgress } from '../RouteProgress'
import { TesterWelcomeEnroll } from './TesterWelcomeEnroll'
import {
  IconClose,
  IconDashboard,
  IconGlobe,
  IconMarketplace,
  IconMenu,
  IconReports,
  IconRewards,
  IconSettings,
  IconSignOut,
} from '../icons'

/** Routes readable before a tester profile exists. */
const PRE_ENROLL_PATHS = new Set(['/tester/learn'])

function TesterMainContent() {
  const { pathname } = useLocation()
  const { data: status, loading, error, reload } = useTesterStatus()
  const allowWithoutProfile = PRE_ENROLL_PATHS.has(pathname)

  if (loading && !status) {
    return <Loading text="Loading your profile…" />
  }

  if (!allowWithoutProfile && !loading && error && !status?.isTester) {
    return (
      <div className={`${PAGE_SHELL_CLASS} mx-auto max-w-lg space-y-3 py-8 text-center`}>
        <p className="text-sm font-medium text-fg">Could not load your tester profile</p>
        <p className="text-xs text-fg-muted text-pretty">{error}</p>
        <button
          type="button"
          className="text-sm font-medium text-brand hover:underline"
          onClick={() => reload()}
        >
          Retry
        </button>
      </div>
    )
  }

  if (!allowWithoutProfile && status && !status.isTester) {
    return <TesterWelcomeEnroll />
  }

  return (
    <Suspense fallback={<Loading text="Loading…" />}>
      <Outlet />
    </Suspense>
  )
}

const NAV_ITEMS: Array<{
  to: string
  label: string
  icon: typeof IconDashboard
  end?: boolean
}> = [
  { to: '/tester', label: 'Home', icon: IconDashboard, end: true },
  { to: '/tester/apps', label: 'Apps', icon: IconMarketplace },
  { to: '/tester/submissions', label: 'Reports', icon: IconReports },
  { to: '/tester/wallet', label: 'Wallet', icon: IconRewards },
  { to: '/tester/learn', label: 'Learn', icon: IconGlobe },
  { to: '/tester/settings', label: 'Settings', icon: IconSettings },
]

const PAGE_TITLES: Record<string, string> = {
  '/tester': 'Home',
  '/tester/': 'Home',
  '/tester/apps': 'Apps',
  '/tester/wallet': 'Wallet',
  '/tester/learn': 'Learn',
  '/tester/settings': 'Settings',
  '/tester/submissions': 'Submissions',
}

function BalanceStrip() {
  const { data: status } = useTesterStatus()
  if (!status?.isTester) return null
  const tier = reputationTier(status.reputation)
  return (
    <Link
      to="/tester/wallet"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium motion-safe:transition-opacity hover:opacity-90 ${tier.bg} ${tier.color}`}
      title="Open wallet"
    >
      <span aria-hidden>🪙</span>
      <span className="tabular-nums">{status.balance.toLocaleString()} pts</span>
      <span className="hidden opacity-70 sm:inline" aria-hidden>·</span>
      <span className="hidden sm:inline">{tier.name}</span>
    </Link>
  )
}

function renderSidebarNav(compact: boolean) {
  return (
    <nav aria-label="Tester portal" className={`flex-1 overflow-y-auto py-2 ${compact ? 'px-1' : 'px-2'}`}>
      {!compact && (
        <p className="px-2 pb-1.5 text-3xs font-semibold uppercase tracking-wider text-nav-section-label">
          Earn
        </p>
      )}
      <div className={compact ? 'space-y-0.5 flex flex-col items-stretch' : 'space-y-0.5'}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={compact ? label : undefined}
            className={({ isActive }) =>
              `nav-link ${compact ? 'justify-center px-2 py-2' : ''} ${isActive ? '' : ''}`
            }
          >
            <Icon className="nav-link-icon" />
            {!compact && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function renderSidebarContent(compact: boolean, user: ReturnType<typeof useAuth>['user'], signOut: () => void) {
  return (
    <>
      <div className={`${compact ? 'px-2 py-3' : 'px-4 py-3'} border-b border-edge/60`}>
        {compact ? (
          <div className="space-y-1.5">
            <h1 className="text-center text-sm font-bold leading-none tracking-tight" aria-label="mushimushi bounties">
              <span className="text-brand">m</span>
              <span className="text-fg-secondary">m</span>
            </h1>
            <PortalToggle compact />
          </div>
        ) : (
          <>
            <h1 className="text-sm font-bold leading-none tracking-tight">
              <span className="text-brand">mushi</span>
              <span className="text-fg-secondary">mushi</span>
            </h1>
            <PortalToggle />
          </>
        )}
      </div>

      {renderSidebarNav(compact)}

      <div className={`${compact ? 'space-y-2 px-1 py-2' : 'space-y-2 px-3 py-2.5'} border-t border-edge/60`}>
        {!compact && <ThemeSidebarToggle focusMode={false} onToggleFocus={() => {}} showFocus={false} />}
        {!compact && user && <SidebarUserCard user={user} signOut={signOut} />}
        {compact && (
          <button
            type="button"
            onClick={signOut}
            className="nav-link justify-center px-2 py-2 text-rose hover:bg-rose-muted/40 hover:text-rose"
            title={`Sign out (${user?.email ?? ''})`}
            aria-label="Sign out"
          >
            <IconSignOut className="nav-link-icon" />
          </button>
        )}
      </div>
    </>
  )
}

/** Route layout shell — renders `<Outlet />` for nested /tester/* pages. */
export function TesterLayout() {
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const pageTitle = PAGE_TITLES[pathname] ?? 'Tester'

  useDocumentTitle()

  useEffect(() => {
    document.documentElement.setAttribute('data-portal', 'tester')
    return () => {
      document.documentElement.removeAttribute('data-portal')
    }
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <RouteProgress />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-brand focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-brand-fg"
      >
        Skip to main content
      </a>

      <aside className="hidden min-h-0 w-60 shrink-0 flex-col border-r border-edge/60 bg-surface-root md:flex">
        {renderSidebarContent(false, user, signOut)}
      </aside>

      {mobileOpen && (
        <div className={mobileNavBelowAppChromeClass}>
          <div
            className="absolute inset-0 bg-overlay backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 flex h-full w-60 flex-col border-r border-edge/60 bg-surface-root shadow-raised">
            <div className="absolute right-2.5 top-2.5">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-sm p-1.5 text-fg-muted motion-safe:transition-colors hover:bg-surface-overlay hover:text-fg"
              >
                <IconClose size={14} />
              </button>
            </div>
            {renderSidebarContent(false, user, signOut)}
          </aside>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className={`flex items-center gap-2 border-b border-edge/60 px-4 py-2.5 md:hidden ${appChromeHeaderClass}`}>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="shrink-0 rounded-sm p-1.5 text-fg-muted motion-safe:transition-colors hover:bg-surface-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <IconMenu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{pageTitle}</p>
          </div>
          <BalanceStrip />
        </header>

        <header className={`hidden items-center gap-3 border-b border-edge/40 px-5 py-1.5 md:flex ${appChromeHeaderClass}`}>
          <div className="min-w-0 shrink-0">
            <p className="text-xs font-semibold text-fg">{pageTitle}</p>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2 overflow-visible">
            <BalanceStrip />
          </div>
        </header>

        <main id="main-content" className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-surface ${appChromeMainClass}`}>
          <div className={PAGE_SHELL_CLASS.standard}>
            <TesterMainContent />
          </div>
        </main>
      </div>
    </div>
  )
}
