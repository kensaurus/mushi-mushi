/**
 * Maps each admin docs slug to its showcase asset under /screenshots/.
 * Synced from docs/screenshots/ via scripts/sync-docs-screenshots.mjs.
 */

export interface AdminScreenshotEntry {
  /** Filename inside public/screenshots/ (dark variant for admin — dark-only UI). */
  image: string
  /** Optional light-mode pair for pages that ship both themes. */
  light?: string
  /** Optional animated demo (GIF). */
  gif?: string
  alt: string
  caption: string
  /** Live admin route suffix — joined with ADMIN_DEMO_BASE. */
  route: string
}

export const ADMIN_DEMO_BASE = 'https://kensaur.us/mushi-mushi/admin'

/** Shared SDK dogfood tour — recorded on glot.it (kensaur.us/glot-it). */
export const GLOTIT_DEMO_URL = 'https://kensaur.us/glot-it'

export const ADMIN_SCREENSHOTS: Record<string, AdminScreenshotEntry> = {
  index: {
    image: 'dashboard-dark.png',
    gif: 'tour-pdca-loop.gif',
    alt: 'Mushi admin console — animated walk through the Plan → Do → Check → Act loop',
    caption: 'Live admin demo · 4-stop PDCA tour',
    route: '/dashboard',
  },
  dashboard: {
    image: 'dashboard-dark.png',
    light: 'dashboard-light.png',
    gif: 'dashboard-demo.gif',
    alt: 'Dashboard — PDCA cockpit with KPI tiles, severity histogram, and triage queue',
    caption: 'Morning check in 30 seconds — backlog, in-flight fixes, LLM cost',
    route: '/dashboard',
  },
  onboarding: {
    image: 'onboarding-dark.png',
    alt: 'Plug-n-play onboarding wizard with PDCA storyboard',
    caption: 'Plan → Do → Check → Act storyboard before the checklist',
    route: '/onboarding',
  },
  projects: {
    image: 'projects-dark.png',
    alt: 'Projects page — per-project cards with key and report counts',
    caption: 'Multi-project workspace with inline test-report CTAs',
    route: '/projects',
  },
  inbox: {
    image: 'inbox-dark.png',
    alt: 'Action inbox grouped by PDCA stage',
    caption: 'One primary CTA per stage — what to do next',
    route: '/inbox',
  },
  reports: {
    image: 'reports-dark.png',
    gif: 'glotit-report-flow.gif',
    alt: 'Reports triage queue with severity stripes and dispatch actions',
    caption: 'User-felt bugs from glot.it land here with screenshot + breadcrumbs',
    route: '/reports',
  },
  graph: {
    image: 'graph-dark.png',
    light: 'graph-light.png',
    alt: 'Knowledge graph — bug incidence adjacency with Graph / Surface / Table tabs',
    caption: 'Bug graph · Surface overlays inventory.yaml on the same canvas',
    route: '/graph',
  },
  lessons: {
    image: 'graph-dark.png',
    alt: 'Lessons — vector-clustered mistake DB promoted to .mushi/lessons.json',
    caption: 'Coherent clusters become named rules the next PR inherits',
    route: '/lessons',
  },
  inventory: {
    image: 'inventory-dark.png',
    light: 'inventory-light.png',
    alt: 'User stories · Inventory — verified / unwired / regressed action counts',
    caption: 'Positive-side contract — gates fail when drafts diverge',
    route: '/inventory',
  },
  'anti-gaming': {
    image: 'anti-gaming-dark.png',
    alt: 'Anti-gaming dashboard — flagged devices and velocity rules',
    caption: 'Per-device fingerprint tracker with audit trail',
    route: '/anti-gaming',
  },
  fixes: {
    image: 'fixes-dark.png',
    alt: 'Fix orchestrator — per-attempt PDCA cards and PR links',
    caption: 'Agent runs stream live · Langfuse trace per attempt',
    route: '/fixes',
  },
  repo: {
    image: 'repo-dark.png',
    alt: 'Repo graph — branches grouped by CI status with live activity stream',
    caption: 'One branch per auto-fix attempt',
    route: '/repo',
  },
  'prompt-lab': {
    image: 'prompt-lab-dark.png',
    alt: 'Prompt Lab — Stage 1 / Stage 2 version tables and fine-tuning jobs',
    caption: 'A/B traffic split between active and candidate prompts',
    route: '/prompt-lab',
  },
  releases: {
    image: 'fixes-dark.png',
    alt: 'Releases — AI-drafted changelogs with reporter attribution',
    caption: 'Beta users get a toast when their report ships',
    route: '/releases',
  },
  judge: {
    image: 'judge-dark.png',
    alt: 'Judge dashboard — 12-week score trend and prompt leaderboard',
    caption: 'Decide / Act / Verify hero over classification quality',
    route: '/judge',
  },
  health: {
    image: 'health-dark.png',
    alt: 'Integration health — per-function LLM cost and latency breakdown',
    caption: 'Real cost_usd per call with Langfuse deeplinks',
    route: '/health',
  },
  'qa-coverage': {
    image: 'reports-dark.png',
    gif: 'glotit-report-flow.gif',
    alt: 'QA Coverage — scheduled user-story tests with Firecrawl / Browserbase',
    caption: 'Dogfood glot.it flows as regression guards on cron',
    route: '/qa-coverage',
  },
  intelligence: {
    image: 'intelligence-dark.png',
    alt: 'Intelligence reports — weekly AI-generated bug digest',
    caption: 'Decide surfaces the one-liner · Verify deeplinks to evidence',
    route: '/intelligence',
  },
  research: {
    image: 'research-dark.png',
    alt: 'Research notes — Firecrawl-powered findings pinned for the next loop',
    caption: 'Pin QA + product findings so the next iteration starts smarter',
    route: '/research',
  },
  anomalies: {
    image: 'health-dark.png',
    alt: 'Anomaly detection — STL + Page-Hinkley on inbound adapter metrics',
    caption: 'Confirmed regressions auto-open reports',
    route: '/anomalies',
  },
  experiments: {
    image: 'judge-dark.png',
    alt: 'Experiments — sticky A/B assignments with CUPED analysis',
    caption: 'mSPRT analysis with SRM alarms',
    route: '/experiments',
  },
  iterate: {
    image: 'intelligence-dark.png',
    gif: 'tour-pdca-loop.gif',
    alt: 'Iterate (PDCA) — producer/critic loop with selectable personas',
    caption: 'Live progress + draft-PR exit',
    route: '/iterate',
  },
  drift: {
    image: 'inventory-dark.png',
    alt: 'Drift scanner — live app vs contract snapshot',
    caption: 'Stagehand walker compares inventory + OpenAPI + DB schema',
    route: '/drift',
  },
  settings: {
    image: 'settings-dark.png',
    alt: 'Settings — BYOK keys, SDK config, dedup thresholds',
    caption: 'Five tabs covering Slack, Sentry, LLM pipeline, dedup',
    route: '/settings',
  },
  storage: {
    image: 'storage-dark.png',
    alt: 'BYO storage — per-project S3 / R2 / GCS bucket form',
    caption: 'Vault-ref access keys — never plaintext',
    route: '/storage',
  },
  integrations: {
    image: 'integrations-dark.png',
    alt: 'Integrations — Sentry / Langfuse / GitHub health probes',
    caption: 'Last-probe latency + codebase indexing status',
    route: '/integrations',
  },
  marketplace: {
    image: 'marketplace-dark.png',
    alt: 'Plugin marketplace — available and installed outbound plugins',
    caption: 'HMAC-signed webhooks per plugin',
    route: '/marketplace',
  },
  mcp: {
    image: 'mcp-dark.png',
    alt: 'MCP — Model Context Protocol install snippet and tool catalog',
    caption: '13-tool catalog · pre-filled .cursor/mcp.json',
    route: '/mcp',
  },
  notifications: {
    image: 'notifications-dark.png',
    alt: 'Reporter notifications — outbound messages to bug reporters',
    caption: 'Show payload reveals exact JSON the SDK delivered',
    route: '/notifications',
  },
  cost: {
    image: 'health-dark.png',
    alt: 'Cost — LLM spend breakdown across pipelines',
    caption: 'Clustering, judging, PDCA, drift, anomaly pipelines',
    route: '/cost',
  },
  rewards: {
    image: 'billing-dark.png',
    alt: 'Rewards program — point rules and contributor leaderboard',
    caption: 'Reporter attribution closes the feedback loop',
    route: '/rewards',
  },
  query: {
    image: 'query-dark.png',
    alt: 'Ask Your Data — natural-language SQL over bug data',
    caption: 'Read-only Postgres with saved queries sidebar',
    route: '/query',
  },
  'fine-tuning': {
    image: 'prompt-lab-dark.png',
    alt: 'Fine-tuning — export, train, promote a classifier',
    caption: 'Fine-tuning jobs queue beside prompt versions',
    route: '/prompt-lab',
  },
  realtime: {
    image: 'reports-dark.png',
    alt: 'Real-time collaboration — live presence on reports',
    caption: 'Threaded comments without leaving triage',
    route: '/realtime',
  },
  'sdk-health': {
    image: 'projects-dark.png',
    gif: 'glotit-report-flow.gif',
    alt: 'SDK health — per-runtime heartbeat and version alerts',
    caption: 'glot.it dogfood project — web + React Native heartbeats',
    route: '/sdk-health',
  },
  teams: {
    image: 'projects-dark.png',
    alt: 'Organization members — roster, invite, role management',
    caption: 'Invite teammates after the first fix lands',
    route: '/organization/members',
  },
  sso: {
    image: 'sso-dark.png',
    alt: 'SSO configuration — SAML 2.0 and OIDC identity providers',
    caption: 'JIT provisioning on first login',
    route: '/sso',
  },
  audit: {
    image: 'audit-dark.png',
    alt: 'Audit log — append-only mutation history',
    caption: 'Export CSV for the next SOC 2 review',
    route: '/audit',
  },
  compliance: {
    image: 'compliance-dark.png',
    alt: 'Compliance — SOC 2 evidence and data residency',
    caption: 'PASS / WARN pills with inline JSON evidence',
    route: '/compliance',
  },
  billing: {
    image: 'billing-dark.png',
    alt: 'Billing — plan comparison and usage forecast',
    caption: 'Stripe-metered LLM spend per day',
    route: '/billing',
  },
  users: {
    image: 'audit-dark.png',
    alt: 'Users (operator) — all signups, MRR, churn',
    caption: 'Operator-only surface',
    route: '/users',
  },
  'docs-bridge': {
    image: 'mcp-dark.png',
    alt: 'Docs bridge — silent auth relay for the docs site',
    caption: 'Not for direct use — powers docs ↔ admin SSO',
    route: '/docs-bridge',
  },
  explore: {
    image: 'graph-dark.png',
    alt: 'Codebase Atlas — ReactFlow graph coloured by architectural layer',
    caption: 'Semantic search over vector embeddings of indexed files',
    route: '/explore',
  },
  queue: {
    image: 'queue-dark.png',
    alt: 'Processing queue — dead-letter viewer with retry actions',
    caption: 'worker_jobs with 14d throughput histogram',
    route: '/queue',
  },
}
