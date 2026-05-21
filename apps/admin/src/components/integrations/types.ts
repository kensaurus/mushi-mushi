/**
 * FILE: apps/admin/src/components/integrations/types.ts
 * PURPOSE: Static metadata + shared types for the IntegrationsPage. Keeping
 *          the field defs out of the page lets us evolve copy without
 *          touching orchestration.
 */

import type { ComponentType } from 'react'
import {
  IconSentry,
  IconLangfuse,
  IconGithub,
  IconCursorCloud,
  IconClaudeCode,
  IconJira,
  IconLinear,
  IconPagerDuty,
} from '../icons'

/** Narrow union for *platform* integrations — the SDK-feeding services
 *  (Sentry / Langfuse / GitHub code-repo) that have first-class card slots
 *  on the page. Kept narrow so `Record<Kind, …>` literals stay exhaustive. */
export type Kind = 'sentry' | 'langfuse' | 'github' | 'cursor_cloud' | 'claude_code_agent'

/** Wider union accepted by the `/v1/admin/health/integration/:kind` probe
 *  route. Includes the four routing destinations (Jira / Linear /
 *  GitHub Issues / PagerDuty) so a single Test button on a routing card can
 *  reuse the same probe endpoint. */
export type ProbeKind = Kind | 'jira' | 'linear' | 'github_issues' | 'pagerduty'

