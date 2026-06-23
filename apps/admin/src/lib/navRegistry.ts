/**
 * FILE: apps/admin/src/lib/navRegistry.ts
 * PURPOSE: Single source of truth for operator-console navigation metadata —
 *          sidebar labels, PDCA stage mapping, command-palette entries, and
 *          Check sub-group taxonomy. Layout.tsx attaches icons; consumers
 *          import derived lists from here so paths never drift.
 *
 * OVERVIEW:
 * - NAV_REGISTRY: every sidebar + palette route with IA flags
 * - CHECK_SUB_GROUPS: progressive-disclosure buckets inside Check
 * - buildStageRoutes / buildStaticRoutes: derived exports for pdca + palette
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
  | 'dashboard'
  | 'inbox'
  | 'chat'
  | 'reports'
  | 'qa-coverage'
  | 'story'
  | 'graph'
  | 'explore'
  | 'queue'
  | 'shield'
  | 'fixes'
  | 'git'
  | 'fine-tuning'
  | 'judge'
  | 'health'
  | 'audit'
  | 'gauge'
  | 'lessons'
  | 'drift'
  | 'experiments'
  | 'anomalies'
  | 'releases'
  | 'intelligence'
  | 'globe'
  | 'iterate'
  | 'skills'
  | 'integrations'
  | 'mcp'
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

export interface NavRegistryEntry {
  id: string
  path: string
  /** Sidebar + palette primary label */
  label: string
  quickstartLabel?: string
  sectionId: NavSectionId
  /** PDCA stage for chip + sidebar badge — omit for Start / Workspace */
  pdcaStage?: PdcaStageId
  checkSubGroup?: CheckSubGroupId
  iconKey: NavIconKey
  beginner?: boolean
  /** Beginner Check projection — only Judge, Health, QA Coverage */
  checkBeginnerCore?: boolean
  requiresFeature?: FeatureFlag
  requiresAdvancedMode?: boolean
  superAdmin?: boolean
  /** false = palette-only utility route */
  inSidebar?: boolean
  paletteDescription: string
  paletteKeywords: string[]
  paletteGroup?: PaletteGroup
}

export const CHECK_SUB_GROUPS: Record<
  CheckSubGroupId,
  { title: string; hint: string }
> = {
  'quality-gates': {
    title: 'Quality gates',
    hint: 'Judge scores, QA stories, audits, and lessons learned.',
  },
  'system-health': {
    title: 'System health',
    hint: 'Integration health, code metrics, drift, and anomalies.',
  },
  'release-intel': {
    title: 'Release & intel',
    hint: 'Shipped releases, cross-project insights, research, and experiments.',
  },
}

export const CHECK_HUB_PATH = '/health?hub=check'

export const NAV_SECTION_META: Record<
  NavSectionId,
  {
    title: string
    stage?: 'P' | 'D' | 'C' | 'A'
    hint?: string
    defaultCollapsed?: boolean
  }
> = {
  start: {
    title: 'Start here',
    defaultCollapsed: true,
  },
  plan: {
    title: 'Plan — capture & classify',
    stage: 'P',
    hint: 'Inbound user-felt bugs land here, get classified, deduped, and prioritised.',
  },
  do: {
    title: 'Do — dispatch fixes',
    stage: 'D',
    hint: 'Turn classified reports into draft pull requests. Tune the prompt that does it.',
  },
  check: {
    title: 'Check — verify quality',
    stage: 'C',
    hint: 'Independently grade the LLM\u2019s work and the system\u2019s own health.',
  },
  act: {
    title: 'Act — integrate & scale',
    stage: 'A',
    hint: 'Standardise verified fixes back into the upstream tools your team already lives in.',
  },
  workspace: {
    title: 'Workspace',
    hint: 'Account, identity, and admin tools — outside the bug-fix loop.',
    defaultCollapsed: true,
  },
}

