/**
 * FILE: apps/admin/src/components/Layout.tsx
 * PURPOSE: App shell — sectioned sidebar with SVG icons, active indicator bar,
 *          responsive mobile drawer, skip-nav a11y link.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useEffect, useState } from 'react'
import type { ReactNode, ComponentType } from 'react'
import type { FeatureFlag } from '../lib/useEntitlements'
import {
  IconDashboard, IconReports, IconStory, IconGraph, IconJudge, IconQuery,
  IconFixes, IconProjects, IconIntegrations, IconQueue, IconSSO,
  IconAudit, IconFineTuning, IconSettings, IconMenu, IconClose,
  IconSignOut, IconHealth, IconShield, IconBell, IconIntelligence, IconBilling,
  IconCompliance, IconStorage, IconMarketplace, IconGlobe, IconSparkle, IconGit,
  // unique glyphs for the closed-loop + workspace sections
  IconLessons, IconDrift, IconAnomalies, IconReleases, IconExperiments,
  IconIterate, IconRewards, IconMcp, IconMembers, IconQaCoverage,
  IconInbox, IconGauge, IconUser, IconExplore, IconChat,
} from './icons'
import { IntegrationHealthDot } from './IntegrationHealthDot'
import { SidebarHealthDot } from './SidebarHealthDot'
import { useNavCounts, toneForBacklog, toneForFailed, toneForInFlight, toneForOpen } from '../lib/useNavCounts'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePill } from './billing/UpgradeNudge'
import { ProjectSwitcher } from './ProjectSwitcher'
import { OrgSwitcher } from './OrgSwitcher'
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
import { FeedbackModal } from './FeedbackModal'
import { ActivityDrawer } from './ActivityDrawer'
import { DensitySidebarToggle } from './DensitySidebarToggle'
import { ThemeSidebarToggle } from './ThemeSidebarToggle'
import { SidebarUserCard } from './SidebarUserCard'
import { PrivacyPostureBadge } from './PrivacyPostureBadge'
import { WhatsNewModal, useWhatsNew } from './WhatsNew'
import { VersionBadge } from './VersionBadge'
import { AskMushiSidebar } from './AskMushiSidebar'
import { PageHero, type PageHeroDecide, type PageHeroVerify } from './PageHero'
import { useCommandPalette } from '../lib/useCommandPalette'
import { useHotkeys } from '../lib/useHotkeys'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useFaviconBadge } from '../lib/favicon'
import { useFocusMode } from '../lib/focusMode'
import { useSidebarCollapsed } from '../lib/sidebarCollapsed'
import { PageHelpProvider } from '../lib/pageHelpContext'
import { RoutePageHelp } from './RoutePageHelp'

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
  /** When true, the item is gated on `useEntitlements().isSuperAdmin`.
   *  Operator-only routes like /users are hidden from the sidebar for
   *  non-operators (the route itself ALSO refuses to render — the
   *  sidebar gate is just to avoid teasing it). */
  superAdmin?: boolean
  /** Plan feature flag — hidden until `useEntitlements().has(flag)` (unless super-admin). */
  requiresFeature?: FeatureFlag
  /** When true, this item is also gated on Advanced mode being active in addition to any
   *  plan flag. Aligns with the README's "gated behind Advanced mode" language for Inventory. */
  requiresAdvancedMode?: boolean
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
      // 2026-05-07 reorder — Get started is the entry point for any operator
      // who hasn't fully wired the SDK + repo + judge. Until that's done the
      // dashboard / inbox both just stare back with empty PDCA tiles, so we
      // pin Get started at the top of the rail. Once setup is complete the
      // checklist itself collapses to a "Setup complete" hero, and Dashboard
      // / Inbox become the obvious next stops.
      { label: 'Get started', path: '/onboarding', icon: IconSparkle,   beginner: true, quickstartLabel: 'Setup' },
      { label: 'Dashboard',   path: '/dashboard',  icon: IconDashboard, beginner: true, quickstartLabel: 'Home' },
      // Wave T (2026-04-23) — /inbox is the single top-of-loop destination for
      // "what should I do next?" across the whole PDCA surface. Pinned above
      // the PDCA sections so Advanced users land on it the same way beginner
      // users land on the Dashboard.
      { label: 'Inbox',       path: '/inbox',      icon: IconInbox,     beginner: true, quickstartLabel: 'Inbox' },
      { label: 'My feedback', path: '/feedback',   icon: IconChat,      beginner: true, quickstartLabel: 'Feedback' },
    ],
  },
  {
    id: 'plan',
    title: 'Plan — capture & classify',
    stage: 'P',
    hint: 'Inbound user-felt bugs land here, get classified, deduped, and prioritised.',
    items: [
      { label: 'Reports',     path: '/reports',     icon: IconReports, beginner: true, quickstartLabel: 'Bugs to fix' },
      {
        label: 'User stories',
        path: '/inventory',
        icon: IconStory,
        beginner: true,
        quickstartLabel: 'User stories',
        requiresFeature: 'inventory_v2',
        requiresAdvancedMode: true,
      },
      { label: 'Graph',       path: '/graph',       icon: IconGraph,   beginner: true },
      { label: 'Explore',     path: '/explore',     icon: IconExplore, beginner: true },
      { label: 'Queue',       path: '/queue',       icon: IconQueue },
      { label: 'Anti-Gaming', path: '/anti-gaming', icon: IconShield },
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
      { label: 'QA Coverage',  path: '/qa-coverage',  icon: IconQaCoverage,   beginner: true },
      { label: 'Lessons',      path: '/lessons',      icon: IconLessons,      beginner: true },
      { label: 'Drift',        path: '/drift',        icon: IconDrift,        beginner: true },
      { label: 'Experiments',  path: '/experiments',  icon: IconExperiments },
      { label: 'Anomalies',    path: '/anomalies',    icon: IconAnomalies,    beginner: true },
      { label: 'Releases',     path: '/releases',     icon: IconReleases },
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
      { label: 'Iterate',       path: '/iterate',       icon: IconIterate,      beginner: true },
      { label: 'Integrations',  path: '/integrations/config',  icon: IconIntegrations, beginner: true },
      { label: 'MCP',           path: '/mcp',           icon: IconMcp,          beginner: true },
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
      { label: 'Members',    path: '/organization/members', icon: IconMembers, requiresFeature: 'teams' },
      { label: 'Settings',   path: '/settings',   icon: IconSettings, beginner: true },
      { label: 'Rewards',    path: '/rewards',    icon: IconRewards },
      { label: '🪲 Bounties', path: '/rewards?tab=publishing', icon: IconRewards, requiresFeature: 'marketplace_publish' },
      { label: 'LLM Cost',   path: '/cost',       icon: IconGauge },
      { label: 'Tester portal', path: '/tester',  icon: IconMarketplace },
      { label: 'Billing',    path: '/billing',    icon: IconBilling },
      { label: 'SSO',        path: '/sso',        icon: IconSSO, requiresFeature: 'sso' },
      { label: 'Compliance', path: '/compliance', icon: IconCompliance, requiresFeature: 'soc2' },
      { label: 'Audit Log',  path: '/audit',      icon: IconAudit, requiresFeature: 'audit_log' },
      { label: 'Storage',    path: '/storage',    icon: IconStorage },
      { label: 'Query',      path: '/query',      icon: IconQuery },
      // Phase 2c (2026-04-27) — operator-only directory. Hidden from
      // the sidebar for everyone except super-admins (kensaurus@…).
      // The page itself re-checks the role + the gateway returns 404
      // for non-operators, so this is just a usability gate.
      { label: 'Users',      path: '/users',      icon: IconUser, superAdmin: true },
    ],
  },
]