export interface PlatformResponse {
  platform: Partial<Record<Kind, Record<string, unknown>>>
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

/** Named validator picked by the card at render time. Kept as a string
 *  union (rather than a function reference) so this types module stays
 *  pure data — easy to serialise, easy to snapshot-test, and cheap for the
 *  card to look up via `resolveValidator()` in `lib/validators.ts`. */
export type FieldValidatorName =
  | 'url'
  | 'httpsUrl'
  | 'email'
  | 'sentryDsn'
  | 'slug'
  | 'token'
  | 'tokenLong'
  | 'jiraProjectKey'
  | 'githubRepoUrl'
  | 'pagerdutyRoutingKey'

export interface PlatformFieldDef {
  name: string
  label: string
  placeholder: string
  type?: 'text' | 'password' | 'url'
  help: string
  required?: boolean
  /** Optional id into `apps/admin/src/lib/configDocs.ts`. When set, the
   *  per-field input renders the rich `<ConfigHelp>` popover next to the
   *  label in addition to the short `help` hover-string. */
  helpId?: string
  /** Named validator from `lib/validators.ts`. Card resolves this to a
   *  real validator function. Empty / undefined = no validation. */
  validator?: FieldValidatorName
}

export interface PlatformDef {
  kind: Kind
  label: string
  whyItMatters: string
  /**
   * Concrete capabilities the platform unlocks once configured. Rendered as a
   * tight bullet list under whyItMatters so the user can see "what do I get
   * for connecting this?" before they hand over a token.
   */
  capabilitiesOnceConnected: string[]
  fields: PlatformFieldDef[]
  /** Icon component (from icons.tsx) to render in the card header. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic icon component type
  Icon: ComponentType<any>
  /** Tailwind text color class for the service brand tint. */
  color: string
  /** Domain used to fetch the real brand favicon via Google's favicon CDN.
   *  e.g. "sentry.io", "langfuse.com" */
  domain: string
  /** URL to open when the user clicks the external link icon. */
  externalUrl: string
  /** Documentation/setup URL shown in the card when not configured. */
  docsUrl?: string
  /** Direct link to the vendor console where credentials are created. */
  consoleUrl?: string
  /** Label for the console link button (defaults to "Open console"). */
  consoleLabel?: string
  /** Numbered steps shown before / during configuration. */
  setupSteps?: string[]
}

export interface RoutingProviderDef {
  type: 'jira' | 'linear' | 'github' | 'pagerduty'
  /** The kind key used in integration_health_history. 'github' routing maps to
   *  'github_issues' to avoid colliding with the platform GitHub (code-repo). */
  healthKind: 'jira' | 'linear' | 'github_issues' | 'pagerduty'
  label: string
  whyItMatters: string
  capabilitiesOnceConnected: string[]
  fields: PlatformFieldDef[]
  /** Icon component (from icons.tsx) to render in the card header. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic icon component type
  Icon: ComponentType<any>
  /** Tailwind text color class for the service brand tint. */
  color: string
  /** Domain used to fetch the real brand favicon via Google's favicon CDN.
   *  e.g. "atlassian.com", "linear.app" */
  domain: string
  /** URL to open when the user clicks the external link icon. */
  externalUrl: string
}

export interface RoutingIntegration {
  id: string
  integration_type: string
  config: Record<string, unknown>
  is_active: boolean
  last_synced_at: string | null
}

export interface IntegrationStats {
  hasAnyProject?: boolean
  projectId?: string | null
  projectName?: string | null
  platformTotal: number
  platformConnected: number
  platformHealthy: number
  platformDown: number
  routingActive: number
  routingPaused: number
  routingTotal: number
  lastProbeAt: string | null
  topPriority?: IntegrationTopPriority
  topPriorityLabel?: string | null
  topPriorityTo?: string | null
}

export type IntegrationTopPriority =
  | 'no_project'
  | 'platform_down'
  | 'incomplete'
  | 'empty'
  | 'healthy'

export const EMPTY_INTEGRATION_STATS: IntegrationStats = {
  platformTotal: 5,
  platformConnected: 0,
  platformHealthy: 0,
  platformDown: 0,
  routingActive: 0,
  routingPaused: 0,
  routingTotal: 0,
  lastProbeAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
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
    Icon: IconSentry,
    color: 'text-[#7B5EA7]',
    domain: 'sentry.io',
    externalUrl: 'https://sentry.io',
    docsUrl: 'https://docs.sentry.io/api/auth/',
    consoleUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    consoleLabel: 'Create Sentry auth token',
    setupSteps: [
      'Open Sentry → Settings → Account → Auth Tokens → Create New Token.',
      'Grant at least project:read and event:read scopes.',
      'Copy the org slug from your Sentry URL: sentry.io/organizations/{org-slug}/.',
      'Paste org slug + token below, then Save → Test connection.',
    ],
    whyItMatters: 'Pulls Seer root-cause analysis into your reports and lets the LLM cross-reference production errors with user feedback. Wire the webhook to mirror Sentry user feedback into Mushi.',
    capabilitiesOnceConnected: [
      'Auto-attach matching Sentry events (stack trace + breadcrumbs) to each report',
      'Include Seer root-cause hints in the classifier prompt',
      'Mirror Sentry user-feedback submissions into the report queue',
    ],
    fields: [
      { name: 'sentry_org_slug', label: 'Org slug', placeholder: 'my-company', help: 'The segment after sentry.io/organizations/ in your Sentry URL.', required: true, helpId: 'integrations.sentry.org_slug', validator: 'slug' },
      { name: 'sentry_project_slug', label: 'Project slug', placeholder: 'web-app', help: 'Optional — narrows event search to one project (faster enrichment).', helpId: 'integrations.sentry.project_slug', validator: 'slug' },
      { name: 'sentry_auth_token_ref', label: 'Auth token', placeholder: 'sntrys_… or sntryu_… (or vault://id)', type: 'password', help: 'User auth token with project:read + event:read. Create at sentry.io/settings/account/api/auth-tokens/.', required: true, helpId: 'integrations.sentry.auth_token', validator: 'token' },
      { name: 'sentry_dsn', label: 'DSN (optional)', placeholder: 'https://abc@o0.ingest.sentry.io/0', help: 'DSN for the SDK to send events. Only needed if you want Mushi reports forwarded as Sentry events.', helpId: 'settings.general.sentry_dsn', validator: 'sentryDsn' },
      { name: 'sentry_webhook_secret', label: 'Webhook secret', placeholder: 'shared-secret', type: 'password', help: 'HMAC secret. Configure the same value in Sentry → Settings → Webhooks for inbound user-feedback mirroring.', helpId: 'settings.general.sentry_webhook_secret', validator: 'token' },
    ],
  },
  {
    kind: 'langfuse',
    label: 'Langfuse',
    Icon: IconLangfuse,
    color: 'text-[#00A67E]',
    domain: 'langfuse.com',
    externalUrl: 'https://cloud.langfuse.com',
    docsUrl: 'https://langfuse.com/docs/get-started',
    consoleUrl: 'https://cloud.langfuse.com',
    consoleLabel: 'Open Langfuse',
    setupSteps: [
      'Sign in to Langfuse (cloud.langfuse.com or us.cloud.langfuse.com for US region).',
      'Open your project → Settings → API Keys → Create new key pair.',
      'Copy the public key (pk-lf-…) and secret key (sk-lf-…).',
      'Paste host + both keys below. US cloud host: https://us.cloud.langfuse.com',
    ],
    whyItMatters: 'Every LLM call (Stage 1 classify, Stage 2 vision, fix-worker) emits a trace. Click any trace from a report or fix attempt to see the exact prompt + response + token cost.',
    capabilitiesOnceConnected: [
      'One-click trace links on every classification, judge run, and fix attempt',
      'Per-call cost + latency surfaced in /health and /billing',
      'Replay any failing prompt against a different model from the Prompt Lab',
    ],
    fields: [
      { name: 'langfuse_host', label: 'Host', placeholder: 'https://us.cloud.langfuse.com', type: 'url', help: 'Langfuse base URL — US cloud: https://us.cloud.langfuse.com, EU: https://cloud.langfuse.com', required: true, helpId: 'integrations.langfuse.host', validator: 'httpsUrl' },
      { name: 'langfuse_public_key_ref', label: 'Public key', placeholder: 'pk-lf-… (or vault://id)', type: 'password', help: 'From Langfuse → Project Settings → API Keys.', required: true, helpId: 'integrations.langfuse.public_key', validator: 'token' },
      { name: 'langfuse_secret_key_ref', label: 'Secret key', placeholder: 'sk-lf-… (or vault://id)', type: 'password', help: 'Secret half of the API key pair — never share publicly.', required: true, helpId: 'integrations.langfuse.secret_key', validator: 'token' },
    ],
  },
  {
    kind: 'github',
    label: 'GitHub (code repo)',
    Icon: IconGithub,
    color: 'text-fg',
    domain: 'github.com',
    externalUrl: 'https://github.com',
    docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    consoleUrl: 'https://github.com/settings/tokens?type=beta',
    consoleLabel: 'Create GitHub PAT',
    setupSteps: [
      'Create a fine-grained PAT at github.com/settings/tokens?type=beta.',
      'Grant Contents: Read and write + Pull requests: Read and write on the target repo.',
      'Paste the full repo URL (https://github.com/owner/repo) and the token below.',
      'Optional: add a webhook secret so CI check-runs sync back to Fix cards.',
    ],
    whyItMatters: 'The fix-worker creates draft PRs against this repo. Add a webhook secret to sync CI check-runs back into the Auto-Fix Pipeline so reviewers see green/red without leaving Mushi.',
    capabilitiesOnceConnected: [
      'Dispatch auto-fix attempts that open draft PRs on a feature branch',
      'CI check-run conclusions sync back into the Fix card (PR open / CI passing / failing)',
      'Pre-emptive code-context retrieval so the fix prompt has the surrounding lines',
    ],
    fields: [
      { name: 'github_repo_url', label: 'Repo URL', placeholder: 'https://github.com/owner/repo', type: 'url', help: 'Full HTTPS URL to the repo Mushi should patch. SSH URLs are normalized server-side.', required: true, helpId: 'integrations.github.repo_url', validator: 'githubRepoUrl' },
      { name: 'github_default_branch', label: 'Default branch', placeholder: 'main', help: 'Defaults to "main" if blank. Change for repos that branch from "master" or "develop".', helpId: 'integrations.github.default_branch' },
      { name: 'github_installation_token_ref', label: 'Installation token', placeholder: 'ghs_… or ghp_… (or vault://id)', type: 'password', help: 'GitHub App installation token (preferred) or fine-grained PAT. Needs Contents:write + Pull requests:write.', required: true, helpId: 'integrations.github.installation_token', validator: 'token' },
      { name: 'github_webhook_secret', label: 'Webhook secret', placeholder: 'shared-secret', type: 'password', help: 'HMAC secret. Set the same value in GitHub repo Settings → Webhooks (events: Check runs, Check suites).', helpId: 'integrations.github.webhook_secret', validator: 'token' },
    ],
  },
  {
    kind: 'cursor_cloud',
    label: 'Cursor Cloud',
    Icon: IconCursorCloud,
    color: 'text-[#0066FF]',
    domain: 'cursor.com',
    externalUrl: 'https://cursor.com/dashboard/integrations',
    docsUrl: 'https://cursor.com/docs/cloud-agent/api/endpoints',
    consoleUrl: 'https://cursor.com/dashboard/integrations',
    consoleLabel: 'Create Cursor API key',
    setupSteps: [
      'Open cursor.com/dashboard/integrations → API Keys → Create.',
      'Copy the crsr_… key and paste it in the API Key field below.',
      'Connect GitHub in the GitHub card first — Cursor agents need a repo URL + token.',
      'Click Save → Test connection. Then use ◆ Send to Cursor on any report.',
    ],
    whyItMatters: 'When a critical report is classified, Mushi dispatches a Cursor Cloud Agent that opens a signed draft PR against your repo automatically. No manual triage required.',
    capabilitiesOnceConnected: [
      'Auto-dispatch a Cursor agent when severity ≥ critical',
      'Cursor opens a signed draft PR — visible in the Fix card timeline',
      'Agent screenshots, logs, and run artifacts surfaced directly in Mushi',
      'Use "Send to Cursor" from any report to trigger on-demand',
    ],
    fields: [
      { name: 'cursor_api_key_ref', label: 'API Key', placeholder: 'crsr_… (or vault://id)', type: 'password', help: 'Create at cursor.com/dashboard/integrations → API Keys.', required: true, helpId: 'integrations.cursor_cloud.api_key', validator: 'token' },
      { name: 'cursor_default_model', label: 'Default model', placeholder: 'composer-2.5', help: 'Optional Cursor model slug. Leave blank to use your account default.', helpId: 'integrations.cursor_cloud.default_model' },
      { name: 'cursor_auto_create_pr', label: 'Auto-create PRs', placeholder: 'true', help: 'When enabled (default), Cursor automatically opens a signed draft PR when the agent finishes. Disable to review the branch first.', helpId: 'integrations.cursor_cloud.auto_create_pr' },
      { name: 'cursor_max_iterations', label: 'Max iterations', placeholder: '1', help: 'How many agent iterations Cursor runs per dispatch (1–10). Higher values cost more API credit but can recover from a first-pass miss.', helpId: 'integrations.cursor_cloud.max_iterations' },
    ],
  },
  {
    kind: 'claude_code_agent',
    label: 'Claude Code Agent',
    Icon: IconClaudeCode,
    color: 'text-[#d97706]',
    domain: 'anthropic.com',
    externalUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/github-actions',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'Create Anthropic key',
    setupSteps: [
      'Save an Anthropic API key below (used for Mushi health probes only).',
      'Copy the mushi-claude-fix workflow into your repo via the checklist below.',
      'Add ANTHROPIC_API_KEY as a GitHub Actions secret in your repo.',
      'Dispatch a fix from Reports → Send to Claude, or set autofix_agent = claude_code_agent.',
    ],
    whyItMatters:
      'Dispatches a GitHub Actions workflow in your repo that runs Claude Code CLI, commits a fix branch, and opens a draft PR. Keys stay in your GitHub secrets (BYOK) — nothing is baked into your public repository.',
    capabilitiesOnceConnected: [
      'Fire-and-forget fix runs via repository_dispatch',
      'Draft PRs tagged with mushi-fix-id for status sync',
      'Workflow run link on the Fix card while CI is pending',
      'Use "Send to Claude" on any report for one-off dispatches',
    ],
    fields: [
      {
        name: 'claude_api_key_ref',
        label: 'Anthropic API key',
        placeholder: 'sk-ant-… (or vault://id)',
        type: 'password',
        help:
          'Stored in Mushi vault for health probes only. The actual fix run uses ANTHROPIC_API_KEY in your GitHub repo secrets.',
        required: true,
        helpId: 'integrations.claude_code_agent.api_key',
        validator: 'token',
      },
      {
        name: 'claude_default_model',
        label: 'Default model',
        placeholder: 'claude-opus-4-1',
        help: 'Model slug passed in the dispatch payload (your workflow may ignore this if Claude Code picks its own default).',
        helpId: 'integrations.claude_code_agent.default_model',
      },
      {
        name: 'claude_workflow_event',
        label: 'Workflow event',
        placeholder: 'mushi_claude_fix',
        help: 'repository_dispatch event type. Must match `on.repository_dispatch.types` in your workflow YAML.',
        helpId: 'integrations.claude_code_agent.workflow_event',
      },
      {
        name: 'claude_default_branch',
        label: 'Base branch',
        placeholder: 'main',
        help: 'Branch checked out before Claude applies the fix.',
        helpId: 'integrations.claude_code_agent.default_branch',
      },
    ],
  },
]

