/**
 * FILE: apps/admin/src/components/Layout.tsx
 * PURPOSE: App shell — sectioned sidebar with SVG icons, active indicator bar,
 *          responsive mobile drawer, skip-nav a11y link.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useEffect, useState } from 'react'
import type { ReactNode, ComponentType } from 'react'
import {
  IconDashboard, IconReports, IconGraph, IconJudge, IconQuery,
  IconFixes, IconProjects, IconIntegrations, IconQueue, IconSSO,
  IconAudit, IconFineTuning, IconSettings, IconMenu, IconClose,
  IconSignOut, IconHealth, IconShield, IconBell, IconIntelligence, IconBilling,
  IconCompliance, IconStorage, IconMarketplace, IconGlobe, IconSparkle, IconGit,
} from './icons'
import { IntegrationHealthDot } from './IntegrationHealthDot'
import { SidebarHealthDot } from './SidebarHealthDot'
import { useNavCounts, toneForBacklog, toneForFailed, toneForInFlight } from '../lib/useNavCounts'
import { ProjectSwitcher } from './ProjectSwitcher'
import { PlanBadge } from './PlanBadge'
import { stageForPath, type PdcaStageId } from '../lib/pdca'
import { useAdminMode, type AdminMode } from '../lib/mode'
import { Tooltip } from './ui'
import { RouteProgress } from './RouteProgress'
import { NextBestAction } from './NextBestAction'
import { PipelineStatusRibbon } from './PipelineStatusRibbon'
import { QuickstartMegaCta } from './QuickstartMegaCta'
import { FirstRunTour } from './FirstRunTour'
import { CommandPalette } from './CommandPalette'
import { SearchButton } from './SearchButton'
import { HotkeysModal } from './HotkeysModal'
import { ActivityDrawer } from './ActivityDrawer'
import { DensitySidebarToggle } from './DensitySidebarToggle'
import { ThemeSidebarToggle } from './ThemeSidebarToggle'
import { WhatsNewModal, useWhatsNew } from './WhatsNew'
import { AIAssistSidebar } from './AIAssistSidebar'
import { useCommandPalette } from '../lib/useCommandPalette'
import { useHotkeys } from '../lib/useHotkeys'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useFaviconBadge } from '../lib/favicon'

interface NavItem {
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  /** Quickstart mode label override. Quickstart hides PDCA jargon
   *  entirely and uses verb-led labels ("Bugs to fix" instead of
   *  "Reports"). When omitted, the route is hidden from the Quickstart
   *  sidebar regardless of `beginner` / advanced status. */
  quickstartLabel?: string
  /** When true, the item is visible in beginner mode. Beginner mode shows a
   *  curated 9-page loop; everything else is hidden until the user opts
   *  into Advanced mode. Routes still resolve in either mode — only the
   *  sidebar is filtered, so deep links + bookmarks survive. */
  beginner?: boolean
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
// Quickstart mode shows the 3-page minimal loop:
//   Bugs to fix       (/reports)  — verb-led label, no PDCA section
//   Fixes ready       (/fixes)
//   Setup             (/onboarding)
// Beginner mode shows the 9-page linear loop:
//   Start    → Dashboard, Get started
//   Plan     → Reports, Graph
//   Do       → Fixes
//   Check    → Judge, Health
//   Act      → Integrations
//   Workspace→ Settings (collapsed; surfaces only when the user opens it)
// Advanced mode shows everything below.
const NAV: NavSection[] = [
  {
    id: 'start',
    title: 'Start here',
    // Advanced-mode users already know the basics; collapse so the 4 PDCA
    // groups dominate the sidebar. Beginner/Quickstart still show it first
    // because the mode-specific NAV projection (see below) overrides this.
    defaultCollapsed: true,
    items: [
      { label: 'Dashboard',   path: '/',           icon: IconDashboard, beginner: true },
      // Wave T (2026-04-23) — /inbox is the single top-of-loop destination for
      // "what should I do next?" across the whole PDCA surface. Pinned above
      // the PDCA sections so Advanced users land on it the same way beginner
      // users land on the Dashboard.
      { label: 'Inbox',       path: '/inbox',      icon: IconBell,      beginner: true, quickstartLabel: 'Inbox' },
      { label: 'Get started', path: '/onboarding', icon: IconSparkle,   beginner: true, quickstartLabel: 'Setup' },
    ],
  },
  {
    id: 'plan',
    title: 'Plan — capture & classify',
    stage: 'P',
    hint: 'Inbound user-felt bugs land here, get classified, deduped, and prioritised.',
    items: [
      { label: 'Reports',     path: '/reports',     icon: IconReports, beginner: true, quickstartLabel: 'Bugs to fix' },
      { label: 'Graph',       path: '/graph',       icon: IconGraph,   beginner: true },
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
      { label: 'Fixes',      path: '/fixes',      icon: IconFixes,       beginner: true, quickstartLabel: 'Fixes ready' },
      { label: 'Repo',       path: '/repo',       icon: IconGit },
      { label: 'Prompt Lab', path: '/prompt-lab', icon: IconFineTuning },
    ],
  },
  {
    id: 'check',
    title: 'Check — verify quality',
    stage: 'C',
    hint: 'Independently grade the LLM\u2019s work and the system\u2019s own health.',
    items: [
      { label: 'Judge',        path: '/judge',        icon: IconJudge,        beginner: true },
      { label: 'Health',       path: '/health',       icon: IconHealth,       beginner: true },
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
      { label: 'Integrations',  path: '/integrations',  icon: IconIntegrations, beginner: true },
      { label: 'MCP',           path: '/mcp',           icon: IconIntegrations, beginner: true },
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
      { label: 'Settings',   path: '/settings',   icon: IconSettings, beginner: true },
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

/**
 * Scroll to `#hash` once the destination page and any lazy chunk has mounted.
 * Runs on every location change. Retries up to ~500ms to handle Suspense
 * fallbacks resolving after the hash URL lands — the element we want to
 * scroll to may not exist on the first effect pass.
 */
function ScrollToHashAnchor() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 10
    const tick = () => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (++attempts < MAX_ATTEMPTS) setTimeout(tick, 50)
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [hash])
  return null
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(() => readCollapsedState())
  const { mode, setMode, isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  const palette = useCommandPalette()
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityUnread, setActivityUnread] = useState(0)
  const [aiOpen, setAiOpen] = useState(false)
  const whatsNew = useWhatsNew()
  const navCounts = useNavCounts()

  // UIUX-2 (2026-04-23): keep the browser tab title + favicon in sync
  // with the page the user is on. Both hooks read from `pageContext` so
  // pages that publish live counts (e.g. "Reports · 12 new · 3 critical")
  // get a matching tab title and a red favicon dot when criticals > 0.
  useDocumentTitle()
  useFaviconBadge()

  // Global Cmd/Ctrl+K opens the command palette. `allowInInputs: true`
  // because the shortcut's whole point is to be reachable while the user
  // is mid-type in a search box or filter field.
  // Global `?` opens the shortcut cheatsheet. We match on `shift: true`
  // because `?` requires Shift on US layouts but allow `e.key === '?'`
  // on AZERTY/non-shift layouts that produce the literal character.
  useHotkeys(
    [
      {
        key: 'k',
        description: 'Open command palette',
        handler: (e) => {
          e.preventDefault()
          palette.toggle()
        },
        meta: true,
        allowInInputs: true,
      },
      {
        key: 'k',
        description: 'Open command palette',
        handler: (e) => {
          e.preventDefault()
          palette.toggle()
        },
        ctrl: true,
        allowInInputs: true,
      },
      {
        key: '?',
        description: 'Toggle keyboard shortcuts',
        handler: (e) => {
          e.preventDefault()
          setHotkeysOpen((v) => !v)
        },
      },
      {
        key: 'j',
        description: 'Toggle AI sidebar (scoped to current page)',
        handler: (e) => {
          e.preventDefault()
          setAiOpen((v) => !v)
        },
        meta: true,
      },
      {
        key: 'j',
        description: 'Toggle AI sidebar (scoped to current page)',
        handler: (e) => {
          e.preventDefault()
          setAiOpen((v) => !v)
        },
        ctrl: true,
      },
      // Wave T (2026-04-23) — ⌘⇧I / Ctrl⇧I jumps to the global /inbox page.
      // `allowInInputs: true` because an operator deep in a search field
      // should still be able to hop to the inbox without clicking away.
      // SPA-nav via `useNavigate` rather than `window.location.assign` so
      // in-memory state (toast queue, scroll, focus) survives the jump.
      {
        key: 'i',
        description: 'Open the Action Inbox',
        handler: (e) => {
          e.preventDefault()
          navigate('/inbox')
        },
        meta: true,
        shift: true,
        allowInInputs: true,
      },
      {
        key: 'i',
        description: 'Open the Action Inbox',
        handler: (e) => {
          e.preventDefault()
          navigate('/inbox')
        },
        ctrl: true,
        shift: true,
        allowInInputs: true,
      },
    ],
  )

  const activeStage = stageForPath(pathname)

  // Filter NAV items based on the active mode.
  //  • Quickstart: 3 verb-led routes flattened into one section ("Quick").
  //    PDCA stage badges + section titles are stripped — quickstart users
  //    don't need the loop vocabulary, just the next button.
  //  • Beginner: 9-page curated loop, PDCA section structure preserved.
  //  • Advanced: full 23-page console.
  // Sections collapse to an empty shell if all their items are filtered
  // out; we drop them entirely so the sidebar stays tight.
  let visibleNav: NavSection[]
  if (isQuickstart) {
    const quickItems: NavItem[] = NAV.flatMap(s =>
      s.items
        .filter(i => i.quickstartLabel !== undefined)
        .map(i => ({ ...i, label: i.quickstartLabel ?? i.label })),
    )
    visibleNav = [
      {
        id: 'quick',
        title: 'Quickstart',
        hint: 'Three pages: bugs to fix, fixes ready to merge, setup. Switch modes to unlock more.',
        items: quickItems,
      },
    ]
  } else if (isBeginner) {
    // Beginner mode keeps Start expanded by default — first-run users
    // need the Dashboard / Get started pair in view, not hidden behind
    // a chevron like in advanced mode.
    visibleNav = NAV
      .map(s => ({
        ...s,
        defaultCollapsed: s.id === 'start' ? false : s.defaultCollapsed,
        items: s.items.filter(i => i.beginner),
      }))
      .filter(s => s.items.length > 0)
  } else {
    visibleNav = NAV
  }

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

  // Mode safety net: if the user lands on a route hidden by the active
  // mode (deep link, bookmark, autocomplete), we never block navigation,
  // but we do surface a hint that the page is hidden from their sidebar —
  // and how to switch modes. The hint sits in the sidebar so it doesn't
  // disrupt the page they actually wanted to read.
  const onHiddenRoute = !isAdvanced && pathname !== '/' && !visibleNav.some(s =>
    s.items.some(i => isActive(pathname, i.path))
  )
  const hiddenRouteCopy = isQuickstart
    ? 'This page is outside Quickstart. Switch to Beginner or Advanced to keep it in your sidebar.'
    : 'This page lives in Advanced mode. Switch to keep it in your sidebar.'

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
        <ModeToggle mode={mode} onSelect={setMode} />
        {onHiddenRoute && (
          <div className="mt-2 rounded-sm border border-warn/30 bg-warn/10 px-2 py-1.5 text-3xs text-warn">
            <p className="leading-snug">{hiddenRouteCopy}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-2">
        {visibleNav.map((section) => {
          const collapsed = collapsedMap[section.id] ?? section.defaultCollapsed ?? false
          const stageId = SECTION_TO_STAGE[section.id]
          const isActiveStage = stageId !== undefined && stageId === activeStage
          const collapsible = section.defaultCollapsed !== undefined || section.id === 'workspace'
          // Per-stage staleness — surfaced on the collapsed section header
          // so advanced users can still see at a glance which PDCA stage
          // needs their attention without expanding.
          const staleness = computeStaleness(section.id, navCounts)
          return (
            <div key={section.id}>
              <SectionHeader
                section={section}
                collapsed={collapsed}
                collapsible={collapsible}
                isActiveStage={isActiveStage}
                staleness={staleness}
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
                        {path === '/reports' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={navCounts.ready ? toneForBacklog(navCounts.untriagedBacklog) : 'loading'}
                            count={navCounts.untriagedBacklog}
                            label={`${navCounts.untriagedBacklog} untriaged ${navCounts.untriagedBacklog === 1 ? 'report' : 'reports'}`}
                            hideWhenZero
                          />
                        )}
                        {path === '/fixes' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={navCounts.fixesFailed > 0 ? toneForFailed(navCounts.fixesFailed) : toneForInFlight(navCounts.fixesInFlight)}
                            count={navCounts.fixesFailed > 0 ? navCounts.fixesFailed : navCounts.fixesInFlight}
                            label={
                              navCounts.fixesFailed > 0
                                ? `${navCounts.fixesFailed} failed fixes — needs attention`
                                : navCounts.fixesInFlight > 0
                                  ? `${navCounts.fixesInFlight} fixes in flight`
                                  : 'No active fixes'
                            }
                            hideWhenZero
                          />
                        )}
                        {path === '/repo' && navCounts.ready && navCounts.prsOpen > 0 && (
                          <SidebarHealthDot
                            tone="ok"
                            count={navCounts.prsOpen}
                            label={`${navCounts.prsOpen} PRs open awaiting review`}
                          />
                        )}
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
      <div className="px-3 py-2.5 border-t border-edge/60 space-y-2">
        <DensitySidebarToggle />
        <ThemeSidebarToggle />
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
      <RouteProgress />
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
          <div className="ml-auto flex items-center gap-2">
            <SearchButton />
            <PlanBadge />
            <ProjectSwitcher />
          </div>
        </header>

        {/* Desktop sub-header — project switcher pinned to the right */}
        <header className="hidden md:flex items-center justify-end gap-3 px-5 py-1.5 border-b border-edge/40 bg-surface-root/60">
          <SearchButton />
          <Tooltip content={activityUnread > 0 ? `Live activity — ${activityUnread} new` : 'Live activity'}>
            <button
              type="button"
              onClick={() => setActivityOpen(true)}
              aria-label={activityUnread > 0 ? `Live activity, ${activityUnread} unread` : 'Live activity'}
              className="relative inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <IconBell className="h-3.5 w-3.5" />
              {activityUnread > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex min-w-[0.9rem] h-[0.9rem] items-center justify-center px-1 rounded-full bg-brand text-brand-fg text-[0.55rem] font-semibold leading-none motion-safe:animate-pulse"
                >
                  {activityUnread > 9 ? '9+' : activityUnread}
                </span>
              )}
            </button>
          </Tooltip>
          <Tooltip content="Keyboard shortcuts (press ?)">
            <button
              type="button"
              onClick={() => setHotkeysOpen(true)}
              aria-label="Open keyboard shortcuts"
              className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <span aria-hidden className="font-mono text-xs leading-none">?</span>
            </button>
          </Tooltip>
          <Tooltip content={whatsNew.hasUnread ? 'What\'s new — new release notes' : 'What\'s new'}>
            <button
              type="button"
              onClick={whatsNew.openPanel}
              aria-label={whatsNew.hasUnread ? 'Open what\'s new (unread updates)' : 'Open what\'s new'}
              className="relative inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <span aria-hidden className="font-mono text-xs leading-none">✦</span>
              {whatsNew.hasUnread && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse"
                />
              )}
            </button>
          </Tooltip>
          <Tooltip content="AI sidebar (Cmd/Ctrl+J)">
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              aria-label="Open AI sidebar"
              className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <span aria-hidden className="font-mono text-xs leading-none">✨</span>
            </button>
          </Tooltip>
          <PlanBadge />
          <ProjectSwitcher />
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto bg-surface">
          <div className="max-w-6xl mx-auto px-5 py-4">
            <QuickstartMegaCta />
            <PipelineStatusRibbon />
            <NextBestAction />
            <ScrollToHashAnchor />
            {children}
          </div>
        </main>
      </div>
      <FirstRunTour />
      <CommandPalette />
      <HotkeysModal open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
      <ActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        onUnreadChange={setActivityUnread}
      />
      <WhatsNewModal
        open={whatsNew.open}
        onClose={whatsNew.closePanel}
        entries={whatsNew.entries}
      />
      <AIAssistSidebar
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        route={pathname}
      />
    </div>
  )
}

const MODE_OPTIONS: Array<{ id: AdminMode; label: string; hint: string }> = [
  {
    id: 'quickstart',
    label: 'Quick',
    hint: 'Quickstart: 3 pages + one big "Resolve next bug" button. The fastest path from a real bug to a draft PR.',
  },
  {
    id: 'beginner',
    label: 'Beginner',
    hint: 'Beginner: 9 essential pages with guided next-best-action and plain-language copy.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    hint: 'Advanced: full 23-page console with dense layouts and jargon-rich copy.',
  },
]

function ModeToggle({ mode, onSelect }: { mode: AdminMode; onSelect: (next: AdminMode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Admin mode"
      data-tour-id="mode-toggle"
      className="mt-2 inline-flex items-center gap-0 rounded-full border border-edge bg-surface-raised/60 p-0.5"
    >
      {MODE_OPTIONS.map((opt) => {
        const active = opt.id === mode
        return (
          <Tooltip key={opt.id} content={opt.hint}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(opt.id)}
              className={`px-2 py-0.5 text-2xs font-medium rounded-full motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                active
                  ? 'bg-brand/15 text-brand shadow-sm'
                  : 'text-fg-faint hover:text-fg-secondary'
              }`}
            >
              {opt.label}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

interface SectionStaleness {
  count: number
  tone: 'ok' | 'warn' | 'danger'
  label: string
}

interface SectionHeaderProps {
  section: NavSection
  collapsed: boolean
  collapsible: boolean
  isActiveStage: boolean
  staleness: SectionStaleness | null
  onToggle: () => void
}

/**
 * Compute a single "how stale is this stage" badge for the PDCA sections.
 * Only Plan + Do have cheap aggregate counts today (reused from
 * `useNavCounts`). Check + Act return null — the section header simply
 * has no badge, which is indistinguishable from "no work pending".
 */
function computeStaleness(
  sectionId: string,
  navCounts: ReturnType<typeof useNavCounts>,
): SectionStaleness | null {
  if (!navCounts.ready) return null
  switch (sectionId) {
    case 'plan': {
      const backlog = navCounts.untriagedBacklog
      if (backlog === 0) return null
      // `toneForBacklog` returns 'ok' only when n === 0; we've already
      // returned above in that case, so the remaining tones are a subset
      // of SectionStaleness['tone'].
      const tone = toneForBacklog(backlog) as SectionStaleness['tone']
      return {
        count: backlog,
        tone,
        label: `${backlog} untriaged report${backlog === 1 ? '' : 's'} waiting`,
      }
    }
    case 'do': {
      const active = navCounts.fixesFailed + navCounts.fixesInFlight
      if (active === 0) return null
      const tone = navCounts.fixesFailed > 0 ? 'danger' : 'warn'
      return {
        count: active,
        tone,
        label: navCounts.fixesFailed > 0
          ? `${navCounts.fixesFailed} failed fix${navCounts.fixesFailed === 1 ? '' : 'es'} · ${navCounts.fixesInFlight} in flight`
          : `${navCounts.fixesInFlight} fix${navCounts.fixesInFlight === 1 ? '' : 'es'} in flight`,
      }
    }
    default:
      return null
  }
}

const STALENESS_TONE: Record<SectionStaleness['tone'], string> = {
  ok: 'bg-ok-muted text-ok',
  warn: 'bg-warn-muted text-warn',
  danger: 'bg-danger-muted text-danger',
}

function SectionHeader({ section, collapsed, collapsible, isActiveStage, staleness, onToggle }: SectionHeaderProps) {
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
      {staleness && (
        <span
          className={`inline-flex items-center justify-center min-w-[1rem] px-1 h-3.5 rounded-sm text-[0.55rem] font-mono font-bold leading-none shrink-0 ${STALENESS_TONE[staleness.tone]}`}
          aria-label={staleness.label}
          title={staleness.label}
        >
          {staleness.count > 99 ? '99+' : staleness.count}
        </span>
      )}
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
