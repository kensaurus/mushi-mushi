/**
 * FILE: apps/admin/src/components/Layout.tsx
 * PURPOSE: App shell — sectioned sidebar with SVG icons, active indicator bar,
 *          responsive mobile drawer, skip-nav a11y link.
 */

import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useEffect, useState } from 'react'
import type { ReactNode, ComponentType } from 'react'
import {
  IconDashboard, IconReports, IconGraph, IconJudge, IconQuery,
  IconFixes, IconProjects, IconIntegrations, IconQueue, IconSSO,
  IconAudit, IconFineTuning, IconSettings, IconMenu, IconClose,
  IconSignOut, IconHealth, IconShield, IconBell, IconIntelligence, IconBilling,
  IconCompliance, IconStorage, IconMarketplace, IconGlobe, IconSparkle,
} from './icons'
import { IntegrationHealthDot } from './IntegrationHealthDot'
import { ProjectSwitcher } from './ProjectSwitcher'
import { stageForPath, type PdcaStageId } from '../lib/pdca'

interface NavItem {
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
}

interface NavSection {
  /** Section title shown in the sidebar header. */
  title: string
  /** Single-character PDCA stage badge (P / D / C / A). Omit to hide. */
  stage?: 'P' | 'D' | 'C' | 'A'
  /** Hover tooltip explaining what this stage does in the loop. */
  hint?: string
  /** Stable id used for collapse persistence. */
  id: string
  /** When true, the section starts collapsed and the user must opt in to
   *  see the items. Used for "Workspace" so first-run users see the loop
   *  pages first instead of 8 admin destinations. */
  defaultCollapsed?: boolean
  items: NavItem[]
}

// Sidebar is reshaped around the README's PDCA loop instead of jargon
// buckets (Overview / Pipeline / Operations / Configuration). New users see
// where each tab lives in the loop and where the bottleneck typically sits.
// Keep route paths identical — only labels and grouping change so muscle
// memory + bookmarks survive.
const NAV: NavSection[] = [
  {
    id: 'start',
    title: 'Start here',
    items: [
      { label: 'Dashboard',   path: '/',           icon: IconDashboard },
      { label: 'Get started', path: '/onboarding', icon: IconSparkle },
    ],
  },
  {
    id: 'plan',
    title: 'Plan — capture & classify',
    stage: 'P',
    hint: 'Inbound user-felt bugs land here, get classified, deduped, and prioritised.',
    items: [
      { label: 'Reports',     path: '/reports',     icon: IconReports },
      { label: 'Graph',       path: '/graph',       icon: IconGraph },
      { label: 'Anti-Gaming', path: '/anti-gaming', icon: IconShield },
      { label: 'Queue',       path: '/queue',       icon: IconQueue },
    ],
  },
  {
    id: 'do',
    title: 'Do — dispatch fixes',
    stage: 'D',
    hint: 'Turn classified reports into draft pull requests. Tune the prompt that does it.',
    items: [
      { label: 'Fixes',      path: '/fixes',      icon: IconFixes },
      { label: 'Prompt Lab', path: '/prompt-lab', icon: IconFineTuning },
    ],
  },
  {
    id: 'check',
    title: 'Check — verify quality',
    stage: 'C',
    hint: 'Independently grade the LLM\u2019s work and the system\u2019s own health.',
    items: [
      { label: 'Judge',        path: '/judge',        icon: IconJudge },
      { label: 'Health',       path: '/health',       icon: IconHealth },
      { label: 'Intelligence', path: '/intelligence', icon: IconIntelligence },
      { label: 'Research',     path: '/research',     icon: IconGlobe },
    ],
  },
  {
    id: 'act',
    title: 'Act — integrate & scale',
    stage: 'A',
    hint: 'Standardise verified fixes back into the upstream tools your team already lives in.',
    items: [
      { label: 'Integrations',  path: '/integrations',  icon: IconIntegrations },
      { label: 'Marketplace',   path: '/marketplace',   icon: IconMarketplace },
      { label: 'Notifications', path: '/notifications', icon: IconBell },
    ],
  },
  {
    id: 'workspace',
    title: 'Workspace',
    hint: 'Account, identity, and admin tools — outside the bug-fix loop.',
    defaultCollapsed: true,
    items: [
      { label: 'Projects',   path: '/projects',   icon: IconProjects },
      { label: 'Settings',   path: '/settings',   icon: IconSettings },
      { label: 'SSO',        path: '/sso',        icon: IconSSO },
      { label: 'Billing',    path: '/billing',    icon: IconBilling },
      { label: 'Audit Log',  path: '/audit',      icon: IconAudit },
      { label: 'Compliance', path: '/compliance', icon: IconCompliance },
      { label: 'Storage',    path: '/storage',    icon: IconStorage },
      { label: 'Query',      path: '/query',      icon: IconQuery },
    ],
  },
]

