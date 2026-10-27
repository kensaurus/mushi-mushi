/**
 * FILE: apps/admin/src/lib/statCardLinks.ts
 * PURPOSE: Navigation targets for clickable snapshot StatCards — drill from
 *          a KPI strip into the page that owns that metric.
 */

import { NAV_REGISTRY } from './navRegistry'
import { HEALTH_HUB, HOME_HUB, TEAM_HUB, legacyHubRoutes, type PageHub } from './pageHubs'

/* ── Dashboard ─────────────────────────────────────────────────────────── */

/* ── Fixes ─────────────────────────────────────────────────────────────── */

export const fixesLinks = {
  totalAttempts: '/fixes?tab=attempts',
  completed: '/fixes?tab=attempts&status=merged',
  failed: '/fixes?tab=attempts&status=failed',
  inProgress: '/fixes?tab=pipeline',
  prsOpen: '/fixes?tab=attempts&status=pr_open',
  prsCiPassing: '/fixes?tab=attempts&status=pr_open',
} as const

/* ── Health ────────────────────────────────────────────────────────────── */

export const healthLinks = {
  totalCalls: '/health?tab=llm',
  errorRate: '/health?tab=llm',
  fallbackRate: '/health?tab=llm',
  latency: '/health?tab=llm',
  cron: '/health?tab=cron',
  lastCall: '/health?tab=activity',
} as const

/* ── Graph ─────────────────────────────────────────────────────────────── */

export const graphLinks = {
  nodes: '/graph?tab=explore',
  edges: '/graph?tab=explore',
  fragile: '/graph?tab=explore',
  inventory: '/graph?tab=explore',
} as const

/* ── Cost ──────────────────────────────────────────────────────────────── */

export const costLinks = {
  totalLogged: '/cost?tab=breakdown',
  spend24h: '/cost?tab=log',
  spendMonth: '/billing',
  topDriver: '/cost?tab=breakdown',
  operations: '/cost?tab=breakdown',
  models: '/cost?tab=breakdown',
  keySource: '/settings?tab=byok',
} as const

/* ── Releases ──────────────────────────────────────────────────────────── */

export const releasesLinks = {
  drafts: '/releases?tab=drafts',
  published: '/releases?tab=published',
  fixesLinked: '/fixes',
  contributors: '/releases?tab=published',
  fixedReports: '/reports',
  feedback: '/feedback',
} as const

/* ── Repo ──────────────────────────────────────────────────────────────── */

export const repoLinks = {
  branches: '/repo?tab=branches',
  prOpen: '/repo?tab=branches&status=open',
  ciPassing: '/repo?tab=branches&status=ci_passing',
  ciFailed: '/repo?tab=branches&status=ci_failed',
  merged: '/repo?tab=branches&status=merged',
  stuck: '/fixes?tab=attempts&status=failed',
} as const

/* ── Judge ─────────────────────────────────────────────────────────────── */

export const judgeLinks = {
  week: '/judge?tab=trend',
  total: '/judge?tab=evaluations',
  disagree: '/judge?tab=evaluations&filter=disagreement',
  drift: '/judge?tab=trend',
  classified: '/reports',
  prompts: '/judge?tab=prompts',
} as const

/* ── Integrations / Settings / Onboarding / Billing / MCP ────────────── */

export const settingsLinks = {
  byok: '/settings?tab=byok',
  // The bug-widget controls (SdkInstallCard) live on the SDK & connection tab.
  sdk: '/settings?tab=sdk',
  routing: '/integrations/config#integrations-routing',
  classifier: '/settings?tab=general',
} as const

// Every target below must be a real route / tab / element id:
// statCardLinks.test.ts checks them (QA bugs 130, 131).
export const onboardingLinks = {
  required: '/onboarding?tab=steps',
  sdk: '/onboarding?tab=sdk',
  reports: '/reports',
  optional: '/onboarding?tab=steps',
} as const

export const billingLinks = {
  plan: '/billing?tab=plans',
  reportsPeriod: '/billing?tab=overview',
  fixesPeriod: '/fixes',
  llmCogs: '/cost',
} as const