export const ROUTING_PROVIDERS: RoutingProviderDef[] = [
  {
    type: 'jira',
    healthKind: 'jira',
    label: 'Jira',
    Icon: IconJira,
    color: 'text-[#2684FF]',
    domain: 'atlassian.com',
    externalUrl: 'https://id.atlassian.com',
    whyItMatters: 'Triaged reports become Jira tickets in the project of your choice. Severity maps to Jira priority.',
    capabilitiesOnceConnected: [
      'Auto-create Jira issues for high-severity reports',
      'Map Mushi severity to Jira priority + status transitions',
      'Two-way link: closing the Jira issue resolves the Mushi report',
    ],
    fields: [
      { name: 'baseUrl', label: 'Base URL', placeholder: 'https://acme.atlassian.net', type: 'url', help: 'Your Atlassian Cloud or Server base URL.', required: true, helpId: 'integrations.routing.jira.base_url', validator: 'httpsUrl' },
      { name: 'email', label: 'User email', placeholder: 'bot@acme.com', help: 'Email of the Jira user owning the API token.', required: true, helpId: 'integrations.routing.jira.email', validator: 'email' },
      { name: 'apiToken', label: 'API token', placeholder: 'ATATT3xFf...', type: 'password', help: 'Create at id.atlassian.com → Security → API tokens.', required: true, helpId: 'integrations.routing.jira.api_token', validator: 'tokenLong' },
      { name: 'projectKey', label: 'Project key', placeholder: 'BUG', help: 'Short uppercase code prefixing every issue (e.g. BUG-123).', required: true, helpId: 'integrations.routing.jira.project_key', validator: 'jiraProjectKey' },
    ],
  },
  {
    type: 'linear',
    healthKind: 'linear',
    label: 'Linear',
    Icon: IconLinear,
    color: 'text-[#5C6BC0]',
    domain: 'linear.app',
    externalUrl: 'https://linear.app',
    whyItMatters: 'Mirror reports into Linear with proper labels and priorities. Classification metadata maps to Linear labels.',
    capabilitiesOnceConnected: [
      'Mirror reports as Linear issues with severity-mapped priority',
      'Apply category labels automatically (bug, regression, ux, etc.)',
      'Link the Linear issue back into the report for round-trip context',
    ],
    fields: [
      { name: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', help: 'Personal API key from Linear → Settings → API.', required: true, helpId: 'integrations.routing.linear.api_key', validator: 'token' },
      { name: 'teamId', label: 'Team ID', placeholder: 'TEAM-uuid', help: 'UUID of the Linear team that should receive issues.', required: true, helpId: 'integrations.routing.linear.team_id', validator: 'token' },
    ],
  },
  {
    type: 'github',
    healthKind: 'github_issues',
    label: 'GitHub Issues',
    Icon: IconGithub,
    color: 'text-fg',
    domain: 'github.com',
    externalUrl: 'https://github.com',
    whyItMatters: 'Open GitHub Issues directly in your repo. Different repo than the auto-fix code repo — this is for tracking, not patching.',
    capabilitiesOnceConnected: [
      'Open GitHub Issues with severity + category as labels',
      'Public issue tracker option (separate repo from the code repo)',
      'Closes the issue automatically when the linked report is resolved',
    ],
    fields: [
      { name: 'token', label: 'Personal access token', placeholder: 'ghp_...', type: 'password', help: 'Fine-grained PAT with Issues:write on the target repo.', required: true, helpId: 'integrations.routing.github_issues.token', validator: 'token' },
      { name: 'owner', label: 'Owner', placeholder: 'acme', help: 'Org or user that owns the repo.', required: true, helpId: 'integrations.routing.github_issues.owner', validator: 'slug' },
      { name: 'repo', label: 'Repo', placeholder: 'public-tracker', help: 'Repository name (no owner prefix).', required: true, helpId: 'integrations.routing.github_issues.repo', validator: 'slug' },
    ],
  },
  {
    type: 'pagerduty',
    healthKind: 'pagerduty',
    label: 'PagerDuty',
    Icon: IconPagerDuty,
    color: 'text-[#06AC38]',
    domain: 'pagerduty.com',
    externalUrl: 'https://app.pagerduty.com',
    whyItMatters: 'Page on-call when severity ≥ critical. Routes through Events API v2.',
    capabilitiesOnceConnected: [
      'Page the on-call when severity = critical',
      'De-dupes incidents per fingerprint to avoid alert storms',
      'Auto-resolve the incident when the linked report is closed',
    ],
    fields: [
      { name: 'routingKey', label: 'Routing key', placeholder: '32-char integration key', type: 'password', help: 'Events API v2 integration key from PagerDuty service.', required: true, helpId: 'integrations.routing.pagerduty.routing_key', validator: 'pagerdutyRoutingKey' },
    ],
  },
]