const NAV_COLLAPSED_KEY = 'mushi:nav:collapsed:v1'

function readCollapsedState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(NAV_COLLAPSED_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeCollapsedState(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(state))
  } catch {
    // localStorage write can fail in private mode; non-fatal.
  }
}

const SECTION_TO_STAGE: Record<string, PdcaStageId> = {
  plan: 'plan',
  do: 'do',
  check: 'check',
  act: 'act',
}

const STAGE_TONE: Record<NonNullable<NavSection['stage']>, string> = {
  P: 'bg-info-muted text-info',
  D: 'bg-brand/15 text-brand',
  C: 'bg-warn-muted text-warn',
  A: 'bg-ok-muted text-ok',
}

function isActive(currentPath: string, itemPath: string) {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/')
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(() => readCollapsedState())

  const activeStage = stageForPath(pathname)

  // Force-open the section that contains the current page so the user
  // never sees a sidebar where their location is hidden behind a collapsed
  // chevron. The effective collapsed state mirrors `toggleSection` —
  // `prev[id] ?? defaultCollapsed` — so a deep-link into Workspace
  // (defaultCollapsed: true, no localStorage entry yet) still expands.
  // Only mutates in-memory state, so the user's persisted preference
  // survives a reload.
  useEffect(() => {
    const containing = NAV.find(s => s.items.some(i => isActive(pathname, i.path)))
    if (!containing) return
    setCollapsedMap(prev => {
      const effectivelyCollapsed = prev[containing.id] ?? containing.defaultCollapsed ?? false
      if (!effectivelyCollapsed) return prev
      return { ...prev, [containing.id]: false }
    })
  }, [pathname])

  function toggleSection(id: string, defaultCollapsed: boolean) {
    setCollapsedMap(prev => {
      const currentlyCollapsed = prev[id] ?? defaultCollapsed
      const next = { ...prev, [id]: !currentlyCollapsed }
      writeCollapsedState(next)
      return next
    })
  }

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
        {NAV.map((section) => {
          const collapsed = collapsedMap[section.id] ?? section.defaultCollapsed ?? false
          const stageId = SECTION_TO_STAGE[section.id]
          const isActiveStage = stageId !== undefined && stageId === activeStage
          const collapsible = section.defaultCollapsed !== undefined || section.id === 'workspace'
          return (
            <div key={section.id}>
              <SectionHeader
                section={section}
                collapsed={collapsed}
                collapsible={collapsible}
                isActiveStage={isActiveStage}
                onToggle={() => toggleSection(section.id, section.defaultCollapsed ?? false)}
              />
              {!collapsed && (
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
              )}
            </div>
          )
        })}
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
          <div className="ml-auto">
            <ProjectSwitcher />
          </div>
        </header>

        {/* Desktop sub-header — project switcher pinned to the right */}
        <header className="hidden md:flex items-center justify-end gap-3 px-5 py-1.5 border-b border-edge/40 bg-surface-root/60">
          <ProjectSwitcher />
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

interface SectionHeaderProps {
  section: NavSection
  collapsed: boolean
  collapsible: boolean
  isActiveStage: boolean
  onToggle: () => void
}

function SectionHeader({ section, collapsed, collapsible, isActiveStage, onToggle }: SectionHeaderProps) {
  const inner = (
    <span className="flex items-center gap-1.5 min-w-0 w-full">
      {section.stage && (
        <span
          className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-[0.55rem] font-bold leading-none shrink-0 ${STAGE_TONE[section.stage]}`}
          aria-hidden="true"
        >
          {section.stage}
        </span>
      )}
      <span className="truncate flex-1 text-left">{section.title}</span>
      {isActiveStage && (
        <span
          className="text-3xs font-medium normal-case tracking-normal text-brand shrink-0"
          aria-label="Current stage"
        >
          ← here
        </span>
      )}
      {collapsible && (
        <svg
          className={`h-2.5 w-2.5 text-fg-faint shrink-0 motion-safe:transition-transform ${collapsed ? '' : 'rotate-90'}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )

  if (collapsible) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="nav-section flex items-center gap-1.5 w-full hover:text-fg-secondary motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm"
        title={section.hint}
        aria-expanded={!collapsed}
      >
        {inner}
      </button>
    )
  }
  return (
    <div className="nav-section flex items-center gap-1.5" title={section.hint}>
      {inner}
    </div>
  )
}