export const mcpLinks = {
  activeKeys: '/mcp?tab=setup',
  mcpRead: '/mcp?tab=setup',
  connected: '/mcp?tab=setup',
  sdkOnly: '/mcp?tab=setup',
  tools: '/mcp?tab=catalog',
  endpoint: '/mcp?tab=setup',
} as const

export const connectLinks = {
  github: '/integrations/config',
  sdk: '/connect#connect-sdk',
  sdkVersion: '/connect',
  mcpConnected: '/mcp?tab=setup',
  mcpUnused: '/mcp?tab=setup',
  tools: '/mcp?tab=catalog',
} as const

export const rewardsLinks = {
  contributors30d: '/rewards?tab=contributors',
  points30d: '/rewards?tab=overview',
  rulesTiers: '/rewards?tab=rules',
  quests: '/rewards?tab=quests',
  webhooks: '/rewards?tab=settings',
  pendingPayout: '/rewards?tab=settings',
} as const

/* ── Secondary pages ─────────────────────────────────────────────────────── */

export const anomaliesLinks = {
  open: '/anomalies?tab=anomalies',
  releaseRegressions: '/anomalies?tab=anomalies',
  highScore: '/anomalies?tab=anomalies',
  autoReported: '/reports',
  metricPoints: '/anomalies?tab=metrics',
  dismissed: '/anomalies?tab=anomalies',
} as const

export const driftLinks = {
  openFindings: '/drift?tab=findings',
  critical: '/drift?tab=findings',
  warnings: '/drift?tab=findings',
  snapshots: '/drift?tab=snapshots',
  contractEdges: '/drift?tab=snapshots',
  surfaces: '/drift?tab=findings',
} as const

export const experimentsLinks = {
  total: '/experiments?tab=experiments',
  running: '/experiments?tab=experiments',
  readyToLaunch: '/experiments?tab=experiments',
  winners: '/experiments?tab=experiments',
  assignments: '/experiments?tab=experiments',
  conversion: '/experiments?tab=experiments',
} as const

export const exploreLinks = {
  files: '/explore?tab=index',
  uiLayer: '/explore?tab=layers',
  backend: '/explore?tab=layers',
  embedded: '/explore?tab=search',
} as const

export const feedbackLinks = {
  total: '/feedback?tab=all',
  active: '/feedback?tab=active',
  shipped: '/feedback?tab=shipped',
  mix: '/feedback?tab=all',
} as const

export const qaCoverageLinks = {
  stories: '/qa-coverage?tab=stories',
  passing: '/qa-coverage?tab=passing',
  failing: '/qa-coverage?tab=failing',
  avgPassRate: '/qa-coverage?tab=stories',
  runs24h: '/qa-coverage?tab=stories',
  noData: '/qa-coverage?tab=no_data',
} as const

export const queryLinks = {
  runs24h: '/query?tab=history',
  errors24h: '/query?tab=history',
  saved: '/query?tab=history',
  latency: '/query?tab=ask',
} as const

export const researchLinks = {
  sessions: '/research?tab=history',
  snippets: '/research?tab=history',
  attached: '/reports',
  unattached: '/research?tab=history',
  firecrawl: '/settings?tab=byok#key-firecrawl',
  domains: '/research?tab=search',
} as const

export const storageLinks = {
  healthy: '/storage?tab=configure',
  screenshots: '/storage?tab=usage',
  provider: '/storage?tab=configure',
  unconfigured: '/storage?tab=configure',
} as const

export const ssoLinks = {
  // /sso has no tabs: the cards scroll to the providers list (Layout's ScrollToHashAnchor).
  registered: '/sso#sso-providers',
  pendingFailed: '/sso#sso-providers',
  emailDomains: '/sso#sso-providers',
  planGate: '/billing?tab=plans',
} as const

export const usersLinks = {
  totalSignups: '/users',
  paidUsers: '/billing?tab=overview',
  mrr: '/billing?tab=overview',
  signups7d: '/users',
  signups30d: '/users',
  churn30d: '/users',
} as const

