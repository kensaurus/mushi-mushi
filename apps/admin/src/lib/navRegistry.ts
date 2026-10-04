/**
 * FILE: apps/admin/src/lib/navRegistry.ts
 * PURPOSE: Single source of truth for operator-console navigation metadata —
 *          sidebar labels, section grouping, command-palette entries, and
 *          Check sub-group taxonomy. Layout.tsx attaches icons; consumers
 *          import derived lists from here so paths never drift.
 *
 * OVERVIEW:
 * - NAV_REGISTRY: every sidebar + palette route with IA flags
 * - SIMPLE_NAV_GROUPS: the Quick and Beginner sidebars, built around what a
 *   solo builder does (find and fix bugs, look after apps, connect tools)
 * - CHECK_SUB_GROUPS: progressive-disclosure buckets inside Check (Advanced)
 * - buildStageRoutes / buildStaticRoutes: derived exports for pdca + palette
 *
 * NAMING (Oct 2026 navigation pass): labels are plain words. Every name a
 * page used to have stays in `paletteKeywords`, so a search for the old name
 * ("Judge", "Drift", "Recipe", "Iterate", "Action Inbox", …) still finds it.
 *
 * DEPENDENCIES: pdca.ts (PdcaStageId type only)
 */

import type { PdcaStageId } from './pdca'
import type { FeatureFlag } from './useEntitlements'

export type NavSectionId = 'start' | 'plan' | 'do' | 'check' | 'act' | 'workspace'

export type CheckSubGroupId = 'quality-gates' | 'system-health' | 'release-intel'

export type PaletteGroup = 'Start' | 'Plan' | 'Do' | 'Check' | 'Act' | 'Workspace'

/** Icon keys resolved to components in Layout.tsx */
export type NavIconKey =
  | 'bolt'
  | 'connect'
  | 'dashboard'
  | 'inbox'
  | 'feature-board'
  | 'chat'
  | 'reports'
  | 'content'
  | 'qa-coverage'
  | 'story'
  | 'graph'
  | 'explore'
  | 'queue'
  | 'shield'
  | 'shield-check'
  | 'fixes'
  | 'git'
  | 'fine-tuning'
  | 'judge'
  | 'health'
  | 'audit'
  | 'gauge'
  | 'cost'
  | 'lessons'
  | 'drift'
  | 'experiments'
  | 'anomalies'
  | 'releases'
  | 'intelligence'
  | 'globe'
  | 'external-link'
  | 'iterate'
  | 'skills'
  | 'catalog'
  | 'pipeline'
  | 'source'
  | 'integrations'
  | 'mcp'
  | 'terminal'
  | 'key'
  | 'marketplace'
  | 'bell'
  | 'projects'
  | 'members'
  | 'settings'
  | 'rewards'
  | 'billing'
  | 'sso'
  | 'compliance'
  | 'storage'
  | 'query'
  | 'user'
  | 'activity'
  | 'overview'
  | 'mic'

export interface NavRegistryEntry {
  id: string
  path: string
  /** Sidebar + palette primary label — plain words, no internal jargon. */
  label: string
  sectionId: NavSectionId
  /** PDCA stage for chip + sidebar badge — omit for Start / Workspace */
  pdcaStage?: PdcaStageId
  checkSubGroup?: CheckSubGroupId
  iconKey: NavIconKey
  requiresFeature?: FeatureFlag
  requiresAdvancedMode?: boolean
  superAdmin?: boolean
  /** Mushi-operator-only (entitlements `operator`) — company dashboards like /growth. */
  operatorOnly?: boolean
  /** false = palette-only utility route */
  inSidebar?: boolean
  paletteDescription: string
  /** Search aliases. Must include every former label of the page. */
  paletteKeywords: string[]
  paletteGroup?: PaletteGroup
}

export const CHECK_SUB_GROUPS: Record<
  CheckSubGroupId,
  { title: string; hint: string }
> = {
  'quality-gates': {
    title: 'Fix quality',
    hint: 'How good the automatic fixes are: grading, scheduled tests, audits and lessons learned.',
  },
  'system-health': {
    title: 'App health',
    hint: 'Integration health, code size, what the app is built from and what changed.',
  },
  'release-intel': {
    title: 'Users & releases',
    hint: 'Who uses the app, what shipped, weekly insights, research and experiments.',
  },
}

