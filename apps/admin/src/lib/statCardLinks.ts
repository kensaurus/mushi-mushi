/**
 * FILE: apps/admin/src/lib/statCardLinks.ts
 * PURPOSE: Navigation targets for clickable snapshot StatCards — drill from
 *          a KPI strip into the page that owns that metric.
 */

import type { DashboardStats } from '../components/dashboard/DashboardStatsTypes'
import type { InboxStats } from '../components/inbox/types'

/* ── Dashboard ─────────────────────────────────────────────────────────── */

export const dashboardLinks = {
  backlog: '/reports?tab=queue',
  reports14d: '/reports',
  fixes: '/fixes',
  focus: (stats: DashboardStats) => stats.topPriorityTo ?? '/dashboard?tab=loop',
} as const

/* ── Reports ───────────────────────────────────────────────────────────── */

export const reportsLinks = {
  total14d: '/reports?tab=queue',
  untriaged: '/reports?tab=queue',
  critical14d: '/reports?tab=severity',
  dismissed14d: '/reports?tab=queue',
} as const

/* ── Fixes ─────────────────────────────────────────────────────────────── */

export const fixesLinks = {
  totalAttempts: '/fixes?tab=attempts',
  completed: '/fixes?tab=attempts',
  failed: '/fixes?tab=attempts',
  inProgress: '/fixes?tab=pipeline',
  prsOpen: '/fixes?tab=attempts',
  prsCiPassing: '/fixes?tab=attempts',
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
  prOpen: '/repo?tab=branches',
  ciPassing: '/repo?tab=branches',
  ciFailed: '/repo?tab=branches',
  merged: '/repo?tab=activity',
  stuck: '/fixes?tab=attempts',
} as const

/* ── Inbox ───────────────────────────────────────────────────────────── */

export const inboxLinks = {
  open: (stats: InboxStats) => stats.topPriorityTo ?? '/inbox?tab=inbox',
  clear: '/dashboard',
  backlog: '/reports?tab=queue',
  critical: '/reports?tab=severity',
} as const

/* ── Judge ─────────────────────────────────────────────────────────────── */

export const judgeLinks = {
  week: '/judge?tab=scores',
  total: '/judge?tab=scores',
  disagree: '/judge?tab=disagreements',
  drift: '/judge?tab=scores',
  classified: '/reports',
  prompts: '/judge?tab=prompts',
} as const

/* ── Integrations / Settings / Onboarding / Billing / MCP ────────────── */

export const integrationsLinks = {
  platform: '/integrations?tab=platform',
  healthy: '/integrations?tab=platform',
  routing: '/integrations?tab=routing',
  failing: '/integrations?tab=platform',
} as const

export const settingsLinks = {
  byok: '/settings?tab=byok',
  sdk: '/settings?tab=sdk',
  routing: '/integrations?tab=routing',
  classifier: '/settings?tab=general',
} as const

export const onboardingLinks = {
  required: '/onboarding?tab=setup',
  sdk: '/sdk',
  reports: '/reports',
  optional: '/onboarding?tab=setup',
} as const

export const billingLinks = {
  plan: '/billing?tab=plans',
  reportsPeriod: '/billing?tab=overview',
  fixesPeriod: '/fixes',
  llmCogs: '/cost',
} as const

export const mcpLinks = {
  activeKeys: '/mcp?tab=keys',
  mcpRead: '/mcp?tab=keys',
  connected: '/mcp?tab=keys',
  sdkOnly: '/mcp?tab=keys',
  tools: '/mcp?tab=tools',
  endpoint: '/mcp?tab=setup',
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
  readyToLaunch: '/experiments?tab=new',
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
  passing: '/qa-coverage?tab=stories',
  failing: '/qa-coverage?tab=failing',
  avgPassRate: '/qa-coverage?tab=stories',
  runs24h: '/qa-coverage?tab=stories',
  noData: '/qa-coverage?tab=stories',
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
  firecrawl: '/settings?tab=byok',
  domains: '/research?tab=search',
} as const

export const storageLinks = {
  healthy: '/storage?tab=configure',
  screenshots: '/storage?tab=usage',
  provider: '/storage?tab=configure',
  unconfigured: '/storage?tab=configure',
} as const

export const ssoLinks = {
  registered: '/sso?tab=providers',
  pendingFailed: '/sso?tab=providers',
  emailDomains: '/sso?tab=providers',
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
  failures: '/audit?tab=log',
  actorMix: '/audit?tab=breakdown',
  allTime: '/audit?tab=log',
  humanActors: '/audit?tab=breakdown',
  agentActors: '/audit?tab=breakdown',
  systemActors: '/audit?tab=breakdown',
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

export const inventoryLinks = {
  verified: '/inventory?tab=stories',
  regressed: '/inventory?tab=gates',
  findings: '/inventory?tab=gates',
  discovery: '/inventory?tab=discovery',
} as const

export const notificationsLinks = {
  total: '/notifications?tab=inbox',
  unread: '/notifications?tab=inbox&show=unread',
  last24h: '/notifications?tab=inbox',
  enabled: '/notifications?tab=setup',
  fixFailed: '/notifications?tab=inbox',
  lastMessage: '/notifications?tab=inbox',
} as const

/** Resolve a static or stats-aware link target. */
export function statLink<T>(
  target: string | ((stats: T) => string),
  stats?: T,
): string {
  return typeof target === 'function' ? target(stats as T) : target
}
