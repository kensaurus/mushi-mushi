/**
 * FILE: apps/admin/src/components/Layout.tsx
 * PURPOSE: App shell — sectioned sidebar with SVG icons, active indicator bar,
 *          responsive mobile drawer, skip-nav a11y link.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconMenu, IconClose,
  IconSignOut, IconBell, IconEye, IconChevronRight,
} from './icons'
import { useNavCounts, toneForBacklog } from '../lib/useNavCounts'
import { navSlicesForPaths, renderNavBadge, resolveNavBadge } from '../lib/navBadges'
import { NavRailFlyout } from './sidebar/NavRailFlyout'
import { NavRailLink, railBadgeText, railDescriptionId } from './sidebar/NavRailLink'
import { workspaceSectionAttention } from '../lib/workspaceNavMeta'
import { checkSectionAttention, actSectionAttention, doSectionAttention, planSectionAttention, startSectionAttention, workspaceSlicesAttention } from '../lib/extendedNavMeta'
import { useProjectSnapshots } from '../lib/useProjectSnapshots'
import { readJudgeStaleHours } from '../lib/judgeFreshness'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePill } from './billing/UpgradeNudge'
import { ProjectSwitcher, useActiveProjectId } from './ProjectSwitcher'
import { ProjectScopeNotice } from './ProjectScopeNotice'
import { OrgSwitcher } from './OrgSwitcher'
import { useMediaQuery } from '../lib/useMediaQuery'
import { stageForPath, type PdcaStageId } from '../lib/pdca'
import { NAV_ITEM_BY_PATH, buildOperatorNav, type BuiltNavItem, type BuiltNavSection } from '../lib/buildNav'
import { CORE_NAV_PATHS } from '../lib/navRegistry'
import { LAB_FEATURES, useLabs } from '../lib/labs'
import { NAV_CHILDREN, activeParent, isNavPathActive, morePages } from '../lib/sidebarTree'
import { Tooltip, Btn } from './ui'
import { RouteProgress } from './RouteProgress'
import { PAGE_FOOT_SLOT_ID } from './readout/ReadoutPanel'
import { ChromeBreadcrumb } from './ChromeBreadcrumb'
import { FirstRunTour } from './FirstRunTour'
import { CommandPalette } from './CommandPalette'
import { SearchButton } from './SearchButton'
import { HotkeysModal } from './HotkeysModal'
import { ActivityDrawer } from './ActivityDrawer'
import { DisplayPreferences } from './DisplayPreferences'
import { SidebarUserCard, SignOutAllDialog } from './SidebarUserCard'
import { PrivacyPostureBadge } from './PrivacyPostureBadge'
import { DemoProjectHint } from './DemoProjectHint'
import { useSetupStatus } from '../lib/useSetupStatus'
import { WhatsNewModal, useWhatsNew } from './WhatsNew'
import { VersionBadge } from './VersionBadge'
import { AskMushiLauncherButton } from './AskMushiLauncherButton'
import { useCommandPalette } from '../lib/useCommandPalette'
import { AskMushiSidebar } from './AskMushiSidebar'
import { useAskMushiPanel } from '../lib/useAskMushiPanel'
import { useHotkeys } from '../lib/useHotkeys'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useFaviconBadge } from '../lib/favicon'
import { isConsentFocusPath, useFocusMode } from '../lib/focusMode'
import { useSidebarCollapsed } from '../lib/sidebarCollapsed'
import { PageHelpProvider } from '../lib/pageHelpContext'
import { RoutePageHelp } from './RoutePageHelp'
import { appChromeHeaderClass, appChromeMainClass, mobileNavBelowAppChromeClass } from '../lib/appChrome'
import { PAGE_SHELL_CLASS, pageLayoutWidthForPath } from '../lib/pageLayout'
import { AnimatedDisclosure } from './motion/AnimatedDisclosure'
import { NavSectionStagger } from './motion/NavSectionStagger'
import { CHIP_TONE } from '../lib/chipTone'

type NavItem = BuiltNavItem

/**
 * One sidebar for every account (console audit 2026-10-20): the core pages in
 * a flat list (a page's sub-pages open under it while you are in it), then a
 * "Labs" group with whatever the user keeps in the sidebar, then "More pages"
 * with every other page (lib/sidebarTree.ts). No modes, no numbering.
 */