/**
 * Quick and Beginner sidebars (Oct 2026 navigation pass). The PDCA sections
 * read as an internal process; a solo builder thinks "find and fix bugs, look
 * after my apps, connect my tools". Quick lists the core pages; Beginner adds
 * a few next steps. Advanced keeps every page under NAV_SECTION_META.
 * Paths not in the registry, or hidden by role/plan, are skipped.
 */
export interface SimpleNavGroup {
  id: string
  title: string
  /** Pages in Quick mode, in order. */
  quick: readonly string[]
  /** Pages in Beginner mode, in order (a superset of `quick`). */
  beginner: readonly string[]
}

export const SIMPLE_NAV_GROUPS: readonly SimpleNavGroup[] = [
  {
    id: 'simple-fix',
    title: 'Find & fix bugs',
    quick: ['/dashboard', '/reports', '/inbox', '/fixes'],
    beginner: ['/dashboard', '/reports', '/inbox', '/fixes', '/repo', '/judge'],
  },
  {
    id: 'simple-apps',
    title: 'Your apps',
    quick: ['/portfolio', '/projects'],
    beginner: ['/portfolio', '/overview', '/analytics', '/projects'],
  },
  {
    id: 'simple-connect',
    title: 'Connect your tools',
    quick: ['/onboarding', '/connect', '/integrations/config'],
    beginner: ['/onboarding', '/connect', '/integrations/config', '/mcp', '/notifications'],
  },
  {
    id: 'simple-account',
    title: 'Account',
    quick: ['/settings'],
    beginner: ['/settings', '/billing', '/feedback'],
  },
]

/** Quick-mode pages shown before the first bug has arrived (setup not done). */
export const QUICK_PRE_SETUP_PATHS: ReadonlySet<string> = new Set([
  '/onboarding',
  '/connect',
  '/reports',
  '/inbox',
  '/fixes',
  '/integrations/config',
  '/settings',
])

export const NAV_SECTION_META: Record<
  NavSectionId,
  {
    title: string
    stage?: 'P' | 'D' | 'C' | 'A'
    /** Required: the collapsed rail has no room for a section label, so this
     *  is the only explanation a user gets. A missing hint yields a
     *  title-only flyout and an empty aria-describedby target — the exact
     *  contract nav-rail.test.tsx exists to hold. */
    hint: string
    defaultCollapsed?: boolean
  }
> = {
  start: {
    title: 'Start here',
    hint: 'Setup, your home page, your to-do list and all your apps — where you land each day.',
    defaultCollapsed: true,
  },
  plan: {
    title: 'Bugs coming in',
    stage: 'P',
    hint: 'Bug reports from your users land here, get sorted, grouped and ranked.',
  },
  do: {
    title: 'Fixing',
    stage: 'D',
    hint: 'Turn bug reports into draft pull requests, and tune how that is done.',
  },
  check: {
    title: 'Quality & health',
    stage: 'C',
    hint: 'Check the automatic fixes and the health of your apps.',
  },
  act: {
    title: 'Connect & automate',
    stage: 'A',
    hint: 'Send verified fixes and alerts to the tools you already use.',
  },
  workspace: {
    title: 'Account & admin',
    hint: 'Apps, team, settings, billing and admin tools — outside the bug-fix loop.',
    defaultCollapsed: true,
  },
}