export const auditLinks = {
  events24h: '/audit?tab=log',
  failures: '/audit?tab=log&outcome=failure&since=24h',
  actorMix: '/audit?tab=breakdown',
  allTime: '/audit?tab=log',
  // These three cards are rendered ON the breakdown tab, so pointing them
  // at that same tab made them dead affordances — they showed an arrow and
  // an "Open page →" hint but clicking went nowhere. `actor_type` is a real
  // filter the Log tab reads (AuditPage ACTOR_TYPE_OPTIONS: human | agent |
  // system), so send them to the filtered log instead. `since=24h` matches
  // the cards' own 24h counts; without it the landing row count would not
  // agree with the number the user clicked.
  humanActors: '/audit?tab=log&actor_type=human&since=24h',
  agentActors: '/audit?tab=log&actor_type=agent&since=24h',
  systemActors: '/audit?tab=log&actor_type=system&since=24h',
} as const

export const complianceLinks = {
  controls: '/compliance?tab=evidence',
  openDsars: '/compliance?tab=dsars',
  legalHolds: '/compliance?tab=retention',
  cluster: '/compliance?tab=residency',
} as const

export const intelligenceLinks = {
  digests: '/intelligence?tab=reports',
  activeJobs: '/intelligence?tab=pipeline',
  failedJobs: '/intelligence?tab=pipeline',
  findings: '/intelligence?tab=pipeline',
  fixAttempts: '/fixes?tab=attempts',
  benchmarking: '/intelligence?tab=overview',
} as const

export const iterateLinks = {
  total: '/iterate?tab=runs',
  active: '/iterate?tab=runs',
  succeeded: '/iterate?tab=runs',
  failed: '/iterate?tab=runs',
  avgScore: '/iterate?tab=runs',
  iterations: '/iterate?tab=runs',
} as const

export const lessonsLinks = {
  activeLessons: '/lessons?tab=lessons',
  critical: '/lessons?tab=lessons',
  candidates: '/lessons?tab=clusters',
  promoted: '/lessons?tab=clusters',
  reportsClustered: '/reports',
  highCoherence: '/lessons?tab=clusters',
} as const

export const marketplaceLinks = {
  catalog: '/marketplace?tab=browse',
  installed: '/marketplace?tab=installed',
  deliveries7d: '/marketplace?tab=deliveries',
  successRate: '/marketplace?tab=deliveries',
  failing: '/marketplace?tab=deliveries',
  neverDelivered: '/marketplace?tab=installed',
} as const

export const notificationsLinks = {
  total: '/notifications?tab=inbox',
  unread: '/notifications?tab=inbox&show=unread',
  last24h: '/notifications?tab=inbox',
  enabled: '/notifications?tab=setup',
  fixFailed: '/notifications?tab=inbox',
  lastMessage: '/notifications?tab=inbox',
} as const

/**
 * Page names come from the nav registry and the hub views (lib/pageHubs), so
 * a renamed page is renamed here too. Before this, a hand-kept map told
 * screen readers "Go to Health · LLM", "Drift", "Anomalies", "Intelligence",
 * "Iterate" and "Repo" years after those pages were renamed (report c0dc93ec).
 */
const PAGE_LABEL_BY_PATH: ReadonlyMap<string, string> = new Map(
  NAV_REGISTRY.filter((e) => !e.path.includes('?')).map((e) => [e.path, e.label] as const),
)

/** `/drift` → `/health` + view `schema`: a retired route is the hub view it opens now. */
const LEGACY_ROUTE: ReadonlyMap<string, { hub: PageHub; viewId: string }> = new Map(
  legacyHubRoutes().map((r) => [r.path, { hub: r.hub, viewId: r.viewId }] as const),
)

const HUBS_BY_PATH: ReadonlyMap<string, PageHub> = new Map([HOME_HUB, HEALTH_HUB, TEAM_HUB].map((h) => [h.path, h] as const))

