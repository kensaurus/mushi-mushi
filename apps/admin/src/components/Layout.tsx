/**
 * FILE: apps/admin/src/components/Layout.tsx
 * PURPOSE: App shell — sectioned sidebar with SVG icons, active indicator bar,
 *          responsive mobile drawer, skip-nav a11y link.
 */

import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useState } from 'react'
import type { ReactNode, ComponentType } from 'react'
import {
  IconDashboard, IconReports, IconGraph, IconJudge, IconQuery,
  IconFixes, IconProjects, IconIntegrations, IconQueue, IconSSO,
  IconAudit, IconFineTuning, IconSettings, IconMenu, IconClose,
  IconSignOut, IconHealth, IconShield, IconBell, IconIntelligence, IconBilling,
  IconCompliance, IconStorage, IconMarketplace, IconGlobe,
} from './icons'
import { IntegrationHealthDot } from './IntegrationHealthDot'

interface NavItem {
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard',  path: '/',        icon: IconDashboard },
      { label: 'Reports',    path: '/reports',  icon: IconReports },
      { label: 'Graph',      path: '/graph',    icon: IconGraph },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      { label: 'Judge',      path: '/judge',       icon: IconJudge },
      { label: 'Query',      path: '/query',       icon: IconQuery },
      { label: 'Research',   path: '/research',    icon: IconGlobe },
      { label: 'Fixes',      path: '/fixes',       icon: IconFixes },
      { label: 'Queue',      path: '/queue',        icon: IconQueue },
      { label: 'Prompt Lab',  path: '/prompt-lab',   icon: IconFineTuning },
      { label: 'Intelligence', path: '/intelligence', icon: IconIntelligence },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Health',         path: '/health',        icon: IconHealth },
      { label: 'Anti-Gaming',    path: '/anti-gaming',   icon: IconShield },
      { label: 'Notifications',  path: '/notifications', icon: IconBell },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { label: 'Projects',     path: '/projects',     icon: IconProjects },
      { label: 'Integrations', path: '/integrations', icon: IconIntegrations },
      { label: 'Marketplace',  path: '/marketplace',  icon: IconMarketplace },
      { label: 'SSO',          path: '/sso',          icon: IconSSO },
      { label: 'Audit Log',    path: '/audit',        icon: IconAudit },
      { label: 'Compliance',   path: '/compliance',   icon: IconCompliance },
      { label: 'Storage',      path: '/storage',      icon: IconStorage },
      { label: 'Billing',      path: '/billing',      icon: IconBilling },
      { label: 'Settings',     path: '/settings',     icon: IconSettings },
    ],
  },
]

function isActive(currentPath: string, itemPath: string) {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/')
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-4 py-3 border-b border-edge/60">
        <h1 className="text-sm font-bold tracking-tight leading-none">
          <span className="text-brand">mushi</span>
          <span className="text-fg-secondary">mushi</span>
        </h1>
        <p className="text-2xs text-fg-muted mt-1 tracking-wide uppercase">Admin Console</p>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-2">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="nav-section">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map(({ label, path, icon: Icon }) => {
                const active = isActive(pathname, path)
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className="nav-link"
                  >
                    <Icon className="nav-link-icon" />
                    <span>{label}</span>
                    {path === '/integrations' && <IntegrationHealthDot />}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 py-2.5 border-t border-edge/60">
        <div className="text-2xs text-fg-muted truncate mb-2 px-1">{user?.email}</div>
        <button
          onClick={signOut}
          className="nav-link w-full text-xs"
        >
          <IconSignOut className="nav-link-icon" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Skip nav — a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-brand focus:text-brand-fg focus:px-3 focus:py-1.5 focus:rounded-sm focus:text-xs focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-52 flex-shrink-0 border-r border-edge/60 bg-surface-root flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-overlay backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-60 h-full bg-surface-root border-r border-edge/60 flex flex-col shadow-raised">
            <div className="absolute top-2.5 right-2.5">
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
              >
                <IconClose size={14} />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-2.5 border-b border-edge/60 bg-surface-root">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-1.5 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <IconMenu size={18} />
          </button>
          <span className="text-sm font-bold tracking-tight">
            <span className="text-brand">mushi</span>
            <span className="text-fg-secondary">mushi</span>
          </span>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto bg-surface">
          <div className="max-w-6xl mx-auto px-5 py-4">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
