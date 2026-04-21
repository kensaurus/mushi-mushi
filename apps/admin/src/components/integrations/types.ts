/**
 * FILE: apps/admin/src/components/integrations/types.ts
 * PURPOSE: Static metadata + shared types for the IntegrationsPage. Keeping
 *          the field defs out of the page lets us evolve copy without
 *          touching orchestration.
 */

export type Kind = 'sentry' | 'langfuse' | 'github'

export interface PlatformResponse {
  platform: Record<Kind, Record<string, unknown>>
}

export interface HealthRow {
  id: string
  kind: string
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  latency_ms: number | null
  message: string | null
  source: string
  checked_at: string
}

export interface PlatformFieldDef {
  name: string
  label: string
  placeholder: string
  type?: 'text' | 'password' | 'url'
  help: string
  required?: boolean
}

export interface PlatformDef {
  kind: Kind
  label: string
  whyItMatters: string
  /**
   * Concrete capabilities the platform unlocks once configured. Rendered as a
   * tight bullet list under whyItMatters so the user can see "what do I get
   * for connecting this?" before they hand over a token. .
   */
  capabilitiesOnceConnected: string[]
  fields: PlatformFieldDef[]
}

export interface RoutingProviderDef {
  type: 'jira' | 'linear' | 'github' | 'pagerduty'
  label: string
  whyItMatters: string
  capabilitiesOnceConnected: string[]
  fields: PlatformFieldDef[]
}

export interface RoutingIntegration {
  id: string
  integration_type: string
  config: Record<string, unknown>
  is_active: boolean
  last_synced_at: string | null
}

export const PLATFORM_STATUS_MAP: Record<HealthRow['status'], string | null | undefined> = {
  ok: 'ok',
  degraded: 'degraded',
  down: 'down',
  unknown: undefined,
}

export const PLATFORM_DEFS: PlatformDef[] = [
  {
    kind: 'sentry',
    label: 'Sentry',
    whyItMatters: 'Pulls Seer root-cause analysis into your reports and lets the LLM cross-reference production errors with user feedback. Wire the webhook to mirror Sentry user feedback into Mushi.',
    capabilitiesOnceConnected: [
      'Auto-attach matching Sentry events (stack trace + breadcrumbs) to each report',
      'Include Seer root-cause hints in the classifier prompt',
      'Mirror Sentry user-feedback submissions into the report queue',
    ],
    fields: [
      { name: 'sentry_org_slug', label: 'Org slug', placeholder: 'my-company', help: 'Your Sentry organization slug — visible in the Sentry URL after sentry.io/organizations/.', required: true },
      { name: 'sentry_project_slug', label: 'Project slug', placeholder: 'web-app', help: 'The specific Sentry project for this codebase.' },
      { name: 'sentry_auth_token_ref', label: 'Auth token', placeholder: 'sntrys_xxx (or vault://id)', type: 'password', help: 'User-level auth token with project:read + event:read scope. Create at sentry.io/settings/account/api/auth-tokens/.', required: true },
      { name: 'sentry_dsn', label: 'DSN (optional)', placeholder: 'https://abc@o0.ingest.sentry.io/0', help: 'DSN for the SDK to send events. Only needed if you want Mushi reports forwarded as Sentry events.' },
      { name: 'sentry_webhook_secret', label: 'Webhook secret', placeholder: 'shared-secret', type: 'password', help: 'HMAC secret. Configure the same value in Sentry → Settings → Webhooks for inbound user-feedback mirroring.' },
    ],
  },
  {
    kind: 'langfuse',
    label: 'Langfuse',
    whyItMatters: 'Every LLM call (Stage 1 classify, Stage 2 vision, fix-worker) emits a trace. Click any trace from a report or fix attempt to see the exact prompt + response + token cost.',
    capabilitiesOnceConnected: [
      'One-click trace links on every classification, judge run, and fix attempt',
      'Per-call cost + latency surfaced in /health and /billing',
      'Replay any failing prompt against a different model from the Prompt Lab',
    ],
    fields: [
      { name: 'langfuse_host', label: 'Host', placeholder: 'https://cloud.langfuse.com', type: 'url', help: 'Cloud or self-hosted Langfuse base URL (no trailing slash).', required: true },
      { name: 'langfuse_public_key_ref', label: 'Public key', placeholder: 'pk-lf-… (or vault://id)', type: 'password', help: 'Langfuse public key. From Project Settings → API Keys.', required: true },
      { name: 'langfuse_secret_key_ref', label: 'Secret key', placeholder: 'sk-lf-… (or vault://id)', type: 'password', help: 'Langfuse secret key. Pairs with the public key above for HTTP Basic auth.', required: true },
    ],
  },
  {
    kind: 'github',
    label: 'GitHub (code repo)',
    whyItMatters: 'The fix-worker creates draft PRs against this repo. Add a webhook secret to sync CI check-runs back into the Auto-Fix Pipeline so reviewers see green/red without leaving Mushi.',
    capabilitiesOnceConnected: [
      'Dispatch auto-fix attempts that open draft PRs on a feature branch',
      'CI check-run conclusions sync back into the Fix card (PR open / CI passing / failing)',
      'Pre-emptive code-context retrieval so the fix prompt has the surrounding lines',
    ],
    fields: [
      { name: 'github_repo_url', label: 'Repo URL', placeholder: 'https://github.com/owner/repo', type: 'url', help: 'Full HTTPS URL to the repo Mushi should patch. SSH URLs are normalized server-side.', required: true },
      { name: 'github_default_branch', label: 'Default branch', placeholder: 'main', help: 'Defaults to "main" if blank. Change for repos that branch from "master" or "develop".' },
      { name: 'github_installation_token_ref', label: 'Installation token', placeholder: 'ghs_… or ghp_… (or vault://id)', type: 'password', help: 'GitHub App installation token (preferred) or fine-grained PAT. Needs Contents:write + Pull requests:write.', required: true },
      { name: 'github_webhook_secret', label: 'Webhook secret', placeholder: 'shared-secret', type: 'password', help: 'HMAC secret. Set the same value in GitHub repo Settings → Webhooks (events: Check runs, Check suites).' },
    ],
  },
]