/** Tab ids as the pages name them, in plain words. Unknown ids are title-cased. */
const TAB_LABELS: Record<string, string> = {
  overview: 'Overview',
  queue: 'Queue',
  severity: 'Severity',
  attempts: 'All fixes',
  pipeline: 'In flight',
  llm: 'AI calls',
  cron: 'Background jobs',
  activity: 'Activity',
  explore: 'Map',
  backend: 'Backend',
  breakdown: 'Breakdown',
  log: 'Log',
  drafts: 'Drafts',
  published: 'Published',
  branches: 'Pull requests',
  evaluations: 'Grades',
  trend: 'Trend',
  prompts: 'Prompts',
  platform: 'Platform',
  routing: 'Routing',
  byok: 'AI keys',
  sdk: 'SDK & connection',
  general: 'General',
  setup: 'Setup',
  keys: 'API keys',
  tools: 'Web tools',
  contributors: 'Contributors',
  rules: 'Rules',
  tiers: 'Tiers',
  quests: 'Quests',
  plans: 'Plans',
  inbox: 'Sent',
  anomalies: 'Spikes',
  metrics: 'Metrics',
  findings: 'Changes',
  snapshots: 'Scans',
  scanner: 'Run a scan',
  detect: 'Check now',
  loop: 'Loop',
  history: 'History',
  search: 'Search',
  catalog: 'Catalog',
  clusters: 'Patterns',
  lessons: 'Lessons',
  runs: 'Runs',
  experiments: 'Experiments',
  reports: 'Reports',
  stories: 'Stories',
  deliveries: 'Deliveries',
  installed: 'Installed',
  browse: 'Browse',
  usage: 'Usage',
  configure: 'Configure',
}

/** Status filters in plain words; unknown ones are title-cased. */
const STATUS_LABELS: Record<string, string> = {
  failed: 'Stopped',
  merged: 'Fixed',
  pr_open: 'PR open',
  open: 'Open',
  ci_failed: 'Failing CI',
  ci_passing: 'CI passing',
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface LinkTarget {
  /** Hub or page path, legacy routes resolved: `/drift` → `/health`. */
  path: string
  /** Hub view id, when the target is a hub view other than its first. */
  view: string | null
  params: URLSearchParams
}

function parseTarget(to: string): LinkTarget {
  const [rawPath, rawSearch = ''] = to.split('?')
  const path = (rawPath.split('#')[0] || '/').replace(/\/$/, '') || '/'
  const params = new URLSearchParams(rawSearch.split('#')[0])
  const legacy = LEGACY_ROUTE.get(path)
  if (legacy) {
    const first = legacy.hub.views[0].id
    return { path: legacy.hub.path, view: legacy.viewId === first ? null : legacy.viewId, params }
  }
  const hub = HUBS_BY_PATH.get(path)
  const view = params.get('view')
  return { path, view: hub && view && view !== hub.views[0].id ? view : null, params }
}

/** The page (or hub view) a target opens, in the sidebar's words. */
function pageLabelFor(t: LinkTarget): string {
  const hub = HUBS_BY_PATH.get(t.path)
  if (hub && t.view) {
    const view = hub.views.find((v) => v.id === t.view)
    if (view) return view.label
  }
  const top = `/${t.path.replace(/^\//, '').split('/')[0] ?? ''}`
  return PAGE_LABEL_BY_PATH.get(t.path) ?? PAGE_LABEL_BY_PATH.get(top) ?? titleCase(top.slice(1))
}

/** "All fixes", "All fixes: Stopped", or null without a tab or status. */
function sectionLabelFor(t: LinkTarget, page: string): string | null {
  const tab = t.params.get('tab')
  const status = t.params.get('status')
  const tabLabel = tab ? TAB_LABELS[tab] ?? titleCase(tab) : null
  const statusLabel = status ? STATUS_LABELS[status] ?? titleCase(status) : null
  const tabPart = tabLabel && tabLabel !== page ? tabLabel : null
  if (tabPart && statusLabel) return `${tabPart}: ${statusLabel}`
  return tabPart ?? statusLabel
}

/** Human label for a link target — used in "Go to …" copy and aria-labels. */
export function statDestinationLabel(to: string): string {
  const t = parseTarget(to)
  const page = pageLabelFor(t)
  const section = sectionLabelFor(t, page)
  return section ? `${page} · ${section}` : page
}

/**
 * The link's verb and destination as seen from where the user is: a link to
 * another tab or filter of the same page (or hub view) reads "Show Trend",
 * not "Go to Triage grading · Trend". `current` is a pathname, optionally
 * with its search string.
 */
export function statLinkLabel(to: string, current: string | null): string {
  if (current != null) {
    const here = parseTarget(current)
    const t = parseTarget(to)
    if (t.path === here.path && t.view === here.view) {
      return `Show ${sectionLabelFor(t, pageLabelFor(t)) ?? 'the list'}`
    }
  }
  return `Go to ${statDestinationLabel(to)}`
}
