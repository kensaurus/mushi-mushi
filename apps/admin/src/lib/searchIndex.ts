/**
 * FILE: apps/admin/src/lib/searchIndex.ts
 * PURPOSE: Static index of everything the command palette can navigate to —
 *          every admin route plus hand-picked keyword aliases so the user
 *          can type what they *mean* ("bugs", "pull request", "llm")
 *          instead of the precise page name. Palette matches against the
 *          concatenated `keywords` string via `cmdk`'s built-in scorer.
 *
 *          The index intentionally lives outside `Layout.tsx` so the palette
 *          can load it lazily and the NAV source of truth in Layout stays
 *          free to add UI-only concerns (icons, stages, modes).
 */

export type PaletteGroup = 'Plan' | 'Do' | 'Check' | 'Act' | 'Workspace' | 'Start'

export interface StaticRoute {
  id: string
  label: string
  path: string
  description: string
  group: PaletteGroup
  keywords: string[]
}

export const STATIC_ROUTES: StaticRoute[] = [
  {
    id: 'nav:dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    description: 'Live PDCA loop — bugs in, fixes out, judge scores, shipped impact.',
    group: 'Start',
    keywords: ['home', 'overview', 'kpi', 'metrics', 'loop', 'landing', 'summary'],
  },
  {
    id: 'nav:onboarding',
    label: 'Get started',
    path: '/onboarding',
    description: 'Three-step setup: create a project, install the widget, send a test bug.',
    group: 'Start',
    keywords: ['setup', 'install', 'quickstart', 'first run', 'widget', 'snippet', 'project'],
  },
  {
    id: 'nav:reports',
    label: 'Reports',
    path: '/reports',
    description: 'Triage inbound bug reports — grouped, scored, ranked.',
    group: 'Plan',
    // 'inbox' intentionally removed — the Action Inbox is its own page (/inbox)
    // and was previously stealing palette hits for the literal word "inbox".
    keywords: ['bugs', 'triage', 'complaints', 'issues', 'incidents', 'tickets', 'queue'],
  },
  {
    id: 'nav:inbox',
    label: 'Inbox',
    path: '/inbox',
    description: 'Action inbox — every event awaiting your decision in one place.',
    group: 'Plan',
    keywords: ['inbox', 'action', 'todo', 'queue', 'notifications', 'unread', 'pending'],
  },
  {
    id: 'nav:graph',
    label: 'Graph',
    path: '/graph',
    description: 'Fingerprint graph — dedup clusters and shared root causes.',
    group: 'Plan',
    keywords: ['cluster', 'dedup', 'fingerprint', 'similar bugs', 'network', 'visualisation', 'reactflow'],
  },
  {
    id: 'nav:anti-gaming',
    label: 'Anti-Gaming',
    path: '/anti-gaming',
    description: 'Spam, collusion, and duplicate-submission defences.',
    group: 'Plan',
    keywords: ['spam', 'abuse', 'collusion', 'rate limit', 'fraud', 'dupes'],
  },
  {
    id: 'nav:queue',
    label: 'Queue',
    path: '/queue',
    description: 'Dead-letter queue for ingestion retries and poisoned events.',
    group: 'Plan',
    keywords: ['dlq', 'dead letter', 'retry', 'failures', 'pipeline'],
  },
  {
    id: 'nav:fixes',
    label: 'Fixes',
    path: '/fixes',
    description: 'Drafted pull requests from the auto-fix agent, ready to merge.',
    group: 'Do',
    keywords: ['pull request', 'pr', 'patch', 'diff', 'merge', 'codex', 'llm', 'agent', 'drafts'],
  },
  {
    id: 'nav:repo',
    label: 'Repo',
    path: '/repo',
    description: 'Every auto-fix branch and PR across the connected GitHub repo, with CI status.',
    group: 'Do',
    keywords: [
      'repo', 'repository', 'branch', 'branches', 'git', 'github',
      'pr', 'pull request', 'ci', 'checks', 'merge', 'activity',
    ],
  },
  {
    id: 'nav:prompt-lab',
    label: 'Prompt Lab',
    path: '/prompt-lab',
    description: 'Tune the prompts that turn reports into pull requests.',
    group: 'Do',
    keywords: ['prompt', 'llm', 'model', 'ai', 'tuning', 'evals', 'template', 'system prompt'],
  },
  {
    id: 'nav:judge',
    label: 'Judge',
    path: '/judge',
    description: 'Independent quality grading for the auto-fix output.',
    group: 'Check',
    keywords: ['score', 'eval', 'quality', 'grade', 'verification', 'llm-as-judge'],
  },
  {
    id: 'nav:health',
    label: 'Health',
    path: '/health',
    description: 'System health — uptime, error rates, queue depth, backpressure.',
    group: 'Check',
    keywords: ['status', 'uptime', 'availability', 'sentry', 'slo', 'monitoring', 'incidents'],
  },
  {
    id: 'nav:intelligence',
    label: 'Intelligence',
    path: '/intelligence',
    description: 'Cross-project insights: what fails most, who is impacted.',
    group: 'Check',
    keywords: ['analytics', 'insights', 'trends', 'heatmap', 'cohort'],
  },
  {
    id: 'nav:research',
    label: 'Research',
    path: '/research',
    description: 'Pull external context via Firecrawl to ground fixes in fresh docs.',
    group: 'Check',
    keywords: ['firecrawl', 'web search', 'docs', 'scrape', 'crawl', 'knowledge'],
  },
  {
    id: 'nav:integrations',
    label: 'Integrations',
    path: '/integrations',
    description: 'Connect Slack, Discord, GitHub, Sentry, Stripe, and more.',
    group: 'Act',
    keywords: ['slack', 'discord', 'github', 'sentry', 'stripe', 'webhook', 'connect', 'plug'],
  },
  {
    id: 'nav:mcp',
    label: 'MCP',
    path: '/mcp',
    description: 'Connect Cursor, Claude Desktop, and other MCP agents to this project.',
    group: 'Act',
    keywords: ['mcp', 'claude', 'cursor', 'agent', 'tools', 'context', 'protocol', 'windsurf'],
  },
  {
    id: 'nav:marketplace',
    label: 'Marketplace',
    path: '/marketplace',
    description: 'Pre-built recipes and templates for common flows.',
    group: 'Act',
    keywords: ['recipes', 'templates', 'install', 'plugins'],
  },
  {
    id: 'nav:notifications',
    label: 'Notifications',
    path: '/notifications',
    description: 'Route events to Slack, email, or Discord with per-stage rules.',
    group: 'Act',
    keywords: ['alerts', 'email', 'slack', 'discord', 'routing', 'rules', 'digest'],
  },
  {
    id: 'nav:projects',
    label: 'Projects',
    path: '/projects',
    description: 'Create, archive, and manage projects and members.',
    group: 'Workspace',
    keywords: ['team', 'members', 'create project', 'organisation', 'workspace'],
  },
  {
    id: 'nav:settings',
    label: 'Settings',
    path: '/settings',
    description: 'Project configuration, API keys, Firecrawl, theming.',
    group: 'Workspace',
    keywords: ['config', 'api key', 'preferences', 'firecrawl', 'theme', 'branding'],
  },
  {
    id: 'nav:sso',
    label: 'SSO',
    path: '/sso',
    description: 'Single sign-on, SAML, and identity provider setup.',
    group: 'Workspace',
    keywords: ['saml', 'oidc', 'identity', 'login', 'auth'],
  },
  {
    id: 'nav:billing',
    label: 'Billing',
    path: '/billing',
    description: 'Plan, seats, invoices, and usage-based charges.',
    group: 'Workspace',
    keywords: ['stripe', 'plan', 'invoice', 'seats', 'usage', 'subscription', 'upgrade'],
  },
  {
    id: 'nav:audit',
    label: 'Audit Log',
    path: '/audit',
    description: 'Forensic trail of every admin action with actor + diff.',
    group: 'Workspace',
    keywords: ['log', 'history', 'forensic', 'security', 'changes', 'who did what'],
  },
  {
    id: 'nav:compliance',
    label: 'Compliance',
    path: '/compliance',
    description: 'SOC 2, GDPR, and DSAR — evidence bundles and retention rules.',
    group: 'Workspace',
    keywords: ['soc2', 'gdpr', 'dsar', 'privacy', 'retention', 'evidence', 'regulator'],
  },
  {
    id: 'nav:storage',
    label: 'Storage',
    path: '/storage',
    description: 'Bucket usage, screenshot retention, and data-lifecycle policies.',
    group: 'Workspace',
    keywords: ['s3', 'bucket', 'screenshots', 'attachments', 'retention', 'lifecycle'],
  },
  {
    id: 'nav:query',
    label: 'Query',
    path: '/query',
    description: 'Run read-only SQL against your project schema.',
    group: 'Workspace',
    keywords: ['sql', 'postgres', 'ad-hoc', 'data', 'explorer'],
  },
]

/**
 * Pre-computed lowercase search haystack per route. `cmdk` already scores
 * against the `value` prop it receives, but we concatenate label + keywords
 * + description + group so an alias hit ranks equal to a label hit. This
 * keeps the matching behaviour identical to a well-tuned full-text index
 * without pulling one in.
 */
export function routeHaystack(r: StaticRoute): string {
  return [r.label, r.group, r.description, ...r.keywords].join(' ').toLowerCase()
}