interface PageHeroFallback {
  title: string
  kicker: string
  scope: string
  decide: PageHeroDecide
  verify: PageHeroVerify
}

const PAGE_HERO_FALLBACKS: Record<string, PageHeroFallback> = {
  '/feedback': {
    title: 'My feedback',
    kicker: 'Start',
    scope: 'feedback',
    decide: {
      label: 'Your submissions',
      summary: 'Status banner and FEEDBACK SNAPSHOT show replies, active tickets, and shipped releases before you pick a tab.',
      severity: 'info',
    },
    verify: {
      label: 'Closed loop',
      detail: 'Shipped tab shows release version chips — Active tab pulses when the team replies.',
    },
  },
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
  '/reports': {
    title: 'Reports',
    kicker: 'Plan',
    scope: 'reports',
    decide: {
      label: 'Triage queue',
      summary: 'Banner + TRIAGE SNAPSHOT — Overview for posture, Queue to triage, Severity for 14d trends.',
      severity: 'info',
    },
    verify: {
      label: 'Report evidence',
      detail: 'Open a report to review screenshots, console logs, network traces, and user context.',
    },
  },
  '/inventory': {
    title: 'User stories',
    kicker: 'Plan',
    scope: 'inventory',
    decide: {
      label: 'Truth layer',
      summary: 'Banner + INVENTORY SNAPSHOT — map stories to verified actions before dispatching fixes.',
      severity: 'info',
    },
    verify: {
      label: 'Gate evidence',
      detail: 'Gates tab lists open findings; Tree tab shows backend and test wiring per action.',
    },
  },
  '/graph': {
    title: 'Knowledge graph',
    kicker: 'Plan',
    scope: 'graph',
    decide: {
      label: 'Blast radius map',
      summary: 'Banner + GRAPH SNAPSHOT — see how reports cluster into components, pages, and regressions.',
      severity: 'info',
    },
    verify: {
      label: 'Node evidence',
      detail: 'Click any node on Explore tab to highlight blast radius and related edges.',
    },
  },
  '/explore': {
    title: 'Codebase atlas',
    kicker: 'Plan',
    scope: 'explore',
    decide: {
      label: 'Source map',
      summary: 'Banner + EXPLORE SNAPSHOT — indexed files by layer with import edges and semantic search.',
      severity: 'info',
    },
    verify: {
      label: 'Index evidence',
      detail: 'Index tab shows repo, webhook, last error, and embedding coverage for debug.',
    },
  },
  '/fixes': {
    title: 'Fixes',
    kicker: 'Do',
    scope: 'fixes',
    decide: {
      label: 'Fix pipeline',
      summary: 'Track each attempted fix from dispatch through PR, judge review, and merge readiness.',
      severity: 'info',
    },
    verify: {
      label: 'Pipeline proof',
      detail: 'Use attempt cards for branch, PR, CI, and trace evidence.',
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
  '/judge': {
    title: 'Judge',
    kicker: 'Check',
    scope: 'judge',
    decide: {
      label: 'Classifier quality',
      summary: 'Banner + JUDGE SNAPSHOT — Overview for posture, Trend for 12w chart, Evaluations for per-report grades.',
      severity: 'info',
    },
    verify: {
      label: 'Evaluation proof',
      detail: 'Evaluations tab links each grade to the source report and judge reasoning.',
    },
  },
  '/health': {
    title: 'Health',
    kicker: 'Check',
    scope: 'health',
    decide: {
      label: 'Pipeline vitals',
      summary: 'Banner + HEALTH SNAPSHOT — LLM error/fallback rates, cron cadence, and provider probes.',
      severity: 'info',
    },
    verify: {
      label: 'Trace proof',
      detail: 'Activity tab links each LLM call to Langfuse and the source report.',
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
  '/compliance': {
    title: 'Compliance',
    kicker: 'Workspace',
    scope: 'compliance',
    decide: {
      label: 'Audit posture',
      summary: 'Review failing controls, open DSARs, and legal holds before your next SOC 2 review.',
      severity: 'info',
    },
    verify: {
      label: 'Evidence snapshot',
      detail: 'Overview KPI strip shows control pass/fail counts — Evidence tab expands payload JSON for auditors.',
    },
  },
  '/audit': {
    title: 'Audit log',
    kicker: 'Workspace',
    scope: 'audit',
    decide: {
      label: 'Mutation trail',
      summary: 'Scan 24h failures and actor mix before exporting CSV evidence for compliance.',
      severity: 'info',
    },
    verify: {
      label: 'Latest event',
      detail: 'Log tab expands metadata JSON — Breakdown tab links to top 7-day actions.',
    },
  },
  '/storage': {
    title: 'Storage',
    kicker: 'Workspace',
    scope: 'storage',
    decide: {
      label: 'Bucket health',
      summary: 'Probe BYO buckets before screenshot uploads fail silently — defaults use cluster Supabase Storage.',
      severity: 'info',
    },
    verify: {
      label: 'Usage + probe',
      detail: 'Configure tab shows step-by-step health debug — Usage tab lists screenshot object counts.',
    },
  },
  '/query': {
    title: 'Ask Your Data',
    kicker: 'Analytics',
    scope: 'query',
    decide: {
      label: 'Query posture',
      summary: 'Check 24h error rate and saved prompts before running ad-hoc analytics on production bug data.',
      severity: 'info',
    },
    verify: {
      label: 'Latest run',
      detail: 'History tab reruns saved prompts — Schema tab lists approved tables for raw SQL.',
    },
  },
  '/onboarding': {
    title: 'Get started',
    kicker: 'Start',
    scope: 'onboarding',
    decide: {
      label: 'Setup progress',
      summary: 'Finish required steps so Dashboard, Reports, and Fixes stop showing empty shells.',
      severity: 'info',
    },
    verify: {
      label: 'Pipeline proof',
      detail: 'Verify tab sends a test report — SDK tab shows the install snippet for every environment.',
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
  '/integrations/config': {
    title: 'Integrations',
    kicker: 'Act',
    scope: 'integrations',
    decide: {
      label: 'Platform wiring',
      summary: 'Connect Sentry, Langfuse, and GitHub so classification, traces, and auto-fix PRs work end-to-end.',
      severity: 'info',
    },
    verify: {
      label: 'Probe history',
      detail: 'Test each card to refresh status pills and sparklines scoped to the active project.',
    },
  },
  '/inbox': {
    title: 'Inbox',
    kicker: 'Start',
    scope: 'inbox',
    decide: {
      label: 'Action queue',
      summary: 'Status banner and INBOX SNAPSHOT tell you open vs clear before you work the Actions tab top-to-bottom.',
      severity: 'info',
    },
    verify: {
      label: 'Card source',
      detail: 'Counts match the sidebar badge — derived from the same dashboard aggregate + live stats endpoint.',
    },
  },
}

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
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const [feedbackModalType, setFeedbackModalType] = useState<'bug' | 'feature'>('bug')
  const whatsNew = useWhatsNew()
  const navCounts = useNavCounts()
  const { isSuperAdmin, has } = useEntitlements()
  const fallbackHero = PAGE_HERO_FALLBACKS[pathname]
  const [focusMode, setFocusMode] = useFocusMode()
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed()

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
        description: 'Toggle Ask Mushi (scoped to current page)',
        handler: (e) => {
          e.preventDefault()
          setAiOpen((v) => !v)
        },
        meta: true,
      },
      {
        key: 'j',
        description: 'Toggle Ask Mushi (scoped to current page)',
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
      // `[` toggles the desktop sidebar between full (208px) and an
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

  let visibleNav: NavSection[]
  if (isQuickstart) {
    const quickItems: NavItem[] = NAV.flatMap((s) =>
      s.items
        .filter(visibleByRole)
        .filter(visibleByFeature)
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
        items: s.items.filter(visibleByRole).filter(visibleByFeature).filter(i => i.beginner),
      }))
      .filter(s => s.items.length > 0)
  } else {
    // Advanced mode: render every item including gated ones, so the
    // sidebar's upsell pill replaces the "hidden until you pay" UX.
    // The actual page still shows its own UpgradePrompt for users
    // without the feature, so this is purely a visibility-without-
    // unlocking change.
    visibleNav = NAV.map(s => ({
      ...s,
      items: s.items.filter(visibleByRole),
    }))
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

  // `compact` collapses the sidebar to an icon rail (~48px wide) — same
  // content tree, but section headers, item labels, mode toggle, and most
  // footer chrome are hidden in favour of `title` tooltips. Mobile always
  // gets `compact: false` because the mobile sidebar is a full overlay.
  const renderSidebarContent = (compact: boolean) => (
    <>
      {/* Brand — collapses to a single "M" stamp in compact mode so the
          rail still has a recognisable identity at the top. */}
      <div className={`${compact ? 'px-2 py-3' : 'px-4 py-3'} border-b border-edge/60`}>
        {compact ? (
          <h1 className="text-sm font-bold tracking-tight leading-none text-center" aria-label="mushi mushi admin console">
            <span className="text-brand">m</span>
            <span className="text-fg-secondary">m</span>
          </h1>
        ) : (
          <>
            <h1 className="text-sm font-bold tracking-tight leading-none">
              <span className="text-brand">mushi</span>
              <span className="text-fg-secondary">mushi</span>
            </h1>
            <p className="text-2xs text-fg-muted mt-1 tracking-wide uppercase">Admin Console</p>
            <ModeToggle mode={mode} onSelect={setMode} />
            {onHiddenRoute && (
              <div className="mt-2 rounded-sm border border-warn/30 bg-warn/10 px-2 py-1.5 text-3xs text-warn space-y-1.5">
                <p className="leading-snug">{hiddenRouteCopy}</p>
                <button
                  type="button"
                  onClick={() => setMode(isQuickstart ? 'beginner' : 'advanced')}
                  className="underline hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warn/60 rounded-sm"
                >
                  Switch to {isQuickstart ? 'Beginner' : 'Advanced'} mode →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className={`flex-1 overflow-y-auto py-2 ${compact ? 'px-1' : 'px-2'}`}>
        {visibleNav.map((section, sectionIdx) => {
          const collapsed = collapsedMap[section.id] ?? section.defaultCollapsed ?? false
          const stageId = SECTION_TO_STAGE[section.id]
          const isActiveStage = stageId !== undefined && stageId === activeStage
          const collapsible = section.defaultCollapsed !== undefined || section.id === 'workspace'
          // Per-stage staleness — surfaced on the collapsed section header
          // so advanced users can still see at a glance which PDCA stage
          // needs their attention without expanding.
          const staleness = computeStaleness(section.id, navCounts)
          // In compact mode we drop section headers entirely (text-only
          // chrome doesn't survive at 48px) but keep a thin divider
          // between sections so the PDCA grouping still reads visually.
          // Items are always rendered in compact mode — the per-section
          // accordion would be unusable without labels to anchor it.
          const itemsVisible = compact ? true : !collapsed
          return (
            <div key={section.id} className={compact ? 'first:mt-0 mt-2 pt-2 first:border-t-0 first:pt-0 border-t border-edge-subtle/60' : sectionIdx > 0 ? 'border-t border-edge/20 pt-1.5 mt-0.5' : ''}>
              {!compact && (
                <SectionHeader
                  section={section}
                  collapsed={collapsed}
                  collapsible={collapsible}
                  isActiveStage={isActiveStage}
                  staleness={staleness}
                  onToggle={() => toggleSection(section.id, section.defaultCollapsed ?? false)}
                />
              )}
              {itemsVisible && (
                <div className={compact ? 'space-y-0.5 flex flex-col items-stretch' : 'space-y-0.5'}>
                  {section.items.map(({ label, path, icon: Icon, requiresFeature }) => {
                    const active = isActive(pathname, path)
                    // Treat the item as gated when it declares a feature
                    // flag, the user's plan does NOT have it, and the user
                    // isn't a super-admin (super-admins see everything).
                    // The pill links to /billing with the feature focused
                    // — clicking the row itself still goes to the page,
                    // which renders its own UpgradePrompt.
                    const gated = !!requiresFeature && !has(requiresFeature) && !isSuperAdmin
                    return (
                      <Link
                        key={path}
                        to={path}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        // In compact mode, force the label off and let the
                        // browser native `title` tooltip surface it on hover —
                        // matches the Linear collapsed-sidebar pattern. The
                        // base `.nav-link` styles still drive the active
                        // indicator + hover bg + focus ring so we don't
                        // double-define them here.
                        className={`nav-link ${compact ? 'justify-center px-2 py-2' : ''} ${gated ? 'opacity-80' : ''}`}
                        title={compact ? label : undefined}
                        aria-label={compact ? label : undefined}
                      >
                        <Icon className="nav-link-icon" />
                        {!compact && <span>{label}</span>}
                        {!compact && gated && requiresFeature && (
                          <UpgradePill
                            flag={requiresFeature}
                            className="ml-auto"
                          />
                        )}
                        {path === '/integrations/config' && <IntegrationHealthDot />}
                        {path === '/inventory' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={navCounts.regressedActions > 0 ? 'danger' : 'ok'}
                            count={navCounts.regressedActions}
                            label={
                              navCounts.regressedActions > 0
                                ? `${navCounts.regressedActions} regressed inventory actions`
                                : 'No regressed inventory actions'
                            }
                            hideWhenZero
                          />
                        )}
                        {/* Graph + Inventory share the same underlying
                            inventory data — the graph is just the visual
                            view of those nodes — so a regressed action
                            should fire on BOTH rails. Operators who land
                            on /graph from a deep link still see the same
                            "needs attention" signal they'd see if they
                            entered through /inventory. Mirrors the
                            inventory tone exactly. */}
                        {path === '/graph' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={navCounts.regressedActions > 0 ? 'danger' : 'ok'}
                            count={navCounts.regressedActions}
                            label={
                              navCounts.regressedActions > 0
                                ? `${navCounts.regressedActions} regressed actions in the graph`
                                : 'Graph healthy — no regressions'
                            }
                            hideWhenZero
                          />
                        )}
                        {/* Anti-gaming flagged-device count. Any flag is
                            critical (someone tried to abuse the report
                            firehose), so we use toneForFailed which
                            steps ok → warn (≤2) → danger (>2) — even a
                            single flag is amber, three or more is red.
                            Sourced via the cheap count_only=1 mode of
                            /v1/admin/anti-gaming/devices?flagged=true. */}
                        {path === '/anti-gaming' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={toneForFailed(navCounts.flaggedDevices)}
                            count={navCounts.flaggedDevices}
                            label={
                              navCounts.flaggedDevices > 0
                                ? `${navCounts.flaggedDevices} flagged ${navCounts.flaggedDevices === 1 ? 'device' : 'devices'} — review for abuse`
                                : 'No flagged devices'
                            }
                            hideWhenZero
                          />
                        )}
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
                        {path === '/feedback' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={navCounts.feedbackWithReply > 0 ? 'warn' : 'idle'}
                            count={navCounts.feedbackWithReply}
                            label={
                              navCounts.feedbackWithReply > 0
                                ? `${navCounts.feedbackWithReply} feedback ${navCounts.feedbackWithReply === 1 ? 'reply' : 'replies'} to read`
                                : 'No new feedback replies'
                            }
                            hideWhenZero
                          />
                        )}
                        {path === '/inbox' && navCounts.ready && (
                          // Escalates to danger (red) once the open-action
                          // backlog hits 6 — six is roughly "more than a
                          // single working session can clear", which is
                          // exactly when the sidebar should stop reading
                          // as amber-warn and switch to a red squint
                          // signal. Symmetric with toneForFailed (≤2 warn,
                          // >2 danger) and toneForBacklog (≤5 warn, >5
                          // danger). 0 stays hidden via hideWhenZero.
                          <SidebarHealthDot
                            tone={toneForOpen(navCounts.inboxOpenActions, 6)}
                            count={navCounts.inboxOpenActions}
                            label={
                              navCounts.inboxOpenActions > 0
                                ? `${navCounts.inboxOpenActions} open action${navCounts.inboxOpenActions === 1 ? '' : 's'} in Action Inbox`
                                : 'Action Inbox — all clear'
                            }
                            hideWhenZero
                          />
                        )}
                        {path === '/notifications' && navCounts.ready && (
                          // Notifications escalate at 11 — under 10 unread
                          // is a normal day's worth of fix / judge / CI
                          // pings; >10 means the user is missing their
                          // own alerts and the sidebar should shout in
                          // red instead of staying amber.
                          <SidebarHealthDot
                            tone={toneForOpen(navCounts.notificationsUnread, 11)}
                            count={navCounts.notificationsUnread}
                            label={
                              navCounts.notificationsUnread > 0
                                ? `${navCounts.notificationsUnread} unread notification${navCounts.notificationsUnread === 1 ? '' : 's'}`
                                : 'All notifications read'
                            }
                            hideWhenZero
                          />
                        )}
                        {path === '/queue' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={toneForFailed(navCounts.queueFailed)}
                            count={navCounts.queueFailed}
                            label={
                              navCounts.queueFailed > 0
                                ? `${navCounts.queueFailed} dead-letter / failed queue ${navCounts.queueFailed === 1 ? 'item' : 'items'}`
                                : 'Queue clear — no stuck items'
                            }
                            hideWhenZero
                          />
                        )}
                        {path === '/health' && navCounts.ready && (
                          <SidebarHealthDot
                            tone={toneForFailed(navCounts.healthIssues)}
                            count={navCounts.healthIssues}
                            label={
                              navCounts.healthIssues > 0
                                ? `${navCounts.healthIssues} integration${navCounts.healthIssues === 1 ? '' : 's'} reporting issues`
                                : 'All integrations healthy'
                            }
                            hideWhenZero
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

      {/* User footer.
          Expanded rail (compact === false): density toggle on top, then
          a single combined Theme + Focus row (3 icon buttons in one
          bordered strip — see ThemeSidebarToggle.tsx for the rationale
          behind dropping the standalone Auto/system option), then the
          user identity card with provider info + the rose sign-out
          icon (which opens a confirm dialog so the 3am-on-call
          accidental sign-out is caught).
          Collapsed rail (compact === true): density + theme controls
          don't fit a 48px rail, so we hide them. Focus mode + sign-out
          stay as icon-only buttons (always-needed escape hatches). */}
      <div className={`${compact ? 'px-1 py-2 space-y-2' : 'px-3 py-2.5 space-y-2'} border-t border-edge/60`}>
        {/* Privacy posture badge — always visible, collapses to a dot when compact */}
        <PrivacyPostureBadge compact={compact} />
        {!compact && <DensitySidebarToggle />}
        {!compact && (
          <ThemeSidebarToggle
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
            <IconSparkle className="nav-link-icon" />
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
    <div className="flex h-screen overflow-hidden">
      <RouteProgress />
      {/* Skip nav — a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-brand focus:text-brand-fg focus:px-3 focus:py-1.5 focus:rounded-sm focus:text-xs focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — `sidebarCollapsed` toggles between a 208px nav
          (w-52) and a 48px icon rail (w-12). Toggle button is rendered
          INSIDE the sidebar (sticky bottom) so it survives both states.
          Hidden entirely in focus mode; the floating exit pill below
          replaces all sidebar affordances when focus mode is on. */}
      {!focusMode && (
        <aside
          className={`hidden md:flex flex-shrink-0 border-r border-edge/60 bg-surface-root flex-col motion-safe:transition-[width] motion-safe:duration-base ${sidebarCollapsed ? 'w-12' : 'w-52'}`}
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

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-2 px-4 py-2.5 border-b border-edge/60 bg-surface-root overflow-visible relative z-20">
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
        {!focusMode && <header className="hidden md:flex items-center gap-3 px-5 py-1.5 border-b border-edge/40 bg-surface-root/60 overflow-visible relative z-20">
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
                      className="absolute -right-0.5 -top-0.5 inline-flex min-w-[0.9rem] h-[0.9rem] items-center justify-center px-1 rounded-full bg-brand text-brand-fg text-[0.55rem] font-semibold leading-none motion-safe:animate-pulse"
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
              <Tooltip content="Ask Mushi (Cmd/Ctrl+J)" side="bottom">
                <button
                  type="button"
                  onClick={() => setAiOpen(true)}
                  aria-label="Open Ask Mushi"
                  className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <span aria-hidden className="font-mono text-xs leading-none">✨</span>
                </button>
              </Tooltip>
              <Tooltip content="Report a bug or request a feature — opens inline" side="bottom">
                <button
                  type="button"
                  onClick={() => { setFeedbackModalType('bug'); setFeedbackModalOpen(true) }}
                  aria-label="Report a bug or request a feature"
                  className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <IconChat className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
            <VersionBadge whatsNew={whatsNew} />
            <OrgSwitcher />
            <ProjectSwitcher />
          </div>
        </header>}

        <PageHelpProvider>
          <main id="main-content" className="flex-1 overflow-y-auto bg-surface">
            <div className="w-full max-w-[min(100%,92rem)] mx-auto px-4 sm:px-5 py-4 motion-safe:transition-[max-width] motion-safe:duration-base">
              {!focusMode && <QuickstartMegaCta />}
              {!focusMode && <PipelineStatusRibbon />}
              {!focusMode && <NextBestAction />}
              <ScrollToHashAnchor />
              {!focusMode && <RoutePageHelp />}
              {fallbackHero && (
                <PageHero
                  scope={fallbackHero.scope}
                  title={fallbackHero.title}
                  kicker={fallbackHero.kicker}
                  decide={fallbackHero.decide}
                  act={null}
                  verify={fallbackHero.verify}
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
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        route={pathname}
      />
      {feedbackModalOpen && (
        <FeedbackModal
          initialType={feedbackModalType}
          onClose={() => setFeedbackModalOpen(false)}
        />
      )}
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
      const reg = navCounts.regressedActions
      if (backlog === 0 && reg === 0) return null
      if (reg > 0) {
        return {
          count: reg,
          tone: 'danger',
          label: `${reg} regressed inventory action${reg === 1 ? '' : 's'} — check User stories`,
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
        className={`nav-section flex items-center gap-1.5 w-full hover:text-fg-secondary motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm ${isActiveStage ? 'nav-section-active' : ''}`}
        title={section.hint}
        aria-expanded={!collapsed}
      >
        {inner}
      </button>
    )
  }
  return (
    <div className={`nav-section flex items-center gap-1.5 ${isActiveStage ? 'nav-section-active' : ''}`} title={section.hint}>
      {inner}
    </div>
  )
}