/** Canonical registry — keep lock-step with App.tsx routes. */
export const NAV_REGISTRY: NavRegistryEntry[] = [
  // ── Start here ──────────────────────────────────────────────────────────
  {
    id: 'nav:onboarding',
    path: '/onboarding',
    label: 'Set up',
    sectionId: 'start',
    iconKey: 'bolt',
    paletteDescription: 'Three-step setup: create a project, install the widget, send a test bug.',
    paletteKeywords: ['get started', 'setup', 'install', 'quickstart', 'first run', 'widget', 'snippet', 'project'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:dashboard',
    path: '/dashboard',
    label: 'Home',
    sectionId: 'start',
    iconKey: 'dashboard',
    paletteDescription: 'Summary for the selected app: open bugs, fixes in progress, setup and recent activity.',
    paletteKeywords: ['dashboard', 'home', 'overview', 'kpi', 'metrics', 'loop', 'landing', 'summary'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:inbox',
    path: '/inbox',
    label: 'To-do',
    sectionId: 'start',
    pdcaStage: 'plan',
    iconKey: 'inbox',
    paletteDescription: 'One card for each decision waiting on you — bugs to triage, fixes to review, setup to finish.',
    paletteKeywords: ['action inbox', 'inbox', 'action', 'todo', 'to do', 'pending', 'decision', 'next'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:portfolio',
    path: '/portfolio',
    label: 'All apps',
    sectionId: 'start',
    pdcaStage: 'check',
    iconKey: 'overview',
    paletteDescription: 'Every app in this team side by side: setup state, open bugs, SDK version and problems to fix once across apps.',
    paletteKeywords: ['portfolio', 'all apps', 'apps', 'fix once', 'sdk skew', 'sdk version', 'radar', 'holes', 'team', 'organization'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:overview',
    path: '/overview',
    label: 'App activity',
    sectionId: 'start',
    iconKey: 'overview',
    paletteDescription: 'Last 7 days for every app in this team: sessions, users and open bugs, with links into each app.',
    paletteKeywords: ['overview', 'portfolio view', 'all projects', 'activity', 'sessions', 'consolidated'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:connect',
    path: '/connect',
    label: 'Connect',
    sectionId: 'start',
    iconKey: 'connect',
    paletteDescription: 'Wire up your editor and app: SDK install, MCP for Cursor/Claude, upgrade PRs.',
    paletteKeywords: ['connect & update', 'install', 'sdk', 'upgrade', 'update', 'mcp', 'cursor', 'npm', 'package', 'editor'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:feedback',
    path: '/feedback',
    label: 'Help & support',
    sectionId: 'start',
    iconKey: 'chat',
    paletteDescription: 'Ask the Mushi team for help and read their replies to feedback you sent.',
    paletteKeywords: ['support', 'feedback', 'help', 'contact', 'bug', 'request'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:feature-board',
    path: '/feature-board',
    label: 'Feature requests',
    sectionId: 'start',
    iconKey: 'feature-board',
    paletteDescription: 'Community feature requests and votes.',
    paletteKeywords: ['feature board', 'features', 'roadmap', 'votes', 'board'],
    paletteGroup: 'Start',
  },
  // ── Bugs coming in ──────────────────────────────────────────────────────
  {
    id: 'nav:reports',
    path: '/reports',
    label: 'Bugs',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'reports',
    paletteDescription: 'Every bug report from your users — search, filter, sort and open one to fix it.',
    paletteKeywords: ['reports', 'bugs to fix', 'bug reports', 'triage', 'complaints', 'issues', 'incidents', 'tickets'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:graph',
    path: '/graph',
    label: 'Bug clusters',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'graph',
    paletteDescription: 'Bugs grouped by shared cause, so one fix can close several reports.',
    paletteKeywords: ['graph', 'cluster', 'dedup', 'duplicates', 'fingerprint', 'similar bugs', 'root cause', 'network'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:inventory',
    path: '/inventory',
    label: 'User stories',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'story',
    requiresFeature: 'inventory_v2',
    requiresAdvancedMode: true,
    paletteDescription: 'The things users can do in your app, found by crawling it, and which ones broke.',
    paletteKeywords: ['stories', 'inventory', 'discovery', 'crawl', 'user stories'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:content',
    path: '/content',
    label: 'Content checks',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'content',
    paletteDescription: 'Review AI-generated and user-submitted content flagged as wrong or low quality.',
    paletteKeywords: ['content qa', 'content', 'qa', 'quality', 'moderation'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:explore',
    path: '/explore',
    label: 'Code map',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'explore',
    paletteDescription: 'Map, ask questions about, and tour your indexed repository.',
    paletteKeywords: ['explore', 'codebase', 'atlas', 'understand', 'architecture', 'ask', 'tour', 'domains', 'codebase map'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:queue',
    path: '/queue',
    label: 'Processing jobs',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'queue',
    paletteDescription: 'Background jobs that read and sort new reports; retry the ones that failed.',
    paletteKeywords: ['failed events', 'queue', 'dlq', 'dead letter', 'retry', 'failures', 'pipeline', 'jobs'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:anti-gaming',
    path: '/anti-gaming',
    label: 'Spam & abuse',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'shield',
    paletteDescription: 'Catch spam, duplicate submissions and testers gaming the rewards.',
    paletteKeywords: ['anti-gaming', 'anti gaming', 'spam', 'abuse', 'collusion', 'rate limit', 'fraud', 'dupes'],
    paletteGroup: 'Plan',
  },
  // ── Fixing ──────────────────────────────────────────────────────────────
  {
    id: 'nav:fixes',
    path: '/fixes',
    label: 'Fixes',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'fixes',
    paletteDescription: 'Draft pull requests written by the fix agent, with their checks, ready to review and merge.',
    paletteKeywords: ['fixes ready', 'pull request', 'pr', 'patch', 'diff', 'merge', 'codex', 'llm', 'agent', 'drafts'],
    paletteGroup: 'Do',
  },
  {
    id: 'nav:repo',
    path: '/repo',
    label: 'Pull requests',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'git',
    paletteDescription: 'Every fix branch and pull request in your connected GitHub repo, with CI status.',
    paletteKeywords: ['repo', 'repository', 'branch', 'branches', 'git', 'github', 'pr', 'pull request', 'ci', 'checks', 'merge', 'activity'],
    paletteGroup: 'Do',
  },
  {
    id: 'nav:voice',
    path: '/voice',
    label: 'Voice reports',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'mic',
    paletteDescription: 'Talk a bug or a fix request from your phone; confirm the transcript; the draft PR comes back as a push.',
    paletteKeywords: ['voice', 'mic', 'microphone', 'record', 'dictate', 'phone', 'audio', 'telegram', 'push', 'notify', 'pwa'],
    paletteGroup: 'Do',
  },
  {
    id: 'nav:prompt-lab',
    path: '/prompt-lab',
    label: 'AI prompts',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'fine-tuning',
    paletteDescription: 'Edit and compare the prompts that turn bug reports into pull requests.',
    paletteKeywords: ['prompt lab', 'prompt', 'llm', 'model', 'ai', 'tuning', 'evals', 'template', 'system prompt'],
    paletteGroup: 'Do',
  },
  {
    id: 'nav:iterate',
    path: '/iterate',
    label: 'Improvement runs',
    sectionId: 'do',
    pdcaStage: 'act',
    iconKey: 'iterate',
    paletteDescription: 'Runs where one AI drafts a change and a second AI critiques it until it passes — for fixes, prompts and tests.',
    paletteKeywords: ['iterate', 'pdca', 'improve', 'loop', 'producer critic', 'runs'],
    paletteGroup: 'Do',
  },
  // ── Quality & health (sub-grouped in Advanced sidebar) ──────────────────
  {
    id: 'nav:judge',
    path: '/judge',
    label: 'Fix grading',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'judge',
    paletteDescription: 'A second AI grades each automatic fix and flags where it disagrees with the first.',
    paletteKeywords: ['judge', 'score', 'eval', 'quality', 'grade', 'grading', 'verification', 'llm-as-judge'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:qa-coverage',
    path: '/qa-coverage',
    label: 'Scheduled tests',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'qa-coverage',
    paletteDescription: 'Browser tests of your user stories that run on a schedule and alert when one breaks.',
    paletteKeywords: ['qa coverage', 'qa', 'playwright', 'stories', 'coverage', 'test', 'tests'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:fullstack-audit',
    path: '/fullstack-audit',
    label: 'Full-stack audit',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'shield-check',
    paletteDescription: 'End-to-end audit across frontend, API, and database.',
    paletteKeywords: ['full-stack audit', 'audit', 'fullstack', 'fe', 'be', 'schema'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:lessons',
    path: '/lessons',
    label: 'Lessons',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'lessons',
    paletteDescription: 'Patterns learned from past bugs and fixes.',
    paletteKeywords: ['lessons', 'learned', 'patterns'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:design',
    path: '/design',
    label: 'Design system',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'content',
    paletteDescription: 'Design tokens, contrast pairs, type scale and the deviance score for off-token code; token and rule edits open a draft PR.',
    paletteKeywords: ['design', 'design system', 'tokens', 'dtcg', 'colors', 'contrast', 'typography', 'spacing', 'radius', 'deviance', 'off-token', 'rules'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:health',
    path: '/health',
    label: 'System health',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'health',
    paletteDescription: 'Are your integrations and background jobs working: uptime, errors and failed checks.',
    paletteKeywords: ['health', 'status', 'uptime', 'availability', 'sentry', 'slo', 'monitoring', 'incidents', 'verification hub'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:code-health',
    path: '/code-health',
    label: 'Code size',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'gauge',
    paletteDescription: 'Bundle-size trends and very large files, pushed from your repo’s CI.',
    paletteKeywords: ['code health', 'bundle', 'loc', 'god file', 'refactor', 'gzip', 'ci', 'budget', 'file size'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:recipe',
    path: '/recipe',
    label: 'App blueprint',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'pipeline',
    paletteDescription: 'What this app is built from — database, design system, routes, CI, deploy, env and integrations — and what changed.',
    paletteKeywords: ['recipe', 'app recipe', 'blueprint', 'stack', 'design system', 'tokens', 'gates', 'ci', 'deploy', 'env', 'integrations', 'manifest', 'mushi.recipe.json'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:drift',
    path: '/drift',
    label: 'Schema changes',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'drift',
    paletteDescription: 'Your database schema compared with the last scan: dropped columns, missing access rules, unexpected changes.',
    paletteKeywords: ['drift', 'schema', 'backend', 'migration', 'database'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:anomalies',
    path: '/anomalies',
    label: 'Unusual spikes',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'anomalies',
    paletteDescription: 'Sudden jumps in errors or reports, including ones that started with a release.',
    paletteKeywords: ['anomalies', 'anomaly', 'spike', 'outlier', 'metrics'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:activity',
    path: '/activity',
    label: 'User activity',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'activity',
    paletteDescription: 'Per-app activity — sessions, page views, identified vs. anonymous users, top routes.',
    paletteKeywords: ['activity', 'sessions', 'users', 'page views', 'analytics', 'dau', 'engagement'],
    paletteGroup: 'Check',
  },
  {
    // `/users` + `nav:users` are the operator-only signup directory below
    // (docs: apps/docs/content/admin/users.mdx), so the customer-facing
    // product-analytics page lives at `/analytics`.
    id: 'nav:analytics',
    path: '/analytics',
    label: 'Users & funnels',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'gauge',
    paletteDescription: 'Product analytics from Mushi.track() — event volume, funnels, next-step paths, people, and weekly retention.',
    paletteKeywords: ['users & funnels', 'funnel', 'funnels', 'events', 'track', 'analytics', 'retention', 'paths', 'people', 'conversion', 'cohort'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:releases',
    path: '/releases',
    label: 'Releases',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'releases',
    paletteDescription: 'Shipped releases with reporter credit.',
    paletteKeywords: ['releases', 'changelog', 'ship', 'deploy'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:intelligence',
    path: '/intelligence',
    label: 'Weekly insights',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'intelligence',
    paletteDescription: 'A weekly plain-English report across your apps: what breaks most and who it hits.',
    paletteKeywords: ['intelligence', 'insights', 'analytics', 'trends', 'heatmap', 'cohort', 'weekly report'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:research',
    path: '/research',
    label: 'Research',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'globe',
    paletteDescription: 'Pull web pages and docs (via Firecrawl) into a fix so it uses current information.',
    paletteKeywords: ['research', 'firecrawl', 'web search', 'docs', 'scrape', 'crawl', 'knowledge'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:experiments',
    path: '/experiments',
    label: 'Experiments',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'experiments',
    paletteDescription: 'A/B experiments and feature flags.',
    paletteKeywords: ['experiments', 'ab', 'a/b', 'flags', 'variants'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:growth',
    path: '/growth',
    label: 'Growth',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'gauge',
    operatorOnly: true,
    paletteDescription: 'Operator-only company funnel — activated external projects per week, by signup source.',
    paletteKeywords: ['growth', 'funnel', 'signups', 'activation', 'activated', 'paid', 'source', 'operator'],
    paletteGroup: 'Check',
  },
  // ── Connect & automate ──────────────────────────────────────────────────
  {
    id: 'nav:integrations',
    path: '/integrations/config',
    label: 'Integrations',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'integrations',
    paletteDescription: 'Connect services: Slack, Sentry, GitHub, Linear, Discord — tokens, webhooks, health.',
    paletteKeywords: ['slack', 'discord', 'github', 'sentry', 'linear', 'stripe', 'webhook', 'connect', 'plug', 'integrations', 'services'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:mcp',
    path: '/mcp',
    label: 'Editor agents',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'mcp',
    paletteDescription: 'Connect Cursor, Claude and other coding agents to this app through MCP.',
    paletteKeywords: ['mcp', 'agent help', 'claude', 'cursor', 'agent', 'tools', 'context', 'windsurf', 'editor'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:skills',
    path: '/skills',
    label: 'Agent skills',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'skills',
    paletteDescription: 'Browse agent skills, track the runs that use them, and sync skill sources.',
    paletteKeywords: ['skills', 'skill pipelines', 'skill catalog', 'kenji skills', 'handoff', 'catalog', 'cursor-kenji'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:notifications',
    path: '/notifications',
    label: 'Alert routing',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'bell',
    paletteDescription: 'Choose which events go to Slack, email or Discord, and when.',
    paletteKeywords: ['alerts', 'notifications', 'email', 'slack', 'discord', 'routing', 'rules', 'digest', 'alert routing'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:marketplace',
    path: '/marketplace',
    label: 'Plugins',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'marketplace',
    paletteDescription: 'Install plugins and ready-made templates for common flows.',
    paletteKeywords: ['marketplace', 'recipes', 'templates', 'install', 'plugins'],
    paletteGroup: 'Act',
  },
  // ── Account & admin ─────────────────────────────────────────────────────
  {
    id: 'nav:projects',
    path: '/projects',
    label: 'Manage apps',
    sectionId: 'workspace',
    iconKey: 'projects',
    paletteDescription: 'Create, rename and archive apps (projects), and see their keys and setup.',
    paletteKeywords: ['projects', 'apps', 'create project', 'new app', 'team', 'members', 'organisation', 'workspace'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:members',
    path: '/organization/members',
    label: 'Team members',
    sectionId: 'workspace',
    iconKey: 'members',
    requiresFeature: 'teams',
    paletteDescription: 'Invite teammates and manage their roles.',
    paletteKeywords: ['members', 'invite', 'team', 'organization', 'roles'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:settings',
    path: '/settings',
    label: 'Settings',
    sectionId: 'workspace',
    iconKey: 'settings',
    paletteDescription: 'App settings, AI keys (Anthropic, OpenAI), Firecrawl, GitHub and appearance.',
    paletteKeywords: ['settings', 'config', 'api key', 'api keys', 'ai keys', 'byok', 'anthropic', 'openai', 'keys', 'preferences', 'firecrawl', 'theme', 'branding'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:billing',
    path: '/billing',
    label: 'Billing',
    sectionId: 'workspace',
    iconKey: 'billing',
    paletteDescription: 'Plan, seats, invoices, and usage-based charges.',
    paletteKeywords: ['billing', 'stripe', 'plan', 'invoice', 'seats', 'usage', 'subscription', 'upgrade'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:cost',
    path: '/cost',
    label: 'AI spend',
    sectionId: 'workspace',
    iconKey: 'cost',
    paletteDescription: 'What the AI behind diagnoses and fixes costs, by step and day.',
    paletteKeywords: ['llm cost', 'cost', 'llm', 'tokens', 'spend', 'usage'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:rewards',
    path: '/rewards',
    label: 'Tester rewards',
    sectionId: 'workspace',
    iconKey: 'rewards',
    paletteDescription: 'Points, tiers and payouts for the people who report bugs.',
    paletteKeywords: ['rewards', 'tester', 'bounty', 'wallet', 'points'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:sso',
    path: '/sso',
    label: 'Single sign-on',
    sectionId: 'workspace',
    iconKey: 'sso',
    requiresFeature: 'sso',
    paletteDescription: 'Single sign-on, SAML, and identity provider setup.',
    paletteKeywords: ['sso', 'saml', 'oidc', 'identity', 'login', 'auth'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:compliance',
    path: '/compliance',
    label: 'Compliance',
    sectionId: 'workspace',
    iconKey: 'compliance',
    requiresFeature: 'soc2',
    paletteDescription: 'SOC 2, GDPR, and DSAR — evidence bundles and retention rules.',
    paletteKeywords: ['compliance', 'soc2', 'gdpr', 'dsar', 'privacy', 'retention', 'evidence', 'regulator'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:audit',
    path: '/audit',
    label: 'Audit log',
    sectionId: 'workspace',
    iconKey: 'audit',
    requiresFeature: 'audit_log',
    paletteDescription: 'Who changed what in this console, and when.',
    paletteKeywords: ['audit log', 'log', 'history', 'forensic', 'security', 'changes', 'who did what'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:storage',
    path: '/storage',
    label: 'Storage',
    sectionId: 'workspace',
    iconKey: 'storage',
    paletteDescription: 'Bucket usage, screenshot retention, and data-lifecycle policies.',
    paletteKeywords: ['storage', 's3', 'bucket', 'screenshots', 'attachments', 'retention', 'lifecycle'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:query',
    path: '/query',
    label: 'SQL query',
    sectionId: 'workspace',
    iconKey: 'query',
    paletteDescription: 'Run read-only SQL against your project schema.',
    paletteKeywords: ['query', 'sql', 'postgres', 'ad-hoc', 'data', 'explorer'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:users',
    path: '/users',
    label: 'All users',
    sectionId: 'workspace',
    iconKey: 'user',
    superAdmin: true,
    paletteDescription: 'Operator-only user directory.',
    paletteKeywords: ['users', 'operators', 'directory'],
    paletteGroup: 'Workspace',
  },
  // ── Palette-only utility routes ─────────────────────────────────────────
  {
    id: 'nav:setup-copilot',
    path: '/setup-copilot',
    label: 'Setup copilot',
    sectionId: 'start',
    iconKey: 'terminal',
    inSidebar: false,
    paletteDescription: 'Guided verify-and-dispatch setup assistant.',
    paletteKeywords: ['setup', 'copilot', 'verify', 'dispatch', 'guided'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:cli-auth',
    path: '/cli-auth',
    label: 'CLI sign-in',
    sectionId: 'act',
    iconKey: 'key',
    inSidebar: false,
    paletteDescription: 'Approve the Mushi CLI sign-in from your terminal.',
    paletteKeywords: ['cli auth', 'cli', 'oauth', 'auth', 'terminal', 'login'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:docs-bridge',
    path: '/docs-bridge',
    label: 'Docs',
    sectionId: 'workspace',
    iconKey: 'external-link',
    inSidebar: false,
    paletteDescription: 'Open the documentation, signed in, in a new tab.',
    paletteKeywords: ['docs bridge', 'docs', 'documentation', 'bridge', 'token'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:skills-catalog',
    path: '/skills?tab=catalog',
    label: 'Skill catalog',
    sectionId: 'act',
    iconKey: 'catalog',
    inSidebar: false,
    paletteDescription: 'Browse 70+ agent skills from kenji skills by category.',
    paletteKeywords: ['catalog', 'skill catalog', 'cursor-kenji', 'kenji skills'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:skills-pipelines',
    path: '/skills?tab=pipelines',
    label: 'Skill runs',
    sectionId: 'act',
    iconKey: 'pipeline',
    inSidebar: false,
    paletteDescription: 'Track live skill pipeline runs and check in each step.',
    paletteKeywords: ['skill pipelines', 'pipeline runs', 'handoff', 'context packet', 'checkin'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:skills-sources',
    path: '/skills?tab=sources',
    label: 'Skill sources',
    sectionId: 'act',
    iconKey: 'source',
    inSidebar: false,
    paletteDescription: 'Add GitHub repos (e.g. kensaurus/skills) and sync SKILL.md files.',
    paletteKeywords: ['skill sources', 'skill sync', 'skills.sh', 'kenji skills', 'cursor-kenji'],
    paletteGroup: 'Act',
  },
]

function paletteGroupForSection(sectionId: NavSectionId): PaletteGroup {
  const map: Record<NavSectionId, PaletteGroup> = {
    start: 'Start',
    plan: 'Plan',
    do: 'Do',
    check: 'Check',
    act: 'Act',
    workspace: 'Workspace',
  }
  return map[sectionId]
}

/** Routes with a PDCA stage chip — derived from registry (lock-step with sidebar). */
export function buildStageRoutes(): Array<{ prefix: string; stage: PdcaStageId }> {
  const seen = new Set<string>()
  const routes: Array<{ prefix: string; stage: PdcaStageId }> = []
  for (const entry of NAV_REGISTRY) {
    if (!entry.pdcaStage || entry.inSidebar === false) continue
    const basePath = entry.path.split('?')[0]
    if (seen.has(basePath)) continue
    seen.add(basePath)
    routes.push({ prefix: basePath, stage: entry.pdcaStage })
  }
  return routes.sort((a, b) => b.prefix.length - a.prefix.length)
}

export interface StaticRouteFromRegistry {
  id: string
  label: string
  path: string
  description: string
  group: PaletteGroup
  keywords: string[]
}

export function buildStaticRoutes(): StaticRouteFromRegistry[] {
  return NAV_REGISTRY.map((entry) => ({
    id: entry.id,
    label: entry.label,
    path: entry.path,
    description: entry.paletteDescription,
    group: entry.paletteGroup ?? paletteGroupForSection(entry.sectionId),
    keywords: entry.paletteKeywords,
  }))
}

export function sidebarEntriesForSection(sectionId: NavSectionId): NavRegistryEntry[] {
  return NAV_REGISTRY.filter(
    (e) => e.sectionId === sectionId && e.inSidebar !== false,
  )
}

export function checkEntriesBySubGroup(subGroup: CheckSubGroupId): NavRegistryEntry[] {
  return NAV_REGISTRY.filter(
    (e) => e.sectionId === 'check' && e.checkSubGroup === subGroup && e.inSidebar !== false,
  )
}

export function registryPathHaystack(entry: NavRegistryEntry): string {
  return [entry.label, entry.paletteDescription, ...entry.paletteKeywords].join(' ').toLowerCase()
}

/**
 * Dynamic / auth / tester routes in App.tsx without a 1:1 NAV_REGISTRY row.
 * Listed before registry matchers so `/reports/:id` wins over `/reports`.
 */
const EXTRA_ROUTE_TITLE_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/reports\/[^/]+$/, 'Report'],
  [/^\/content\/[^/]+$/, 'Content checks'],
  [/^\/projects\/[^/]+\/qa-coverage\/[^/]+$/, 'Scheduled tests'],
  [/^\/rewards\/tester-review$/, 'Rewards'],
  [/^\/integrations$/, 'Integrations'],
  [/^\/fine-tuning$/, 'AI prompts'],
  [/^\/console$/, 'Home'],
  [/^\/mcp\/manual$/, 'Editor agents'],
  [/^\/org\/.+\/settings/, 'Organization settings'],
  [/^\/invite\/accept$/, 'Accept invite'],
  [/^\/login$/, 'Sign in'],
  [/^\/reset-password$/, 'Reset password'],
  [/^\/tester\/apps$/, 'Tester · Apps'],
  [/^\/tester\/wallet$/, 'Tester · Wallet'],
  [/^\/tester\/learn$/, 'Tester · Learn'],
  [/^\/tester\/settings$/, 'Tester · Settings'],
  [/^\/tester$/, 'Tester'],
]

let cachedRouteTitleMatchers: ReadonlyArray<readonly [RegExp, string]> | null = null

/** Route → tab-title fallback derived from NAV_REGISTRY labels (longest path first). */
export function buildRouteTitleMatchers(): ReadonlyArray<readonly [RegExp, string]> {
  if (cachedRouteTitleMatchers) return cachedRouteTitleMatchers

  const byBase = new Map<string, string>()
  for (const entry of NAV_REGISTRY) {
    const base = entry.path.split('?')[0]
    if (!byBase.has(base)) byBase.set(base, entry.label)
  }

  const registryMatchers: Array<readonly [RegExp, string]> = [...byBase.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([base, label]) => {
      const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return [new RegExp(`^${escaped}$`), label] as const
    })

  cachedRouteTitleMatchers = [...EXTRA_ROUTE_TITLE_MATCHERS, ...registryMatchers]
  return cachedRouteTitleMatchers
}

/** Resolve a document/tab title when the page has not published PageContext. */
export function routeFallbackTitle(pathname: string): string | null {
  for (const [re, label] of buildRouteTitleMatchers()) {
    if (re.test(pathname)) return label
  }
  return null
}

/**
 * IA decisions:
 * - Check hub: extend `/health?hub=check` (not a new `/check` route) — Health already owns integration telemetry.
 * - Oct 2026: Quick and Beginner use SIMPLE_NAV_GROUPS (no PDCA sections);
 *   Advanced keeps every page under plain section names. Overlapping pages
 *   stay separate but are named for what they do: Home (/dashboard, summary)
 *   vs To-do (/inbox, decisions) vs Improvement runs (/iterate); Bugs
 *   (/reports) vs Processing jobs (/queue); All apps (/portfolio, setup and
 *   holes) vs App activity (/overview, 7-day usage).
 */
