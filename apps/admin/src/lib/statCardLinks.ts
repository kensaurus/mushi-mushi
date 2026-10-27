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

/** `/drift` → "Schema changes": a retired route reads as the view it opens now. */
const LEGACY_VIEW_LABEL: ReadonlyMap<string, string> = new Map(
  legacyHubRoutes().map((r) => [r.path, r.hub.views.find((v) => v.id === r.viewId)?.label ?? r.hub.path] as const),
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
  inbox: 'Received',
  anomalies: 'Spikes',
  metrics: 'Metrics',
  findings: 'Findings',
  snapshots: 'Scans',
  scanner: 'Scanner',
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

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** The page (or hub view) a link target opens, in the sidebar's words. */
function pageLabelFor(pathname: string, params: URLSearchParams): string {
  const hub = HUBS_BY_PATH.get(pathname)
  const viewId = params.get('view')
  if (hub && viewId) {
    const view = hub.views.find((v) => v.id === viewId)
    if (view) return view.label
  }
  return (
    LEGACY_VIEW_LABEL.get(pathname) ??
    PAGE_LABEL_BY_PATH.get(pathname) ??
    PAGE_LABEL_BY_PATH.get(`/${pathname.replace(/^\//, '').split('/')[0]}`) ??
    titleCase(pathname.replace(/^\//, '').split('/')[0] ?? '')
  )
}

/** Human label for a link target — used in "Go to …" copy and aria-labels. */
export function statDestinationLabel(to: string): string {
  const [rawPath, search = ''] = to.split('?')
  const pathname = (rawPath.split('#')[0] || '/').replace(/\/$/, '') || '/'
  const params = new URLSearchParams(search.split('#')[0])
  const page = pageLabelFor(pathname, params)

  const tab = params.get('tab')
  if (tab) {
    const tabLabel = TAB_LABELS[tab] ?? titleCase(tab)
    return tabLabel === page ? page : `${page} · ${tabLabel}`
  }

  const status = params.get('status')
  if (status) return `${page} · ${titleCase(status.replace(/_/g, '-'))}`

  return page
}

/**
 * The link's verb and destination as seen from the page the user is on: a
 * link to another tab of the same page reads "Show Trend", not
 * "Go to Triage grading · Trend".
 */
export function statLinkLabel(to: string, currentPathname: string | null): string {
  const [rawPath, search = ''] = to.split('?')
  const target = (rawPath.split('#')[0] || '/').replace(/\/$/, '') || '/'
  const here = (currentPathname ?? '').replace(/\/$/, '') || '/'
  if (currentPathname != null && target === here) {
    const params = new URLSearchParams(search.split('#')[0])
    const tab = params.get('tab')
    if (tab) return `Show ${TAB_LABELS[tab] ?? titleCase(tab)}`
    const view = params.get('view')
    const hub = HUBS_BY_PATH.get(target)
    const viewLabel = view && hub ? hub.views.find((v) => v.id === view)?.label : null
    if (viewLabel) return `Show ${viewLabel}`
    return 'Show the list'
  }
  return `Go to ${statDestinationLabel(to)}`
}