export const ROUTING_PROVIDERS: RoutingProviderDef[] = [
  {
    type: 'jira',
    label: 'Jira',
    whyItMatters: 'Triaged reports become Jira tickets in the project of your choice. Severity maps to Jira priority.',
    capabilitiesOnceConnected: [
      'Auto-create Jira issues for high-severity reports',
      'Map Mushi severity to Jira priority + status transitions',
      'Two-way link: closing the Jira issue resolves the Mushi report',
    ],
    fields: [
      { name: 'baseUrl', label: 'Base URL', placeholder: 'https://acme.atlassian.net', type: 'url', help: 'Your Atlassian Cloud or Server base URL.', required: true },
      { name: 'email', label: 'User email', placeholder: 'bot@acme.com', help: 'Email of the Jira user owning the API token.', required: true },
      { name: 'apiToken', label: 'API token', placeholder: 'ATATT3xFf...', type: 'password', help: 'Create at id.atlassian.com → Security → API tokens.', required: true },
      { name: 'projectKey', label: 'Project key', placeholder: 'BUG', help: 'Short uppercase code prefixing every issue (e.g. BUG-123).', required: true },
    ],
  },
  {
    type: 'linear',
    label: 'Linear',
    whyItMatters: 'Mirror reports into Linear with proper labels and priorities. Classification metadata maps to Linear labels.',
    capabilitiesOnceConnected: [
      'Mirror reports as Linear issues with severity-mapped priority',
      'Apply category labels automatically (bug, regression, ux, etc.)',
      'Link the Linear issue back into the report for round-trip context',
    ],
    fields: [
      { name: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', help: 'Personal API key from Linear → Settings → API.', required: true },
      { name: 'teamId', label: 'Team ID', placeholder: 'TEAM-uuid', help: 'UUID of the Linear team that should receive issues.', required: true },
    ],
  },
  {
    type: 'github',
    label: 'GitHub Issues',
    whyItMatters: 'Open GitHub Issues directly in your repo. Different repo than the auto-fix code repo — this is for tracking, not patching.',
    capabilitiesOnceConnected: [
      'Open GitHub Issues with severity + category as labels',
      'Public issue tracker option (separate repo from the code repo)',
      'Closes the issue automatically when the linked report is resolved',
    ],
    fields: [
      { name: 'token', label: 'Personal access token', placeholder: 'ghp_...', type: 'password', help: 'Fine-grained PAT with Issues:write on the target repo.', required: true },
      { name: 'owner', label: 'Owner', placeholder: 'acme', help: 'Org or user that owns the repo.', required: true },
      { name: 'repo', label: 'Repo', placeholder: 'public-tracker', help: 'Repository name (no owner prefix).', required: true },
    ],
  },
  {
    type: 'pagerduty',
    label: 'PagerDuty',
    whyItMatters: 'Page on-call when severity ≥ critical. Routes through Events API v2.',
    capabilitiesOnceConnected: [
      'Page the on-call when severity = critical',
      'De-dupes incidents per fingerprint to avoid alert storms',
      'Auto-resolve the incident when the linked report is closed',
    ],
    fields: [
      { name: 'routingKey', label: 'Routing key', placeholder: '32-char integration key', type: 'password', help: 'Events API v2 integration key from PagerDuty service.', required: true },
    ],
  },
]