/** Canonical registry — keep lock-step with App.tsx routes. */
export const NAV_REGISTRY: NavRegistryEntry[] = [
  // ── Start here ──────────────────────────────────────────────────────────
  {
    id: 'nav:onboarding',
    path: '/onboarding',
    label: 'Get started',
    quickstartLabel: 'Setup',
    sectionId: 'start',
    iconKey: 'bolt',
    beginner: true,
    paletteDescription: 'Three-step setup: create a project, install the widget, send a test bug.',
    paletteKeywords: ['setup', 'install', 'quickstart', 'first run', 'widget', 'snippet', 'project'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:connect',
    path: '/connect',
    label: 'Connect & Update',
    quickstartLabel: 'Connect',
    sectionId: 'start',
    iconKey: 'bolt',
    beginner: true,
    paletteDescription: 'Connect GitHub, install SDK + MCP, and create upgrade PRs.',
    paletteKeywords: ['connect', 'install', 'sdk', 'upgrade', 'update', 'mcp', 'cursor', 'npm', 'package'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    quickstartLabel: 'Home',
    sectionId: 'start',
    iconKey: 'dashboard',
    beginner: true,
    paletteDescription: 'Live PDCA loop — bugs in, fixes out, judge scores, shipped impact.',
    paletteKeywords: ['home', 'overview', 'kpi', 'metrics', 'loop', 'landing', 'summary'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:inbox',
    path: '/inbox',
    label: 'Action Inbox',
    quickstartLabel: 'Inbox',
    sectionId: 'start',
    pdcaStage: 'plan',
    iconKey: 'inbox',
    beginner: true,
    paletteDescription: 'Action inbox — every event awaiting your decision in one place.',
    paletteKeywords: ['inbox', 'action', 'todo', 'pending', 'decision', 'next'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:feedback',
    path: '/feedback',
    label: 'Support',
    quickstartLabel: 'Support',
    sectionId: 'start',
    iconKey: 'chat',
    beginner: true,
    paletteDescription: 'Feedback you submitted to Mushi.',
    paletteKeywords: ['feedback', 'feature', 'bug', 'request', 'support'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:feature-board',
    path: '/feature-board',
    label: 'Feature board',
    sectionId: 'start',
    iconKey: 'inbox',
    paletteDescription: 'Community feature requests and votes.',
    paletteKeywords: ['features', 'roadmap', 'votes', 'board'],
    paletteGroup: 'Start',
  },
  // ── Plan ────────────────────────────────────────────────────────────────
  {
    id: 'nav:reports',
    path: '/reports',
    label: 'Reports',
    quickstartLabel: 'Bugs to fix',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'reports',
    beginner: true,
    paletteDescription: 'Triage inbound bug reports — grouped, scored, ranked.',
    paletteKeywords: ['bugs', 'triage', 'complaints', 'issues', 'incidents', 'tickets'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:content',
    path: '/content',
    label: 'Content QA',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'qa-coverage',
    paletteDescription: 'Review AI-generated and user-submitted content quality.',
    paletteKeywords: ['content', 'qa', 'quality', 'moderation'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:inventory',
    path: '/inventory',
    label: 'User stories',
    quickstartLabel: 'User stories',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'story',
    requiresFeature: 'inventory_v2',
    requiresAdvancedMode: true,
    paletteDescription: 'User-story inventory and live crawl proposals.',
    paletteKeywords: ['stories', 'inventory', 'discovery', 'crawl'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:graph',
    path: '/graph',
    label: 'Graph',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'graph',
    beginner: true,
    paletteDescription: 'Fingerprint graph — dedup clusters and shared root causes.',
    paletteKeywords: ['cluster', 'dedup', 'fingerprint', 'similar bugs', 'network', 'visualisation', 'reactflow'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:explore',
    path: '/explore',
    label: 'Explore',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'explore',
    paletteDescription: 'Map, chat with, and tour your indexed repository.',
    paletteKeywords: ['codebase', 'atlas', 'understand', 'architecture', 'ask', 'tour', 'domains', 'codebase map'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:queue',
    path: '/queue',
    label: 'Failed events',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'queue',
    paletteDescription: 'Dead-letter queue for ingestion retries and poisoned events.',
    paletteKeywords: ['dlq', 'dead letter', 'retry', 'failures', 'pipeline', 'failed events'],
    paletteGroup: 'Plan',
  },
  {
    id: 'nav:anti-gaming',
    path: '/anti-gaming',
    label: 'Anti-Gaming',
    sectionId: 'plan',
    pdcaStage: 'plan',
    iconKey: 'shield',
    paletteDescription: 'Spam, collusion, and duplicate-submission defences.',
    paletteKeywords: ['spam', 'abuse', 'collusion', 'rate limit', 'fraud', 'dupes'],
    paletteGroup: 'Plan',
  },
  // ── Do ──────────────────────────────────────────────────────────────────
  {
    id: 'nav:fixes',
    path: '/fixes',
    label: 'Fixes',
    quickstartLabel: 'Fixes ready',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'fixes',
    beginner: true,
    paletteDescription: 'Drafted pull requests from the auto-fix agent, ready to merge.',
    paletteKeywords: ['pull request', 'pr', 'patch', 'diff', 'merge', 'codex', 'llm', 'agent', 'drafts'],
    paletteGroup: 'Do',
  },
  {
    id: 'nav:repo',
    path: '/repo',
    label: 'Repo',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'git',
    paletteDescription: 'Every auto-fix branch and PR across the connected GitHub repo, with CI status.',
    paletteKeywords: ['repo', 'repository', 'branch', 'branches', 'git', 'github', 'pr', 'pull request', 'ci', 'checks', 'merge', 'activity'],
    paletteGroup: 'Do',
  },
  {
    id: 'nav:prompt-lab',
    path: '/prompt-lab',
    label: 'Prompt Lab',
    sectionId: 'do',
    pdcaStage: 'do',
    iconKey: 'fine-tuning',
    paletteDescription: 'Tune the prompts that turn reports into pull requests.',
    paletteKeywords: ['prompt', 'llm', 'model', 'ai', 'tuning', 'evals', 'template', 'system prompt'],
    paletteGroup: 'Do',
  },
  // ── Check (sub-grouped in Advanced sidebar) ─────────────────────────────
  {
    id: 'nav:judge',
    path: '/judge',
    label: 'Judge',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'judge',
    beginner: true,
    checkBeginnerCore: true,
    paletteDescription: 'Independent quality grading for the auto-fix output.',
    paletteKeywords: ['score', 'eval', 'quality', 'grade', 'verification', 'llm-as-judge'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:qa-coverage',
    path: '/qa-coverage',
    label: 'QA Coverage',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'qa-coverage',
    beginner: true,
    checkBeginnerCore: true,
    paletteDescription: 'Scheduled Playwright user-story tests.',
    paletteKeywords: ['qa', 'playwright', 'stories', 'coverage', 'test'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:fullstack-audit',
    path: '/fullstack-audit',
    label: 'Full-Stack Audit',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'quality-gates',
    iconKey: 'audit',
    paletteDescription: 'End-to-end audit across frontend, API, and database.',
    paletteKeywords: ['audit', 'fullstack', 'fe', 'be', 'schema'],
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
    id: 'nav:health',
    path: '/health',
    label: 'Health',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'health',
    beginner: true,
    checkBeginnerCore: true,
    paletteDescription: 'System health — uptime, error rates, queue depth, backpressure.',
    paletteKeywords: ['status', 'uptime', 'availability', 'sentry', 'slo', 'monitoring', 'incidents', 'verification hub'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:code-health',
    path: '/code-health',
    label: 'Code Health',
    quickstartLabel: 'Code health',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'gauge',
    paletteDescription: 'Bundle-size trends and god-file LOC findings pushed from host-repo CI.',
    paletteKeywords: ['bundle', 'loc', 'god file', 'refactor', 'gzip', 'code health', 'ci', 'budget', 'file size'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:drift',
    path: '/drift',
    label: 'Drift',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'drift',
    paletteDescription: 'Schema and backend drift detection.',
    paletteKeywords: ['drift', 'schema', 'backend', 'migration'],
    paletteGroup: 'Check',
  },
  {
    id: 'nav:anomalies',
    path: '/anomalies',
    label: 'Anomalies',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'system-health',
    iconKey: 'anomalies',
    paletteDescription: 'Statistical anomaly detection on metrics.',
    paletteKeywords: ['anomalies', 'spike', 'outlier', 'metrics'],
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
    label: 'Intelligence',
    sectionId: 'check',
    pdcaStage: 'check',
    checkSubGroup: 'release-intel',
    iconKey: 'intelligence',
    paletteDescription: 'Cross-project insights: what fails most, who is impacted.',
    paletteKeywords: ['analytics', 'insights', 'trends', 'heatmap', 'cohort'],
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
    paletteDescription: 'Pull external context via Firecrawl to ground fixes in fresh docs.',
    paletteKeywords: ['firecrawl', 'web search', 'docs', 'scrape', 'crawl', 'knowledge'],
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
    paletteKeywords: ['experiments', 'ab', 'flags', 'variants'],
    paletteGroup: 'Check',
  },
  // ── Act ─────────────────────────────────────────────────────────────────
  {
    id: 'nav:iterate',
    path: '/iterate',
    label: 'Iterate',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'iterate',
    beginner: true,
    paletteDescription: 'PDCA producer–critic improvement loop.',
    paletteKeywords: ['iterate', 'improve', 'loop'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:skills',
    path: '/skills',
    label: 'Skill Pipelines',
    quickstartLabel: 'Skill catalog',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'skills',
    beginner: true,
    paletteDescription: 'Browse agent skills, track pipeline runs, and sync sources.',
    paletteKeywords: ['skills', 'skill pipelines', 'cursor-kenji', 'handoff', 'catalog'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:integrations',
    path: '/integrations/config',
    label: 'Integrations',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'integrations',
    beginner: true,
    paletteDescription: 'Connect Slack, Discord, GitHub, Sentry, Stripe, and more.',
    paletteKeywords: ['slack', 'discord', 'github', 'sentry', 'stripe', 'webhook', 'connect', 'plug'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:mcp',
    path: '/mcp',
    label: 'MCP',
    quickstartLabel: 'Agent help',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'mcp',
    beginner: true,
    paletteDescription: 'Connect Cursor, Claude Desktop, and other MCP agents to this project.',
    paletteKeywords: ['mcp', 'claude', 'cursor', 'agent', 'tools', 'context', 'windsurf', 'agent help'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:marketplace',
    path: '/marketplace',
    label: 'Marketplace',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'marketplace',
    paletteDescription: 'Pre-built recipes and templates for common flows.',
    paletteKeywords: ['recipes', 'templates', 'install', 'plugins'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:notifications',
    path: '/notifications',
    label: 'Alert routing',
    sectionId: 'act',
    pdcaStage: 'act',
    iconKey: 'bell',
    paletteDescription: 'Route events to Slack, email, or Discord with per-stage rules.',
    paletteKeywords: ['alerts', 'email', 'slack', 'discord', 'routing', 'rules', 'digest', 'alert routing'],
    paletteGroup: 'Act',
  },
  // ── Workspace ───────────────────────────────────────────────────────────
  {
    id: 'nav:projects',
    path: '/projects',
    label: 'Projects',
    sectionId: 'workspace',
    iconKey: 'projects',
    paletteDescription: 'Create, archive, and manage projects and members.',
    paletteKeywords: ['team', 'members', 'create project', 'organisation', 'workspace'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:members',
    path: '/organization/members',
    label: 'Members',
    sectionId: 'workspace',
    iconKey: 'members',
    requiresFeature: 'teams',
    paletteDescription: 'Invite teammates and manage organization roles.',
    paletteKeywords: ['members', 'invite', 'team', 'organization'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:settings',
    path: '/settings',
    label: 'Settings',
    sectionId: 'workspace',
    iconKey: 'settings',
    beginner: true,
    paletteDescription: 'Project configuration, API keys, Firecrawl, theming.',
    paletteKeywords: ['config', 'api key', 'preferences', 'firecrawl', 'theme', 'branding'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:rewards',
    path: '/rewards',
    label: 'Rewards',
    sectionId: 'workspace',
    iconKey: 'rewards',
    paletteDescription: 'Tester rewards and redemption catalog.',
    paletteKeywords: ['rewards', 'tester', 'bounty', 'wallet'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:cost',
    path: '/cost',
    label: 'LLM Cost',
    sectionId: 'workspace',
    iconKey: 'gauge',
    paletteDescription: 'Token usage and LLM spend by stage.',
    paletteKeywords: ['cost', 'llm', 'tokens', 'billing', 'usage'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:billing',
    path: '/billing',
    label: 'Billing',
    sectionId: 'workspace',
    iconKey: 'billing',
    paletteDescription: 'Plan, seats, invoices, and usage-based charges.',
    paletteKeywords: ['stripe', 'plan', 'invoice', 'seats', 'usage', 'subscription', 'upgrade'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:sso',
    path: '/sso',
    label: 'SSO',
    sectionId: 'workspace',
    iconKey: 'sso',
    requiresFeature: 'sso',
    paletteDescription: 'Single sign-on, SAML, and identity provider setup.',
    paletteKeywords: ['saml', 'oidc', 'identity', 'login', 'auth'],
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
    paletteKeywords: ['soc2', 'gdpr', 'dsar', 'privacy', 'retention', 'evidence', 'regulator'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:audit',
    path: '/audit',
    label: 'Audit Log',
    sectionId: 'workspace',
    iconKey: 'audit',
    requiresFeature: 'audit_log',
    paletteDescription: 'Forensic trail of every admin action with actor + diff.',
    paletteKeywords: ['log', 'history', 'forensic', 'security', 'changes', 'who did what'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:storage',
    path: '/storage',
    label: 'Storage',
    sectionId: 'workspace',
    iconKey: 'storage',
    paletteDescription: 'Bucket usage, screenshot retention, and data-lifecycle policies.',
    paletteKeywords: ['s3', 'bucket', 'screenshots', 'attachments', 'retention', 'lifecycle'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:query',
    path: '/query',
    label: 'Query',
    sectionId: 'workspace',
    iconKey: 'query',
    paletteDescription: 'Run read-only SQL against your project schema.',
    paletteKeywords: ['sql', 'postgres', 'ad-hoc', 'data', 'explorer'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:users',
    path: '/users',
    label: 'Users',
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
    iconKey: 'bolt',
    inSidebar: false,
    paletteDescription: 'Guided verify-and-dispatch setup assistant.',
    paletteKeywords: ['setup', 'copilot', 'verify', 'dispatch', 'guided'],
    paletteGroup: 'Start',
  },
  {
    id: 'nav:cli-auth',
    path: '/cli-auth',
    label: 'CLI auth',
    sectionId: 'act',
    iconKey: 'mcp',
    inSidebar: false,
    paletteDescription: 'OAuth handoff for the Mushi CLI.',
    paletteKeywords: ['cli', 'oauth', 'auth', 'terminal'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:docs-bridge',
    path: '/docs-bridge',
    label: 'Docs bridge',
    sectionId: 'workspace',
    iconKey: 'globe',
    inSidebar: false,
    paletteDescription: 'Open authenticated docs in a new tab.',
    paletteKeywords: ['docs', 'documentation', 'bridge', 'token'],
    paletteGroup: 'Workspace',
  },
  {
    id: 'nav:skills-catalog',
    path: '/skills?tab=catalog',
    label: 'Skill Catalog',
    sectionId: 'act',
    iconKey: 'skills',
    inSidebar: false,
    paletteDescription: 'Browse 70+ cursor-kenji agent skills by category.',
    paletteKeywords: ['catalog', 'skill catalog', 'cursor-kenji', 'kenji skills'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:skills-pipelines',
    path: '/skills?tab=pipelines',
    label: 'Skill Pipelines',
    sectionId: 'act',
    iconKey: 'skills',
    inSidebar: false,
    paletteDescription: 'Track live pipeline runs and check in each step.',
    paletteKeywords: ['pipeline runs', 'handoff', 'context packet', 'checkin'],
    paletteGroup: 'Act',
  },
  {
    id: 'nav:skills-sources',
    path: '/skills?tab=sources',
    label: 'Skill Sources',
    sectionId: 'act',
    iconKey: 'skills',
    inSidebar: false,
    paletteDescription: 'Add GitHub repos and sync SKILL.md files.',
    paletteKeywords: ['skill sources', 'skill sync', 'skills.sh'],
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
  [/^\/content\/[^/]+$/, 'Content QA'],
  [/^\/projects\/[^/]+\/qa-coverage\/[^/]+$/, 'QA Coverage'],
  [/^\/rewards\/tester-review$/, 'Rewards'],
  [/^\/integrations$/, 'Integrations'],
  [/^\/fine-tuning$/, 'Prompt Lab'],
  [/^\/console$/, 'Dashboard'],
  [/^\/mcp\/manual$/, 'MCP'],
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
 * IA decisions (Jun 2026 unification pass):
 * - Check hub: extend `/health?hub=check` (not a new `/check` route) — Health already owns integration telemetry.
 * - Beginner Check core: Judge + Health + QA Coverage stay visible; rest link to CHECK_HUB_PATH.
 * - Nav label: "Action Inbox" in Advanced sidebar; Quickstart palette alias remains "Inbox".
 */
