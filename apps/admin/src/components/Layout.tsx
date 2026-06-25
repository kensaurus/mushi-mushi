/**
 * FILE: apps/admin/src/components/Layout.tsx
 * PURPOSE: App shell — sectioned sidebar with SVG icons, active indicator bar,
 *          responsive mobile drawer, skip-nav a11y link.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconMenu, IconClose,
  IconSignOut, IconHealth, IconBell, IconEye,
} from './icons'
import { useNavCounts, toneForBacklog } from '../lib/useNavCounts'
import { renderNavBadge } from '../lib/navBadges'
import { workspaceSectionAttention } from '../lib/workspaceNavMeta'
import { checkSectionAttention, actSectionAttention, doSectionAttention, startSectionAttention, planSectionAttention, workspaceSlicesAttention } from '../lib/extendedNavMeta'
import { useProjectSnapshots } from '../lib/useProjectSnapshots'
import { readJudgeStaleHours } from '../lib/judgeFreshness'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePill } from './billing/UpgradeNudge'
import { ProjectSwitcher, useActiveProjectId } from './ProjectSwitcher'
import { OrgSwitcher } from './OrgSwitcher'
import { stageForPath, type PdcaStageId } from '../lib/pdca'
import { buildOperatorNav, CHECK_SUB_GROUPS, type BuiltNavItem, type BuiltNavSection } from '../lib/buildNav'
import { CHECK_HUB_PATH } from '../lib/navRegistry'
import { useAdminMode } from '../lib/mode'
import { useSetupStatus } from '../lib/useSetupStatus'
import { Tooltip } from './ui'
import { RouteProgress } from './RouteProgress'
import { NextBestAction } from './NextBestAction'
import { DavChromeCoachmark } from './DavChromeCoachmark'
import { GlobalStatusStrip } from './GlobalStatusStrip'
import { ChromeBreadcrumb } from './ChromeBreadcrumb'
import { FirstRunTour } from './FirstRunTour'
import { CommandPalette } from './CommandPalette'
import { SearchButton } from './SearchButton'
import { HotkeysModal } from './HotkeysModal'
import { ActivityDrawer } from './ActivityDrawer'
import { SidebarBrandToggles } from './SidebarBrandToggles'
import { SidebarFooterControls } from './SidebarFooterControls'
import { SidebarUserCard } from './SidebarUserCard'
import { PrivacyPostureBadge } from './PrivacyPostureBadge'
import { WhatsNewModal, useWhatsNew } from './WhatsNew'
import { VersionBadge } from './VersionBadge'
import { AskMushiLauncherButton } from './AskMushiLauncherButton'
import { PageHero, type PageHeroDecide, type PageHeroVerify } from './PageHero'
import { useCommandPalette } from '../lib/useCommandPalette'
import { AskMushiSidebar } from './AskMushiSidebar'
import { useAskMushiPanel } from '../lib/useAskMushiPanel'
import { useHotkeys } from '../lib/useHotkeys'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { shouldShowLayoutPageHero } from '../lib/chromeLayers'
import { resolveLayoutHero } from '../lib/layoutHeroFromStats'
import { usePageHeroSnapshot } from '../lib/pageHeroSnapshot'
import { useFaviconBadge } from '../lib/favicon'
import { useFocusMode } from '../lib/focusMode'
import { useSidebarCollapsed } from '../lib/sidebarCollapsed'
import { PageHelpProvider } from '../lib/pageHelpContext'
import { RoutePageHelp } from './RoutePageHelp'
import { appChromeHeaderClass, appChromeMainClass, mobileNavBelowAppChromeClass } from '../lib/appChrome'
import { PAGE_SHELL_CLASS, pageLayoutWidthForPath } from '../lib/pageLayout'
import { AnimatedDisclosure } from './motion/AnimatedDisclosure'
import { NavSectionStagger } from './motion/NavSectionStagger'

interface NavItem extends BuiltNavItem {}

interface NavSection extends Omit<BuiltNavSection, 'id'> {
  id: BuiltNavSection['id'] | 'quick'
}

// Sidebar is reshaped around the README's PDCA loop — metadata from navRegistry.ts.
const NAV: NavSection[] = buildOperatorNav()

interface PageHeroFallback {
  title: string
  kicker: string
  scope: string
  decide: PageHeroDecide
  verify: PageHeroVerify
}

// Ownership rule: a route gets a layout fallback hero OR a page-owned
// <PageHero>, never both. Routes in pageHeroOwnership.ts must NOT appear
// here. Worklist routes in PAGE_ROUTES_SKIP_LAYOUT_HERO skip this too.
const PAGE_HERO_FALLBACKS: Record<string, PageHeroFallback> = {
  '/dashboard': {
    title: 'Dashboard',
    kicker: 'Start',
    scope: 'dashboard',
    decide: {
      label: 'Loop snapshot',
      summary: 'Status banner and KPI strip show backlog, in-flight fixes, and integration health before you pick a tab.',
      severity: 'info',
    },
    verify: {
      label: 'Refresh source',
      detail: 'Stats reload on report/fix webhooks — use Refresh if you just dispatched a fix manually.',
    },
  },
  '/repo': {
    title: 'Repo',
    kicker: 'Do',
    scope: 'repo',
    decide: {
      label: 'Branch health',
      summary: 'Review generated branches, open PRs, and CI state before landing fixes.',
      severity: 'info',
    },
    verify: {
      label: 'GitHub evidence',
      detail: 'Branch cards link back to commits, PRs, and recent repo activity.',
    },
  },
  '/prompt-lab': {
    title: 'Prompt Lab',
    kicker: 'Do',
    scope: 'prompt-lab',
    decide: {
      label: 'Prompt quality',
      summary: 'Compare active and candidate prompts before changing traffic or fine-tuning inputs.',
      severity: 'info',
    },
    verify: {
      label: 'Evaluation data',
      detail: 'Use scored runs and datasets below to confirm prompt changes improve classification.',
    },
  },
  '/code-health': {
    title: 'Code Health',
    kicker: 'Operate',
    scope: 'code-health',
    decide: {
      label: 'Bundle size + god-file LOC',
      summary: 'Bundle-size trends and per-file LOC findings pushed from CI. Flags files over the 2000-LOC budget.',
      severity: 'warn',
    },
    verify: {
      label: 'Trend chart',
      detail: 'Check the bundle trend line after a refactor to confirm sizes moved in the right direction.',
    },
  },
  '/qa-coverage': {
    title: 'QA Coverage',
    kicker: 'Check',
    scope: 'qa-coverage',
    decide: {
      label: 'Story pass rate',
      summary: 'Banner + QA SNAPSHOT — scheduled user-story tests with 24h pass rate and run evidence.',
      severity: 'info',
    },
    verify: {
      label: 'Run evidence',
      detail: 'Open a story drawer for screenshots, assertion diffs, and Browserbase replay links.',
    },
  },
  '/lessons': {
    title: 'Lessons',
    kicker: 'Check',
    scope: 'lessons',
    decide: {
      label: 'Mistake memory',
      summary: 'Banner + LESSONS SNAPSHOT — Overview for posture, Lessons for rules, Clusters to promote, Query Sim to preview injection.',
      severity: 'info',
    },
    verify: {
      label: 'Promotion proof',
      detail: 'Clusters tab shows coherence scores; Query Sim previews which rules fire on a diff.',
    },
  },
  '/drift': {
    title: 'Drift',
    kicker: 'Check',
    scope: 'drift',
    decide: {
      label: 'Contract sync',
      summary: 'Banner + DRIFT SNAPSHOT — OpenAPI vs inventory vs DB schema gaps before users hit them.',
      severity: 'info',
    },
    verify: {
      label: 'Walker evidence',
      detail: 'Snapshots tab shows edge counts; Findings drawer shows expected vs actual JSON.',
    },
  },
  '/experiments': {
    title: 'Experiments',
    kicker: 'Check',
    scope: 'experiments',
    decide: {
      label: 'Variant tests',
      summary: 'Banner + EXPERIMENTS SNAPSHOT — draft, launch, and analyze A/B tests with mSPRT significance.',
      severity: 'info',
    },
    verify: {
      label: 'Analysis proof',
      detail: 'Experiment drawer shows SRM check, p-value, and per-variant conversion rates.',
    },
  },
  '/anomalies': {
    title: 'Anomalies',
    kicker: 'Check',
    scope: 'anomalies',
    decide: {
      label: 'Metric regressions',
      summary: 'Banner + ANOMALIES SNAPSHOT — ingest timeseries, run detectors, triage release regressions.',
      severity: 'info',
    },
    verify: {
      label: 'Detection evidence',
      detail: 'Anomalies tab shows method, score vs baseline, and auto-report links.',
    },
  },
  '/releases': {
    title: 'Releases',
    kicker: 'Check',
    scope: 'releases',
    decide: {
      label: 'Changelog pipeline',
      summary: 'Banner + RELEASES SNAPSHOT — AI draft from fixed reports, credit reporters, publish attribution toasts.',
      severity: 'info',
    },
    verify: {
      label: 'Credit audit',
      detail: 'Release drawer shows fix count, contributor credits, and notified-at stamps per reporter.',
    },
  },
  '/intelligence': {
    title: 'Intelligence',
    kicker: 'Check',
    scope: 'intelligence',
    decide: {
      label: 'Weekly digest',
      summary: 'Banner + INTELLIGENCE SNAPSHOT — LLM narrative, job pipeline, modernization findings, benchmarking.',
      severity: 'info',
    },
    verify: {
      label: 'Digest proof',
      detail: 'Reports tab shows week_start, stats JSON, and exportable HTML — Pipeline shows job errors for debugging.',
    },
  },
  '/mcp': {
    title: 'MCP',
    kicker: 'Act',
    scope: 'mcp',
    decide: {
      label: 'MCP SNAPSHOT',
      summary: 'Key scopes, connection heartbeats, and endpoint match — banner shows SDK-only vs agent-ready.',
      severity: 'info',
    },
    verify: {
      label: 'Handshake check',
      detail: 'Ask your agent to list Mushi tools — connected keys show a heartbeat on Overview.',
    },
  },
  '/marketplace': {
    title: 'Marketplace',
    kicker: 'Act',
    scope: 'marketplace',
    decide: {
      label: 'MARKETPLACE SNAPSHOT',
      summary: 'Catalog, installed count, delivery success rate, and failing plugins — banner shows EMPTY vs DELIVERING.',
      severity: 'info',
    },
    verify: {
      label: 'Delivery log',
      detail: 'Every signed POST includes HTTP status, latency, and response excerpt for webhook debugging.',
    },
  },
  '/notifications': {
    title: 'Notifications',
    kicker: 'Act',
    scope: 'notifications',
    decide: {
      label: 'NOTIFICATIONS SNAPSHOT',
      summary: 'Total, unread, 24h volume, and enabled state — banner shows DISABLED vs ACTIVE vs UNREAD backlog.',
      severity: 'info',
    },
    verify: {
      label: 'Payload audit',
      detail: 'Inbox tab expands JSON payloads — unread rows may mean the reporter SDK stopped polling.',
    },
  },
  '/billing': {
    title: 'Billing',
    kicker: 'Workspace',
    scope: 'billing',
    decide: {
      label: 'Plan and usage',
      summary: 'Compare current usage against plan limits before changing seats, retention, or billing.',
      severity: 'info',
    },
    verify: {
      label: 'Stripe source',
      detail: 'Overview card shows usage + invoices inline. Manage opens Stripe portal; Upgrade starts Checkout.',
    },
  },
  '/projects': {
    title: 'Projects',
    kicker: 'Workspace',
    scope: 'projects',
    decide: {
      label: 'PROJECTS SNAPSHOT',
      summary: 'Project count, ingest coverage, SDK heartbeats, and active keys — banner shows EMPTY vs INGESTING.',
      severity: 'info',
    },
    verify: {
      label: 'Active context',
      detail: 'The selected project drives filters and setup state across the console — switch on Your projects tab.',
    },
  },
  '/organization/members': {
    title: 'Members',
    kicker: 'Workspace',
    scope: 'members',
    decide: {
      label: 'Team roster',
      summary: 'Audit who has access, which seats are inactive, and whether pending invites need a resend.',
      severity: 'info',
    },
    verify: {
      label: 'Invite deliverability',
      detail: 'Pending invites show opened / not-opened and expiry — resend or copy the accept link if email failed.',
    },
  },
  '/settings': {
    title: 'Settings',
    kicker: 'Workspace',
    scope: 'settings',
    decide: {
      label: 'Runtime controls',
      summary: 'Tune capture, routing, LLM, and developer settings that affect future reports.',
      severity: 'info',
    },
    verify: {
      label: 'Saved state',
      detail: 'Health tab runs a test report against the active project — BYOK Test buttons confirm keys before save.',
    },
  },
  '/rewards': {
    title: 'Rewards',
    kicker: 'Act',
    scope: 'rewards',
    decide: {
      label: 'REWARDS SNAPSHOT',
      summary: 'Contributors, rejection rate, webhooks, and payouts — banner shows what blocks the loop.',
      severity: 'info',
    },
    verify: {
      label: 'SDK activity feed',
      detail: 'Overview shows 24h accept/reject breakdown — Simulator previews rule changes without live data.',
    },
  },
  '/cost': {
    title: 'LLM Cost',
    kicker: 'Workspace',
    scope: 'cost',
    decide: {
      label: 'Spend discipline',
      summary: 'Check 24h spend, top operations, and BYOK vs platform keys before tuning pipelines.',
      severity: 'info',
    },
    verify: {
      label: 'Invocation log',
      detail: 'Raw log lists every llm_invocations row — search by operation or model to audit individual calls.',
    },
  },
  '/sso': {
    title: 'SSO',
    kicker: 'Workspace',
    scope: 'sso',
    decide: {
      label: 'Identity setup',
      summary: 'Configure team sign-in through SAML or OIDC before inviting more users.',
      severity: 'info',
    },
    verify: {
      label: 'Provider metadata',
      detail: 'Overview shows ACS URL — paste into Okta/Azure AD, then verify login on Providers tab.',
    },
  },
  '/research': {
    title: 'Research',
    kicker: 'Check',
    scope: 'research',
    decide: {
      label: 'Firecrawl search',
      summary: 'Banner + RESEARCH SNAPSHOT — BYOK web search during triage, attach snippets as report evidence.',
      severity: 'info',
    },
    verify: {
      label: 'Session history',
      detail: 'History tab lists past queries; attached snippets link back to report UUIDs for audit.',
    },
  },
  '/iterate': {
    title: 'Iterate',
    kicker: 'Act',
    scope: 'iterate',
    decide: {
      label: 'PDCA SNAPSHOT',
      summary: 'Overview shows queued/running/failed posture — Runs tab needs Trigger on each queued row.',
      severity: 'info',
    },
    verify: {
      label: 'Run detail',
      detail: 'Open a run for the score timeline, per-iteration critique, and clipboard export.',
    },
  },
  '/skills': {
    title: 'Skill Pipelines',
    kicker: 'Act',
    scope: 'skills',
    decide: {
      label: 'Pipeline status',
      summary: 'Attach a cursor-kenji skill to a report, run it as a pipeline, and track each step live.',
      severity: 'info',
    },
    verify: {
      label: 'Step check-in',
      detail: 'Dev checks in each step via CLI or MCP. Console React Flow updates in realtime.',
    },
  },
}


const SECTION_TO_STAGE: Record<string, PdcaStageId> = {
  plan: 'plan',
  do: 'do',
  check: 'check',
  act: 'act',
}

const STAGE_TONE: Record<NonNullable<NavSection['stage']>, string> = {
  P: 'bg-info/15 text-info border border-info/35',
  D: 'bg-brand/15 text-brand border border-brand/35',
  C: 'bg-warn-muted/50 text-warning-foreground border border-warn/35',
  A: 'bg-ok/15 text-ok border border-ok/35',
}

function isActive(currentPath: string, itemPath: string) {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/')
}

function sectionContainingPath(sections: NavSection[], path: string): NavSection | undefined {
  return sections.find((s) => s.items.some((i) => isActive(path, i.path)))
}

/** Single-letter / stage glyph for the icon-rail section picker. */
function railSectionGlyph(section: NavSection): string {
  if (section.stage) return section.stage
  if (section.id === 'quick') return 'Q'
  if (section.id === 'start') return 'S'
  if (section.id === 'workspace') return 'W'
  return section.title.charAt(0).toUpperCase()
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
  /** Which sidebar category is expanded — single accordion in rail + full sidebar. */
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null)
  const { mode, setMode, isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  const palette = useCommandPalette()
  const askPanel = useAskMushiPanel()
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityUnread, setActivityUnread] = useState(0)
  const whatsNew = useWhatsNew()
  const navCounts = useNavCounts()
  const pageHeroSnapshot = usePageHeroSnapshot()
  const projectSnapshots = useProjectSnapshots()
  const activeProjectId = useActiveProjectId()
  const setupStatus = useSetupStatus(activeProjectId)
  const activeProjectSnapshot = activeProjectId
    ? projectSnapshots.byId.get(activeProjectId)
    : undefined
  const criticalReports30d = activeProjectSnapshot?.severity_breakdown_30d?.critical ?? 0
  const { isSuperAdmin, has } = useEntitlements()
  const fallbackHero = shouldShowLayoutPageHero(pathname)
    ? PAGE_HERO_FALLBACKS[pathname]
    : null
  const resolvedHero = useMemo(
    () => resolveLayoutHero(pathname, fallbackHero, navCounts, pageHeroSnapshot),
    [pathname, fallbackHero, navCounts, pageHeroSnapshot],
  )
  const pageShellWidth = pageLayoutWidthForPath(pathname)
  const [focusMode, setFocusMode] = useFocusMode()
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed()

  // UIUX-2 (2026-04-23): keep the browser tab title + favicon in sync
  // with the page the user is on. Both hooks read from `pageContext` so
  // pages that publish live counts (e.g. "Reports · 12 new · 3 critical")
  // get a matching tab title and a red favicon dot when criticals > 0.
  useDocumentTitle()
  useFaviconBadge()

  useEffect(() => {
    document.documentElement.setAttribute('data-portal', 'admin')
    return () => {
      document.documentElement.removeAttribute('data-portal')
    }
  }, [])

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
        description: 'Toggle Ask Mushi (scoped to current page)',
        handler: (e) => {
          e.preventDefault()
          askPanel.toggle()
        },
        meta: true,
      },
      {
        key: 'j',
        description: 'Toggle Ask Mushi (scoped to current page)',
        handler: (e) => {
          e.preventDefault()
          askPanel.toggle()
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
      {
        key: '.',
        description: 'Toggle focus mode',
        handler: (e) => {
          e.preventDefault()
          setFocusMode((value) => !value)
        },
        meta: true,
        allowInInputs: true,
      },
      {
        key: '.',
        description: 'Toggle focus mode',
        handler: (e) => {
          e.preventDefault()
          setFocusMode((value) => !value)
        },
        ctrl: true,
        allowInInputs: true,
      },
      // ESC exits focus mode — escape hatch for users who entered focus
      // mode and now can't find the toggle (the in-sidebar button is
      // hidden in that mode by design). Without this + the floating exit
      // pill rendered below, the only way out was clearing localStorage.
      // Skipped when focus mode is OFF so we don't steal Escape from
      // modals / drawers / inputs that legitimately want it.
      {
        key: 'Escape',
        description: 'Exit focus mode',
        handler: (e) => {
          if (!focusMode) return
          e.preventDefault()
          setFocusMode(false)
        },
      },
      // `[` toggles the desktop sidebar between full (224px) and an
      // icon-only rail (48px). Mirrors Linear's collapsible-sidebar
      // hotkey so muscle memory transfers from there. Mobile is a
      // separate overlay (`mobileOpen`) and isn't touched.
      {
        key: '[',
        description: 'Toggle sidebar (collapse to icon rail)',
        handler: (e) => {
          e.preventDefault()
          setSidebarCollapsed((value) => !value)
        },
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
  // Always strip operator-only routes for non-super-admins, regardless
  // of mode. The gateway also enforces this — UI hiding is purely so
  // we don't tease a feature non-operators can't access.
  const visibleByRole = (i: NavItem) => !i.superAdmin || isSuperAdmin
  // Nudge-not-hide: feature-gated items used to be filtered out for
  // unentitled users. That hid the upsell (the user couldn't *see* what
  // their plan was missing). Now we surface the item alongside an
  // `UpgradePill` so the click goes to the feature page (which renders
  // its own UpgradePrompt) and the plan signal is visible right in the
  // sidebar. We still hide them in beginner/quickstart modes — those
  // flows already trim the surface aggressively, and a Pro pill in
  // quickstart would be more confusing than helpful.
  const visibleByFeature = (i: NavItem) =>
    (!i.requiresFeature || has(i.requiresFeature) || isSuperAdmin) &&
    (!i.requiresAdvancedMode || isAdvanced || isSuperAdmin)

  const visibleNav = useMemo((): NavSection[] => {
    if (isQuickstart) {
      const activationDone = setupStatus.selectors.done
      const allowedPaths = new Set([
        '/onboarding',
        '/connect',
        '/inbox',
        '/feedback',
        '/reports',
        '/fixes',
        '/mcp',
      ])
      const quickItems: NavItem[] = NAV.flatMap((s) =>
        s.items
          .filter(visibleByRole)
          .filter(visibleByFeature)
          .filter(i => i.quickstartLabel !== undefined)
          .filter(i => activationDone || allowedPaths.has(i.path))
          .map(i => ({ ...i, label: i.quickstartLabel ?? i.label })),
      )
      return [
        {
          id: 'quick',
          title: 'Quickstart',
          hint: 'Bugs, fixes, skill catalog, and setup. Switch to Beginner or Advanced for the full PDCA sidebar.',
          items: quickItems,
        },
      ]
    }
    if (isBeginner) {
      // Beginner mode keeps Start expanded by default — first-run users
      // need the Dashboard / Get started pair in view, not hidden behind
      // a chevron like in advanced mode.
      return NAV
        .map(s => ({
          ...s,
          defaultCollapsed: s.id === 'start' ? false : s.defaultCollapsed,
          items: s.items
            .filter(visibleByRole)
            .filter(visibleByFeature)
            .filter(i => {
              if (s.id === 'check') return i.checkBeginnerCore === true
              if (s.id === 'plan') return i.beginner === true && !i.requiresAdvancedMode
              return i.beginner === true
            }),
        }))
        .filter(s => s.items.length > 0)
    }
    // Advanced mode: render every item including gated ones, so the
    // sidebar's upsell pill replaces the "hidden until you pay" UX.
    return NAV.map(s => ({
      ...s,
      items: s.items.filter(visibleByRole),
    }))
  }, [
    isQuickstart,
    isBeginner,
    isAdvanced,
    isSuperAdmin,
    has,
    setupStatus.selectors.done,
  ])

  // Keep the open category aligned with the current route when navigating.
  useEffect(() => {
    const containing = sectionContainingPath(visibleNav, pathname)
    if (containing) setExpandedSectionId(containing.id)
  }, [pathname, visibleNav])

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

  function selectSection(id: string, options?: { expandSidebar?: boolean }) {
    setExpandedSectionId(id)
    if (options?.expandSidebar) {
      setSidebarCollapsed(false)
      requestAnimationFrame(() => {
        document.getElementById(`nav-section-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
  }

  function selectRailSection(id: string) {
    selectSection(id, { expandSidebar: true })
  }

  const CHECK_SUB_GROUP_ORDER = ['quality-gates', 'system-health', 'release-intel'] as const

  function renderNavLink(item: NavItem, compact: boolean) {
    const { label, path, icon: Icon, requiresFeature } = item
    const active = isActive(pathname, path)
    const gated = !!requiresFeature && !has(requiresFeature) && !isSuperAdmin
    return (
      <Link
        key={path}
        to={path}
        onClick={() => setMobileOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={`nav-link ${compact ? 'justify-center px-2 py-2' : ''} ${gated ? 'opacity-80' : ''}`}
        title={compact ? label : undefined}
        aria-label={compact ? label : undefined}
      >
        <Icon className="nav-link-icon" />
        {!compact && <span>{label}</span>}
        {!compact && gated && requiresFeature && (
          <UpgradePill flag={requiresFeature} className="ml-auto" />
        )}
        {renderNavBadge(path, navCounts, { criticalReports30d })}
      </Link>
    )
  }

  // `compact` collapses the sidebar to an icon rail (~48px wide) — same
  // content tree, but section headers, item labels, mode toggle, and most
  // footer chrome are hidden in favour of `title` tooltips. Mobile always
  // gets `compact: false` because the mobile sidebar is a full overlay.
  const renderSidebarContent = (compact: boolean) => (
    <>
      {/* Brand — collapses to a single "M" stamp in compact mode so the
          rail still has a recognisable identity at the top. */}
      <div className={`${compact ? 'px-2 py-3' : 'px-4 py-3'} border-b border-edge/60 overflow-visible`}>
        {compact ? (
          <div className="space-y-1.5">
            <h1 className="text-sm font-bold tracking-tight leading-none text-center" aria-label="mushi mushi admin console">
              <span className="text-brand">m</span>
              <span className="text-fg-secondary">m</span>
            </h1>
            <SidebarBrandToggles compact mode={mode} onSelectMode={setMode} />
          </div>
        ) : (
          <>
            <h1 className="text-sm font-bold tracking-tight leading-none">
              <span className="text-brand">mushi</span>
              <span className="text-fg-secondary">mushi</span>
            </h1>
            <SidebarBrandToggles mode={mode} onSelectMode={setMode} />
            {onHiddenRoute && (
              <div className="mt-2 rounded-sm border border-chrome-border bg-chrome px-2 py-1.5 text-3xs text-fg-muted space-y-1.5">
                <p className="leading-snug">{hiddenRouteCopy}</p>
                <button
                  type="button"
                  onClick={() => setMode(isQuickstart ? 'beginner' : 'advanced')}
                  className="underline hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm"
                >
                  Switch to {isQuickstart ? 'Beginner' : 'Advanced'} mode →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation — ghost scrollbar at rest; thin bar on hover/focus only. */}
      <div className="sidebar-rail-nav-wrap relative flex min-h-0 flex-1 flex-col">
      <nav aria-label="Main navigation" className={`min-h-0 flex-1 overflow-y-auto py-2 ${compact ? 'px-1' : 'px-2'}`}>
        {visibleNav.map((section, sectionIdx) => {
          const stageId = SECTION_TO_STAGE[section.id]
          const isActiveStage = stageId !== undefined && stageId === activeStage
          const isExpanded = expandedSectionId === section.id
          // Per-stage staleness — surfaced on the collapsed section header
          // so advanced users can still see at a glance which PDCA stage
          // needs their attention without expanding.
          const staleness = computeStaleness(section.id, navCounts)
          return (
            <div
              key={section.id}
              id={`nav-section-${section.id}`}
              className={compact ? 'first:mt-0 mt-1 first:pt-0 pt-1 first:border-t-0 border-t border-edge-subtle/60' : sectionIdx > 0 ? 'border-t border-edge/20 pt-1.5 mt-0.5' : ''}
            >
              {compact ? (
                <SectionRailHeader
                  section={section}
                  expanded={isExpanded}
                  isActiveStage={isActiveStage}
                  staleness={staleness}
                  onSelect={() => selectRailSection(section.id)}
                />
              ) : (
                <SectionHeader
                  section={section}
                  isExpanded={isExpanded}
                  isActiveStage={isActiveStage}
                  staleness={staleness}
                  onToggle={() => selectSection(section.id)}
                />
              )}
              <AnimatedDisclosure open={isExpanded} contentKey={section.id}>
                <NavSectionStagger
                  animate={!compact}
                  className={compact ? 'space-y-0.5 flex flex-col items-stretch' : 'space-y-0.5'}
                >
                  {section.id === 'check' && isAdvanced && !compact
                    ? CHECK_SUB_GROUP_ORDER.map((subId) => {
                        const subItems = section.items.filter((i) => i.checkSubGroup === subId)
                        if (subItems.length === 0) return null
                        const sub = CHECK_SUB_GROUPS[subId]
                        return (
                          <div key={subId} className="space-y-0.5">
                            <p
                              className="px-2 pt-1.5 pb-0.5 text-3xs font-medium uppercase tracking-wide text-fg-faint"
                              title={sub.hint}
                            >
                              {sub.title}
                            </p>
                            {subItems.map((item) => renderNavLink(item, compact))}
                          </div>
                        )
                      })
                    : section.items.map((item) => renderNavLink(item, compact))}
                  {section.id === 'check' && isBeginner && !compact ? (
                    <Link
                      to={CHECK_HUB_PATH}
                      onClick={() => setMobileOpen(false)}
                      className="nav-link text-fg-muted hover:text-fg-secondary"
                    >
                      <IconHealth className="nav-link-icon opacity-70" />
                      <span>More verification tools →</span>
                    </Link>
                  ) : null}
                </NavSectionStagger>
              </AnimatedDisclosure>
            </div>
          )
        })}
      </nav>
      </div>

      {/* User footer — density, theme, focus in one micro row; identity card below. */}
      <div className={`${compact ? 'px-1 py-2 space-y-2' : 'px-3 py-2.5 space-y-2'} border-t border-edge/60`}>
        <PrivacyPostureBadge compact={compact} />
        {!compact && (
          <SidebarFooterControls
            focusMode={focusMode}
            onToggleFocus={() => setFocusMode((value) => !value)}
          />
        )}
        {compact && (
          <button
            type="button"
            onClick={() => setFocusMode((value) => !value)}
            className="nav-link justify-center px-2 py-2"
            aria-pressed={focusMode}
            title={focusMode ? 'Exit focus mode' : 'Focus mode'}
            aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}
          >
            <IconEye className="nav-link-icon" />
          </button>
        )}
        {!compact && <SidebarUserCard user={user} signOut={signOut} />}
        {compact && (
          <button
            onClick={signOut}
            className="nav-link justify-center px-2 py-2 text-rose hover:text-rose hover:bg-rose-muted/40"
            title={`Sign out (${user?.email ?? ''})`}
            aria-label="Sign out"
          >
            <IconSignOut className="nav-link-icon" />
          </button>
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <RouteProgress />
      {/* Skip nav — a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-brand focus:text-brand-fg focus:px-3 focus:py-1.5 focus:rounded-sm focus:text-xs focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — `sidebarCollapsed` toggles between a 240px nav
          (w-60) and a 48px icon rail (w-12). Toggle button is rendered
          INSIDE the sidebar (sticky bottom) so it survives both states.
          Hidden entirely in focus mode; the floating exit pill below
          replaces all sidebar affordances when focus mode is on. */}
      {!focusMode && (
        <aside
          className={`hidden md:flex flex-shrink-0 min-h-0 border-r border-edge/60 bg-surface-root flex-col motion-safe:transition-[width] motion-safe:duration-base ${sidebarCollapsed ? 'w-12' : 'w-60'}`}
          data-collapsed={sidebarCollapsed ? 'true' : 'false'}
        >
          {renderSidebarContent(sidebarCollapsed)}
          {/* Collapse toggle — pinned to the bottom of the rail so the
              affordance is always findable in either state. Renders as a
              chevron button with `[` hint when expanded; just a chevron
              in compact mode. The `[` hotkey mirrors Linear's. */}
          {/* Collapse toggle — chevron-only at the bottom of the rail.
              Earlier revision included a `[` kbd hint inline; pulled
              into the title tooltip instead so the chrome stays calm
              (Linear refresh: "structure should be felt, not seen") —
              power users who want the hotkey hover for it; everyone
              else just sees a quiet chevron. */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-pressed={sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar  ·  [' : 'Collapse to icon rail  ·  ['}
            className={`group flex items-center gap-2 border-t border-edge/60 px-3 py-1.5 text-2xs text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}
          >
            <span aria-hidden className="font-mono leading-none text-base">
              {sidebarCollapsed ? '›' : '‹'}
            </span>
            {!sidebarCollapsed && (
              <span className="font-mono text-3xs uppercase tracking-wider text-fg-faint">
                Collapse
              </span>
            )}
          </button>
        </aside>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className={mobileNavBelowAppChromeClass}>
          <div
            className="absolute inset-0 bg-overlay backdrop-blur-sm motion-safe:animate-mushi-drawer-backdrop-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-60 h-full bg-surface-root border-r border-edge/60 flex flex-col shadow-raised motion-safe:animate-mushi-drawer-in">
            <div className="absolute top-2.5 right-2.5">
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
              >
                <IconClose size={14} />
              </button>
            </div>
            {renderSidebarContent(false)}
          </aside>
        </div>
      )}

      {/* Focus-mode exit pill — floating top-right escape hatch so users
          who entered focus mode can find their way back out. Critical
          because the in-sidebar "Exit focus mode" button is itself hidden
          in this state (the sidebar is hidden by `!focusMode &&` above).
          ESC also exits via the hotkey wired in useHotkeys. Render outside
          the sidebar so it's not affected by either focus-mode or
          sidebar-collapse state. */}
      {focusMode && (
        <div className="fixed top-3 right-3 z-50 flex items-center gap-2 rounded-sm border border-edge bg-surface-raised px-2 py-1.5 shadow-raised">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
          <span className="text-2xs text-fg-secondary font-medium">Focus mode</span>
          <button
            type="button"
            onClick={() => setFocusMode(false)}
            className="text-2xs text-fg-muted hover:text-fg motion-safe:transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label="Exit focus mode"
            title="Exit focus mode (Esc or Cmd/Ctrl+.)"
          >
            Exit <kbd className="ml-1 px-1 py-0.5 rounded-xs border border-edge-subtle text-fg-faint font-mono">Esc</kbd>
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className={`md:hidden flex items-center gap-2 px-4 py-2.5 border-b border-edge/60 ${appChromeHeaderClass}`}>
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <IconMenu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <SearchButton />
          </div>
          <span className="shrink-0 text-sm font-bold tracking-tight">
            <span className="text-brand">mushi</span>
            <span className="text-fg-secondary">mushi</span>
          </span>
          <div className="shrink-0 flex items-center gap-2">
            <OrgSwitcher />
            <ProjectSwitcher />
          </div>
        </header>

        {/* Desktop sub-header — search left; controls + switchers right */}
        {!focusMode && <header className={`hidden md:flex items-center gap-3 px-5 py-1.5 border-b border-edge/40 ${appChromeHeaderClass}`}>
          <ChromeBreadcrumb />
          <div className="min-w-0 shrink-0">
            <SearchButton />
          </div>
          <div className="ml-auto flex items-center gap-2 min-w-0 overflow-visible">
            <div
              className="flex items-center gap-0.5 rounded-md border border-edge/50 bg-surface-raised/35 p-0.5 overflow-visible shrink-0"
              aria-label="Toolbar"
            >
              <Tooltip content={activityUnread > 0 ? `Live activity — ${activityUnread} new` : 'Live activity'} side="bottom">
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
                      className="absolute -right-0.5 -top-0.5 inline-flex min-w-[0.9rem] h-[0.9rem] items-center justify-center px-1 rounded-full bg-brand text-brand-fg text-3xs font-semibold leading-none motion-safe:animate-pulse"
                    >
                      {activityUnread > 9 ? '9+' : activityUnread}
                    </span>
                  )}
                </button>
              </Tooltip>
              <Tooltip content="Keyboard shortcuts (press ?)" side="bottom">
                <button
                  type="button"
                  onClick={() => setHotkeysOpen(true)}
                  aria-label="Open keyboard shortcuts"
                  className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <span aria-hidden className="font-mono text-xs leading-none">?</span>
                </button>
              </Tooltip>
              <AskMushiLauncherButton
                panelOpen={askPanel.isOpen}
                onClick={() => askPanel.open()}
              />
            </div>
            <VersionBadge whatsNew={whatsNew} />
            <span className="h-5 w-px shrink-0 bg-edge-subtle" aria-hidden />
            <OrgSwitcher />
            <ProjectSwitcher />
          </div>
        </header>}

        <PageHelpProvider>
          <main id="main-content" className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-surface ${appChromeMainClass}`}>
            <div
              className={`${PAGE_SHELL_CLASS[pageShellWidth]} motion-safe:transition-[max-width,padding] motion-safe:duration-base`}
              data-page-width={pageShellWidth}
            >
              {!focusMode && <GlobalStatusStrip />}
              {!focusMode && <DavChromeCoachmark />}
              {!focusMode && <NextBestAction />}
              <ScrollToHashAnchor />
              {!focusMode && <RoutePageHelp />}
              {/* Beginner mode uses NextBestAction — skip layout PageHero to avoid
                  duplicating the same guidance (NN/g #8 Aesthetic & Minimalist). */}
              {resolvedHero && !isBeginner && (
                <PageHero
                  scope={resolvedHero.scope}
                  title={resolvedHero.title}
                  kicker={resolvedHero.kicker}
                  decide={resolvedHero.decide}
                  act={resolvedHero.act}
                  actIdle={resolvedHero.actIdle}
                  verify={resolvedHero.verify}
                />
              )}
              {children}
            </div>
          </main>
        </PageHelpProvider>
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
      <AskMushiSidebar
        open={askPanel.isOpen}
        onClose={() => askPanel.close()}
        route={pathname}
        seedMessage={askPanel.seed}
        seedThreadId={askPanel.threadId}
      />
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
  isExpanded: boolean
  isActiveStage: boolean
  staleness: SectionStaleness | null
  onToggle: () => void
}

/**
 * Compute a single "how stale is this stage" badge for the PDCA sections.
 * Plan + Do use `useNavCounts` backlog/fix counters. Check adds judge
 * disagreements + judge-batch staleness; Act surfaces integration health.
 */
function computeStaleness(
  sectionId: string,
  navCounts: ReturnType<typeof useNavCounts>,
): SectionStaleness | null {
  if (!navCounts.ready) return null
  switch (sectionId) {
    case 'start': {
      const extended = startSectionAttention(navCounts.slices)
      if (!extended) return null
      return {
        count: extended.count,
        tone: extended.tone,
        label: extended.label,
      }
    }
    case 'plan': {
      const backlog = navCounts.untriagedBacklog
      const reg = navCounts.regressedActions
      const contentAttention = planSectionAttention(navCounts.slices)
      if (backlog === 0 && reg === 0 && !contentAttention) return null
      if (reg > 0) {
        return {
          count: reg + (contentAttention?.count ?? 0),
          tone: 'danger',
          label: contentAttention
            ? `${reg} regressed inventory actions · ${contentAttention.label}`
            : `${reg} regressed inventory action${reg === 1 ? '' : 's'} — check User stories`,
        }
      }
      if (backlog > 0 && contentAttention) {
        const tone = toneForBacklog(backlog) as SectionStaleness['tone']
        return {
          count: backlog + contentAttention.count,
          tone: contentAttention.tone === 'danger' ? 'danger' : tone,
          label: `${backlog} untriaged report${backlog === 1 ? '' : 's'} · ${contentAttention.label}`,
        }
      }
      if (contentAttention) {
        return {
          count: contentAttention.count,
          tone: contentAttention.tone,
          label: contentAttention.label,
        }
      }
      const tone = toneForBacklog(backlog) as SectionStaleness['tone']
      return {
        count: backlog,
        tone,
        label: `${backlog} untriaged report${backlog === 1 ? '' : 's'} waiting`,
      }
    }
    case 'do': {
      const active = navCounts.fixesFailed + navCounts.fixesInFlight
      const extended = doSectionAttention(navCounts.slices)
      if (active === 0 && !extended) return null
      const count = active + (extended?.count ?? 0)
      const tone =
        navCounts.fixesFailed > 0 || extended?.tone === 'danger' ? 'danger' : 'warn'
      const parts: string[] = []
      if (navCounts.fixesFailed > 0) {
        parts.push(`${navCounts.fixesFailed} failed fix${navCounts.fixesFailed === 1 ? '' : 'es'}`)
      } else if (navCounts.fixesInFlight > 0) {
        parts.push(`${navCounts.fixesInFlight} fix${navCounts.fixesInFlight === 1 ? '' : 'es'} in flight`)
      }
      if (extended) parts.push(extended.label)
      return {
        count,
        tone,
        label: parts.join(' · '),
      }
    }
    case 'check': {
      const disagreements = navCounts.judgeDisagreements
      const staleHours = readJudgeStaleHours()
      const extended = checkSectionAttention(navCounts.slices)
      if (disagreements > 0) {
        return {
          count: disagreements + (extended?.count ?? 0),
          tone: disagreements > 3 ? 'danger' : 'warn',
          label: extended
            ? `${disagreements} judge disagreements · ${extended.label}`
            : `${disagreements} judge ${disagreements === 1 ? 'disagreement' : 'disagreements'} with classifier`,
        }
      }
      if (extended) {
        return {
          count: extended.count,
          tone: extended.tone,
          label: extended.label,
        }
      }
      if (staleHours != null && staleHours > 48) {
        return {
          count: 0,
          tone: 'warn',
          label: 'Judge batch overdue — open Health to refresh',
        }
      }
      return null
    }
    case 'act': {
      const issues = navCounts.healthIssues
      const extended = actSectionAttention(navCounts.slices)
      if (issues === 0 && !extended) return null
      const count = issues + (extended?.count ?? 0)
      const tone =
        issues > 2 || extended?.tone === 'danger'
          ? 'danger'
          : 'warn'
      const parts: string[] = []
      if (issues > 0) parts.push(`${issues} integration${issues === 1 ? '' : 's'}`)
      if (extended) parts.push(extended.label)
      return {
        count,
        tone,
        label: parts.join(' · '),
      }
    }
    case 'workspace': {
      const attention = workspaceSectionAttention({
        projectsNeedingAttention: navCounts.projectsNeedingAttention,
        pendingInvites: navCounts.pendingInvites,
      })
      const billing = navCounts.slices.billing
      const billingAttention =
        (billing?.pastDueProjects ?? 0) +
        (billing?.unpaidProjects ?? 0) +
        (billing?.overQuota ? 1 : 0) +
        (billing?.approachingQuota ? 1 : 0)
      const rewards = navCounts.slices.rewards
      const rewardsAttention =
        (rewards?.openDisputesCount ?? 0) + (rewards?.webhooksFailing ?? 0)
      const sliceAttention = workspaceSlicesAttention(navCounts.slices)
      const total =
        (attention?.count ?? 0) +
        billingAttention +
        rewardsAttention +
        (sliceAttention?.count ?? 0)
      if (total === 0) return null
      const parts: string[] = []
      if (attention) parts.push(attention.label)
      if (billingAttention > 0) parts.push('billing')
      if (rewardsAttention > 0) parts.push('rewards')
      if (sliceAttention) parts.push(sliceAttention.label)
      return {
        count: total,
        tone:
          billing?.pastDueProjects ||
          billing?.overQuota ||
          rewards?.openDisputesCount ||
          sliceAttention?.tone === 'danger'
            ? 'danger'
            : attention?.tone ?? sliceAttention?.tone ?? 'warn',
        label: parts.join(' · '),
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

interface SectionRailHeaderProps {
  section: NavSection
  expanded: boolean
  isActiveStage: boolean
  staleness: SectionStaleness | null
  onSelect: () => void
}

function SectionRailHeader({ section, expanded, isActiveStage, staleness, onSelect }: SectionRailHeaderProps) {
  const glyph = railSectionGlyph(section)
  const stageTone = section.stage ? STAGE_TONE[section.stage] : 'bg-surface-overlay text-fg-secondary border border-edge-subtle'
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={expanded}
      aria-current={expanded ? 'true' : undefined}
      aria-label={`${section.title}${expanded ? '' : ' — show navigation'}`}
      title={section.hint ?? section.title}
      className={`relative nav-link justify-center px-2 py-1.5 mb-0.5 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm ${
        expanded
          ? 'bg-surface-overlay text-fg ring-1 ring-brand/40'
          : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-overlay/60'
      } ${isActiveStage && !expanded ? 'ring-1 ring-brand/25' : ''}`}
    >
      <span
        className={`inline-flex items-center justify-center w-6 h-6 rounded-sm text-3xs font-bold leading-none ${stageTone}`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      {staleness && (
        <span
          className={`absolute top-0.5 right-0.5 inline-flex items-center justify-center min-w-[0.85rem] px-0.5 h-3.5 rounded-sm text-3xs font-mono font-bold leading-none ${STALENESS_TONE[staleness.tone]}`}
          aria-label={staleness.label}
          title={staleness.label}
        >
          {staleness.count > 99 ? '99+' : staleness.count}
        </span>
      )}
    </button>
  )
}

function SectionHeader({ section, isExpanded, isActiveStage, staleness, onToggle }: SectionHeaderProps) {
  const showChevron = section.defaultCollapsed !== undefined || section.id === 'workspace'
  const inner = (
    <span className="flex items-center gap-1.5 min-w-0 w-full">
      {section.stage && (
        <span
          className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-3xs font-bold leading-none shrink-0 ${STAGE_TONE[section.stage]}`}
          aria-hidden="true"
        >
          {section.stage}
        </span>
      )}
      <span className="truncate flex-1 text-left">{section.title}</span>
      {staleness && (
        <span
          className={`inline-flex items-center justify-center min-w-[1rem] px-1 h-3.5 rounded-sm text-3xs font-mono font-bold leading-none shrink-0 ${STALENESS_TONE[staleness.tone]}`}
          aria-label={staleness.label}
          title={staleness.label}
        >
          {staleness.count > 99 ? '99+' : staleness.count}
        </span>
      )}
      {showChevron && (
        <svg
          className={`h-2.5 w-2.5 text-fg-faint shrink-0 motion-safe:transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`nav-section flex items-center gap-1.5 w-full hover:text-fg-secondary motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm ${
        isExpanded
          ? 'nav-section-expanded bg-surface-overlay/60 ring-1 ring-brand/30'
          : isActiveStage
            ? 'nav-section-stage-hint'
            : ''
      }`}
      title={section.hint}
      aria-expanded={isExpanded}
      aria-current={isExpanded ? 'true' : undefined}
    >
      {inner}
    </button>
  )
}