interface NavSection extends Omit<BuiltNavSection, 'id'> {
  id: BuiltNavSection['id'] | 'core' | 'labs'
}

// Sidebar follows the vibe-coding cycle (ADR 0027) — metadata from navRegistry.ts.
const NAV: NavSection[] = buildOperatorNav()

const SECTION_TO_STAGE: Record<string, PdcaStageId> = {
  plan: 'plan',
  do: 'do',
  check: 'check',
  act: 'act',
}

const STAGE_TONE: Record<NonNullable<NavSection['stage']>, string> = {
  P: CHIP_TONE.infoSubtle,
  D: CHIP_TONE.brandSubtle,
  C: CHIP_TONE.warnSubtle,
  A: CHIP_TONE.okSubtle,
}



/** Step number (1–5) / letter glyph for the icon-rail section picker. */
function railSectionGlyph(section: NavSection): string {
  if (section.step) return String(section.step)
  if (section.stage) return section.stage
  if (section.id === 'labs') return 'L'
  // Account (workspace) → "A"; Act is "5" now, so the letters no longer clash.
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
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  // The phone and desktop headers both stay in the DOM (CSS picks one), but
  // the team and project switchers mount only in the visible one: mounted in
  // both, each ran its hooks and data reads twice on every page.
  const isDesktopHeader = useMediaQuery('(min-width: 48rem)', true)
  const [railSignOutOpen, setRailSignOutOpen] = useState(false)
  const labs = useLabs()
  const [morePagesOpen, setMorePagesOpen] = useState(false)
  const palette = useCommandPalette()
  const askPanel = useAskMushiPanel()
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityUnread, setActivityUnread] = useState(0)
  const whatsNew = useWhatsNew()
  const projectSnapshots = useProjectSnapshots()
  const activeProjectId = useActiveProjectId()
  const setupStatus = useSetupStatus(activeProjectId)
  const setupOpen =
    setupStatus.resolved && setupStatus.activeProject != null && !setupStatus.selectors.done
      ? setupStatus.selectors
      : null
  const activeProjectSnapshot = activeProjectId
    ? projectSnapshots.byId.get(activeProjectId)
    : undefined
  const criticalReports30d = activeProjectSnapshot?.severity_breakdown_30d?.critical ?? 0
  const { isSuperAdmin, isOperator, has } = useEntitlements()
  const pageShellWidth = pageLayoutWidthForPath(pathname)
  const [focusModePreference, setFocusMode] = useFocusMode()
  /** Consent routes always hide chrome; preference still drives the toggle. */
  const focusMode = focusModePreference || isConsentFocusPath(pathname)
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
        description: 'Open your To-do list',
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
        description: 'Open your To-do list',
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

  // One sidebar for every account; role and plan gating still apply.
  const visibleByRole = (i: NavItem) =>
    (!i.superAdmin || isSuperAdmin) && (!i.operatorOnly || isOperator)
  // Nudge-not-hide: feature-gated items used to be filtered out for
  // unentitled users. That hid the upsell (the user couldn't *see* what
  // their plan was missing). Now we surface the item alongside an
  // `UpgradePill` so the click goes to the feature page (which renders
  // its own UpgradePrompt) and the plan signal is visible right in the
  // sidebar. We still hide them in beginner/quickstart modes — those
  // flows already trim the surface aggressively, and a Pro pill in
  // quickstart would be more confusing than helpful.
  const visibleByFeature = (i: NavItem) =>
    !i.requiresFeature || has(i.requiresFeature) || isSuperAdmin

  const visibleNav = useMemo((): NavSection[] => {
    const byPath = new Map(NAV.flatMap((s) => s.items).map((i) => [i.path, i]))
    const pick = (paths: readonly string[]): NavItem[] =>
      paths
        .map((path) => byPath.get(path))
        .filter((i): i is NavItem => i != null)
        .filter(visibleByRole)
        .filter(visibleByFeature)
    const core = pick(CORE_NAV_PATHS)
    const labItems = pick(LAB_FEATURES.filter((f) => labs.isEnabled(f.id)).map((f) => f.paths[0]))
    const sections: NavSection[] = [{ id: 'core', title: 'Pages', hint: 'The pages every account has.', items: core }]
    if (labItems.length > 0) {
      sections.push({
        id: 'labs',
        title: 'Labs',
        hint: 'Pages you switched on in Settings › Labs.',
        items: labItems,
      })
    }
    return sections
  }, [isSuperAdmin, isOperator, has, labs.enabled])

  // One nav-meta request for the one sidebar (core pages plus enabled
  // Labs). The current pathname used to be unioned in so
  // `layoutHeroFromStats` could fill the route hero; that reader is gone,
  // and a page that is not in the sidebar does not read these slices.
  const navSlices = useMemo(
    () => navSlicesForPaths(visibleNav.flatMap((s) => s.items.map((i) => i.path))),
    [visibleNav],
  )
  const navCounts = useNavCounts({ live: true, slices: navSlices })


  // Sub-pages of the core page you are in, listed under it (Checks › Scheduled
  // tests, Team › Billing, …); every other page sits under "More pages".
  const openParent = activeParent(pathname, search)
  const childItems = useMemo((): NavItem[] => {
    if (!openParent) return []
    return (NAV_CHILDREN[openParent] ?? [])
      .map((path) => NAV_ITEM_BY_PATH.get(path))
      .filter((i): i is NavItem => i != null)
      .filter(visibleByRole)
      .filter(visibleByFeature)
  }, [openParent, isSuperAdmin, isOperator, has])
  const moreGroups = useMemo(
    () =>
      morePages({ isOperator, isSuperAdmin }, labs.enabled).map((g) => ({
        ...g,
        items: g.entries
          .map((e) => NAV_ITEM_BY_PATH.get(e.path))
          .filter((i): i is NavItem => i != null)
          .filter(visibleByFeature),
      })),
    [isOperator, isSuperAdmin, has, labs.enabled],
  )
  const isCurrent = (path: string) => isNavPathActive(pathname, search, path)
  // A parent is the current page only when none of its sub-pages is.
  const isCurrentNav = (path: string) =>
    isCurrent(path) && !(path === openParent && childItems.some((c) => isCurrent(c.path)))
  const onMorePage = moreGroups.some((g) => g.items.some((i) => isCurrent(i.path)))
  // Opening a page that lives under "More pages" opens the list, so the
  // sidebar always shows where you are.
  useEffect(() => {
    if (onMorePage) setMorePagesOpen(true)
  }, [onMorePage])
  // ...and scrolls it into view: a page low in "More pages" sat below the
  // fold, so the highlight was there but you could not see it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>('nav[aria-label="Main navigation"] [aria-current="page"]')
        .forEach((el) => el.scrollIntoView?.({ block: 'nearest' }))
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, search, morePagesOpen])

  function selectSection(id: string, options?: { expandSidebar?: boolean }) {
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


  function renderFullNavLink(item: NavItem) {
    const { label, path, icon: Icon, requiresFeature } = item
    const active = isCurrentNav(path)
    const gated = !!requiresFeature && !has(requiresFeature) && !isSuperAdmin
    return (
      <Link
        key={path}
        to={path}
        onClick={() => setMobileOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={`nav-link ${gated ? 'opacity-80' : ''}`}
      >
        <Icon className="nav-link-icon" />
        <span>{label}</span>
        {gated && requiresFeature && <UpgradePill flag={requiresFeature} className="ml-auto" />}
        {renderNavBadge(path, navCounts, { criticalReports30d })}
      </Link>
    )
  }

  function renderRailLink(item: NavItem) {
    const { label, path, icon, description, requiresFeature } = item
    return (
      <NavRailLink
        key={path}
        to={path}
        label={label}
        description={description}
        icon={icon}
        active={isCurrentNav(path)}
        gated={!!requiresFeature && !has(requiresFeature) && !isSuperAdmin}
        badge={resolveNavBadge(path, navCounts, { criticalReports30d })}
        onNavigate={() => setMobileOpen(false)}
      />
    )
  }

  function renderNavLink(item: NavItem, compact: boolean) {
    return compact ? renderRailLink(item) : renderFullNavLink(item)
  }

  // `compact` collapses the sidebar to an icon rail (~48px wide) — same
  // content tree, but section headers, item labels, mode toggle, and most
  // footer chrome are hidden in favour of `title` tooltips. Mobile always
  // gets `compact: false` because the mobile sidebar is a full overlay.
  const renderSidebarContent = (compact: boolean) => (
    <>
      {/* Brand — collapses to a single "M" stamp in compact mode so the
          rail still has a recognisable identity at the top. */}
      <div className="border-b border-edge/60 overflow-visible shrink-0">
        <div className={`chrome-top-row ${compact ? 'px-2 justify-center' : 'px-4'}`}>
          {compact ? (
            <h1 className="text-sm font-bold tracking-tight leading-none text-center" aria-label="mushi mushi admin console">
              <span className="text-brand">m</span>
              <span className="text-fg-secondary">m</span>
            </h1>
          ) : (
            <h1 className="text-sm font-bold tracking-tight leading-none">
              <span className="text-brand">mushi</span>
              <span className="text-fg-secondary">mushi</span>
            </h1>
          )}
        </div>
      </div>

      {/* Navigation — ghost scrollbar at rest; thin bar on hover/focus only. */}
      <div className="sidebar-rail-nav-wrap relative flex min-h-0 flex-1 flex-col">
      <nav aria-label="Main navigation" className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'px-2.5 py-2.5' : 'py-2 px-2'}`}>
        {visibleNav.map((section, sectionIdx) => {
          const stageId = SECTION_TO_STAGE[section.id]
          const isActiveStage = stageId !== undefined && stageId === activeStage
          const isExpanded = true
          // Per-stage staleness — surfaced on the collapsed section header
          // so advanced users can still see at a glance which PDCA stage
          // needs their attention without expanding.
          const staleness = computeStaleness(section.id, navCounts)
          return (
            <div
              key={section.id}
              id={`nav-section-${section.id}`}
              className={compact ? 'nav-rail-group' : sectionIdx > 0 ? 'border-t border-edge/20 pt-1.5 mt-0.5' : ''}
            >
              {section.id === 'core' ? null : compact ? (
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
                  className={compact ? 'flex flex-col gap-1' : 'space-y-0.5'}
                >
                  {section.items.map((item) => (
                    <Fragment key={item.path}>
                      {renderNavLink(item, compact)}
                      {!compact && item.path === openParent && childItems.length > 0 ? (
                        <div className="ml-3 space-y-0.5 border-l border-edge/40 pl-2" data-testid="nav-children">
                          {childItems.map((child) => renderNavLink(child, false))}
                        </div>
                      ) : null}
                      {/* The icon rail has no room for the list: it shows
                          only the sub-page you are on, under its page. */}
                      {compact && item.path === openParent
                        ? childItems.filter((child) => isCurrent(child.path)).map((child) => renderNavLink(child, true))
                        : null}
                    </Fragment>
                  ))}
                  {section.id === 'core' && compact ? (
                    <>
                      {moreGroups
                        .flatMap((group) => group.items)
                        .filter((item) => isCurrent(item.path))
                        .map((item) => renderNavLink(item, true))}
                      <Tooltip
                        side="right"
                        portal
                        content={<NavRailFlyout title="More pages" description="Every other page, by section. Opens the full sidebar." />}
                      >
                        <Btn
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSidebarCollapsed(false)
                            setMorePagesOpen(true)
                          }}
                          className="nav-rail-item nav-rail-item--btn border-0"
                          aria-label="More pages"
                          data-testid="nav-rail-more"
                        >
                          <IconChevronRight className="nav-rail-icon" />
                        </Btn>
                      </Tooltip>
                    </>
                  ) : null}
                  {section.id === 'core' && !compact ? (
                    <>
                      {/* Opens in place: every page not in the sidebar, one
                          click away, and where to pin them (2026-10-24: the
                          old link went to a page of switches all set to Off). */}
                      <button
                        type="button"
                        className="nav-link w-full justify-start text-fg-muted hover:text-fg-secondary"
                        aria-expanded={morePagesOpen}
                        aria-controls="nav-more-pages"
                        onClick={() => setMorePagesOpen((v) => !v)}
                      >
                        <IconChevronRight className={`nav-link-icon opacity-70 motion-safe:transition-transform ${morePagesOpen ? 'rotate-90' : ''}`} />
                        <span>More pages</span>
                      </button>
                      {morePagesOpen ? (
                        <div id="nav-more-pages" className="ml-3 space-y-1.5 border-l border-edge/40 pl-2" data-testid="nav-more-pages">
                          {moreGroups.map((group) => (
                            <div key={group.sectionId} className="space-y-0.5">
                              <p className="px-2 pt-1 text-3xs font-medium uppercase tracking-wider text-fg-faint">{group.title}</p>
                              {group.items.map((item) => renderNavLink(item, false))}
                            </div>
                          ))}
                          <Link to="/settings?tab=display#sidebar-pages" className="nav-link w-full justify-start text-2xs text-fg-muted hover:text-fg-secondary">
                            Keep pages in the sidebar…
                          </Link>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </NavSectionStagger>
              </AnimatedDisclosure>
            </div>
          )
        })}
      </nav>
      </div>

      {/* User footer — the identity card; its menu holds theme, density and
          focus mode (DisplayPreferences). In the rail this is the utility cluster, and it gets a full
          `border-edge` rule (not the /60 hairline the nav groups use) so
          "account + app chrome" reads as a different class of thing from the
          PDCA navigation above it. */}
      <div className={`${compact ? 'flex flex-col gap-1 px-2.5 py-2.5 border-t border-edge' : 'px-3 py-2.5 space-y-2 border-t border-edge/60'}`}>
        {!compact && setupOpen && (
          <Link
            to="/onboarding"
            className="nav-link w-full justify-start text-fg-secondary hover:text-fg"
            title="Finish setting up this app"
          >
            <span>Set up · {setupOpen.required_complete}/{setupOpen.required_total}</span>
          </Link>
        )}
        {!compact && (
          <Link
            to="/feedback"
            className="nav-link w-full justify-start text-fg-muted hover:text-fg-secondary"
            title="Report a console bug, ask a question or request a feature"
          >
            <span>Help &amp; support</span>
          </Link>
        )}
        <PrivacyPostureBadge compact={compact} />
        {compact && (
          <Tooltip
            side="right"
            portal
            content={
              <NavRailFlyout
                title={focusMode ? 'Exit focus mode' : 'Focus mode'}
                description="Hides the sidebar and header so only the page content is left."
                hint="Cmd/Ctrl + . toggles it, Esc exits"
              />
            }
          >
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFocusMode((value) => !value)}
              // `.nav-rail-item` draws its own inset focus outline; the
              // `nav-rail-item--btn` hook suppresses Btn's offset ring so the
              // two don't stack. Done in CSS rather than with
              // `focus-visible:ring-0`, which is emitted BEFORE `ring-2` in
              // @layer utilities at equal specificity and therefore loses.
              className="nav-rail-item nav-rail-item--btn border-0"
              aria-pressed={focusMode}
              aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}
            >
              <IconEye className="nav-rail-icon" />
            </Btn>
          </Tooltip>
        )}
        {!compact && (
          <SidebarUserCard
            user={user}
            signOut={signOut}
            menuTop={
              <>
                <DisplayPreferences focusMode={focusMode} onFocusChange={setFocusMode} />
                <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5 text-2xs">
                  <Link to="/settings?tab=display" className="text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                    All display settings
                  </Link>
                  <Link to="/tester" className="text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                    Open the tester portal →
                  </Link>
                </div>
              </>
            }
          />
        )}
        {compact && (
          <Tooltip
            side="right"
            portal
            content={
              <NavRailFlyout
                title="Sign out"
                description={
                  user?.email
                    ? `Ends this session for ${user.email}.`
                    : 'Ends this session on this device.'
                }
              />
            }
          >
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRailSignOutOpen(true)}
              // Colour comes from `.nav-rail-item--danger`; the utility form
              // (`text-rose hover:*`) sits in @layer utilities and loses to
              // unlayered `.nav-rail-item`, so it was dead code.
              className="nav-rail-item nav-rail-item--btn nav-rail-item--danger border-0"
              aria-label="Sign out"
            >
              <IconSignOut className="nav-rail-icon" />
            </Btn>
          </Tooltip>
        )}
        {railSignOutOpen && (
          <SignOutAllDialog signOut={signOut} onClose={() => setRailSignOutOpen(false)} />
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
          // Collapsed rail is w-16 (64px): a 44px hit area (WCAG 2.5.5) plus
          // 10px gutters either side. At the old w-14 the row cleared the rail
          // border by 6px, which is what made an otherwise fine icon column
          // read as squeezed against the edge.
          className={`hidden md:flex flex-shrink-0 min-h-0 border-r border-edge/60 bg-surface-root flex-col motion-safe:transition-[width] motion-safe:duration-base ${sidebarCollapsed ? 'w-16' : 'w-60'}`}
          data-collapsed={sidebarCollapsed ? 'true' : 'false'}
        >
          {renderSidebarContent(sidebarCollapsed)}
          {/* Collapse toggle — pinned to the bottom of the rail so the
              affordance is always findable in either state. Uses the same
              chevron icon component as the rest of the app's icon buttons
              (rotated per state) instead of a bare text glyph, and a rich
              Tooltip instead of a native `title` so it reads as a real
              button and matches every other collapsed-rail control. The
              `[` hotkey mirrors Linear's. */}
          <Tooltip
            side="right"
            portal
            content={
              sidebarCollapsed ? (
                <NavRailFlyout
                  title="Expand sidebar"
                  description="Brings back the full nav with section names and labels."
                  hint="Press [ to toggle"
                />
              ) : (
                'Collapse to icon rail  ·  ['
              )
            }
          >
            {/* mushi-ui: chrome icon button — Btn variant TBD (collapse row uses nav-link density + chevron label) */}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-pressed={sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`group flex w-full items-center gap-2 border-t border-edge/60 text-2xs text-fg-faint hover:text-fg-muted hover:bg-surface-overlay/40 motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${sidebarCollapsed ? 'h-11 justify-center px-2.5' : 'justify-between px-3 py-1.5'}`}
            >
              <IconChevronRight
                className={`h-3.5 w-3.5 shrink-0 motion-safe:transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`}
              />
              {!sidebarCollapsed && (
                <span className="font-mono text-2xs uppercase tracking-wider text-fg-faint">
                  Collapse
                </span>
              )}
            </button>
          </Tooltip>
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
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 h-auto"
              >
                <IconClose size={14} />
              </Btn>
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
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFocusMode(false)}
            className="text-2xs px-1.5 py-0.5 h-auto"
            aria-label="Exit focus mode"
            title="Exit focus mode (Esc or Cmd/Ctrl+.)"
          >
            Exit <kbd className="ml-1 px-1 py-0.5 rounded-xs border border-edge-subtle text-fg-faint font-mono">Esc</kbd>
          </Btn>
        </div>
      )}

      <div className="flex-1 flex min-h-0 flex-col overflow-hidden">
        {/* Mobile header */}
        {/* Phone header is ONE row (B26): menu, team, project, search. The
            two-row version with the wordmark took a third of a 390px screen
            once the page banners stacked under it; the wordmark lives in the
            menu drawer. The switchers truncate instead of overflowing. */}
        <header className={`md:hidden flex items-center gap-1.5 px-3 py-1.5 border-b border-edge/60 ${appChromeHeaderClass}`}>
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="shrink-0 h-8 w-8 p-0"
          >
            <IconMenu size={18} />
          </Btn>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 [&>*]:min-w-0">
            {!isDesktopHeader && (
              <>
                <OrgSwitcher />
                <ProjectSwitcher />
              </>
            )}
          </div>
          <div className="shrink-0">
            <SearchButton />
          </div>
        </header>

        {/* Desktop sub-header — search left; controls + switchers right */}
        {!focusMode && <header className={`hidden md:flex chrome-top-row items-center gap-2 px-4 xl:gap-3 xl:px-5 border-b border-edge/40 ${appChromeHeaderClass}`}>
          <ChromeBreadcrumb />
          <div className="min-w-0 flex-1 flex justify-end xl:justify-start xl:flex-none xl:max-w-xs">
            <SearchButton />
          </div>
          <div className="ml-auto flex min-w-0 max-w-full shrink items-center justify-end gap-1 xl:gap-1.5 flex-wrap">
            <div
              // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-edge/50 bg-surface-raised/35 p-0.5"
              aria-label="Toolbar"
            >
              <Tooltip content={activityUnread > 0 ? `Live activity — ${activityUnread} new` : 'Live activity'} side="bottom">
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActivityOpen(true)}
                  aria-label={activityUnread > 0 ? `Live activity, ${activityUnread} unread` : 'Live activity'}
                  className="relative h-8 w-8 p-0 border-0"
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
                </Btn>
              </Tooltip>
              <Tooltip content="Keyboard shortcuts (press ?)" side="bottom">
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setHotkeysOpen(true)}
                  aria-label="Open keyboard shortcuts"
                  className="h-8 w-8 p-0 border-0"
                >
                  <span aria-hidden className="font-mono text-xs leading-none">?</span>
                </Btn>
              </Tooltip>
              <AskMushiLauncherButton
                panelOpen={askPanel.isOpen}
                onClick={() => askPanel.open()}
              />
            </div>
            <div className="min-w-0 shrink">
              <VersionBadge whatsNew={whatsNew} />
            </div>
            <span className="hidden xl:block h-5 w-px shrink-0 bg-edge-subtle" aria-hidden />
            <div className="flex min-w-0 items-center gap-1">
              {isDesktopHeader && (
                <>
                  <OrgSwitcher />
                  <ProjectSwitcher />
                </>
              )}
            </div>
          </div>
        </header>}

        <PageHelpProvider>
          <main id="main-content" className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-surface ${appChromeMainClass}`}>
            <div
              // pb-20 clears the docked setup-guide pill (fixed bottom-4): without it the
              // last control on a page (the Connect "Create Upgrade PR" button) sat
              // under the pill with no scroll room left to uncover it.
              className={`${PAGE_SHELL_CLASS[pageShellWidth]} pb-20 motion-safe:transition-[transform,opacity] motion-safe:duration-base`}
              data-page-width={pageShellWidth}
            >
              <ScrollToHashAnchor />
              {!focusMode && <ProjectScopeNotice />}
              {children}
              {!focusMode && <DemoProjectHint />}
              {/* Page help sits under the content: a newcomer reads the page
                  first, the explanation second (audit 2026-10-20). */}
              {!focusMode && <RoutePageHelp />}
              {/* Developer details (components/readout/ReadoutPanel) portal here, so they close every page. */}
              <div id={PAGE_FOOT_SLOT_ID} className="mt-4 empty:hidden" />
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
      // 1 · Connect: setup, plus integration health (Integrations lives here
      // since ADR 0027, so its count moved from Act with it).
      const issues = navCounts.healthIssues
      const extended = startSectionAttention(navCounts.slices)
      if (issues === 0 && !extended) return null
      const parts: string[] = []
      if (issues > 0) parts.push(`${issues} integration${issues === 1 ? '' : 's'}`)
      if (extended) parts.push(extended.label)
      return {
        count: issues + (extended?.count ?? 0),
        tone: issues > 2 || extended?.tone === 'danger' ? 'danger' : 'warn',
        label: parts.join(' · '),
      }
    }
    case 'plan': {
      // 2 · Bugs: the untriaged backlog plus Home, which lives here since ADR 0027.
      const backlog = navCounts.untriagedBacklog
      const home = planSectionAttention(navCounts.slices)
      if (backlog === 0 && !home) return null
      const parts: string[] = []
      if (backlog > 0) parts.push(`${backlog} untriaged report${backlog === 1 ? '' : 's'} waiting`)
      if (home) parts.push(home.label)
      const backlogTone = backlog > 0 ? (toneForBacklog(backlog) as SectionStaleness['tone']) : 'warn'
      return {
        count: backlog + (home?.count ?? 0),
        tone: home?.tone === 'danger' ? 'danger' : backlogTone,
        label: parts.join(' · '),
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
      const base = checkSectionAttention(navCounts.slices)
      const reg = navCounts.regressedActions
      // Regressed User stories actions roll up here, where User stories now lives.
      const extended = reg > 0
        ? {
            count: reg + (base?.count ?? 0),
            tone: 'danger' as const,
            label: base ? `${reg} regressed user-story actions · ${base.label}` : `${reg} regressed user-story action${reg === 1 ? '' : 's'}`,
          }
        : base
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
      // 5 · Ship & watch: releases, research and weekly insights.
      const extended = actSectionAttention(navCounts.slices)
      if (!extended) return null
      return {
        count: extended.count,
        tone: extended.tone,
        label: extended.label,
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
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
}

interface SectionRailHeaderProps {
  section: NavSection
  expanded: boolean
  isActiveStage: boolean
  staleness: SectionStaleness | null
  onSelect: () => void
}

/**
 * Rail section picker (1 – 5 for the cycle steps, A for Account). Shares `.nav-rail-item`
 * geometry with the item rows so the whole rail sits on one 44px rhythm, and
 * shares the flyout so a section explains itself in the same shape an item
 * does — the section `hint` copy already reads as plain English.
 */
function SectionRailHeader({ section, expanded, isActiveStage, staleness, onSelect }: SectionRailHeaderProps) {
  const glyph = railSectionGlyph(section)
  const stageTone = section.stage
    ? STAGE_TONE[section.stage]
    : 'bg-surface-overlay text-fg-secondary border border-edge-subtle'
  const descId = railDescriptionId(`section-${section.id}`)
  return (
    <Tooltip
      side="right"
      portal
      content={
        <NavRailFlyout
          title={section.title}
          description={section.hint}
          status={staleness ? { tone: staleness.tone, label: staleness.label } : null}
          kicker={section.stage ? { label: glyph, className: stageTone } : null}
          hint={expanded ? undefined : 'Opens this group in the full sidebar'}
        />
      }
    >
      {/* mushi-ui: chrome icon button — Btn variant TBD (PDCA rail glyph + staleness badge layout) */}
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={expanded}
        aria-current={expanded ? 'true' : undefined}
        aria-label={`${section.title}${expanded ? '' : ' — show navigation'}`}
        aria-describedby={descId}
        className={`nav-rail-item ${
          expanded
            ? 'bg-surface-overlay text-fg ring-1 ring-brand/40'
            : isActiveStage
              ? 'ring-1 ring-brand/25'
              : ''
        }`}
      >
        {/* Badge anchors to the GLYPH, not the button: anchoring it to the
            button pushed it into the rail's border and over the glyph itself.
            The ring separates the count from the glyph underneath it. */}
        <span className="nav-rail-glyph">
          <span className={`nav-rail-stamp ${stageTone}`} aria-hidden="true">
            {glyph}
          </span>
          {staleness && (
            <span
              aria-hidden="true"
              className={`nav-rail-badge ring-1 ring-surface-root ${STALENESS_TONE[staleness.tone]}`}
            >
              {railBadgeText(staleness.count)}
            </span>
          )}
        </span>
        <span id={descId} className="sr-only">
          {section.hint}
          {staleness ? ` — ${staleness.label}` : ''}
        </span>
      </button>
    </Tooltip>
  )
}

function SectionHeader({ section, isExpanded, isActiveStage, staleness, onToggle }: SectionHeaderProps) {
  const showChevron = section.defaultCollapsed !== undefined || section.id === 'workspace'
  const inner = (
    <span className="flex items-center gap-1.5 min-w-0 w-full">
      {/* A numbered title ("2 · Bugs") already carries its step; the letter
          chip is only for sections without one. */}
      {section.stage && !section.step && (
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
          role="img"
          className={`inline-flex items-center justify-center min-w-4 px-1 h-3.5 rounded-sm text-3xs font-mono font-bold leading-none shrink-0 ${STALENESS_TONE[staleness.tone]}`}
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
    // mushi-ui: chrome icon button — Btn variant TBD (nav section accordion row)
    <button
      type="button"
      onClick={onToggle}
      className={`nav-section flex items-center gap-1.5 w-full hover:text-fg-secondary motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm ${
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
