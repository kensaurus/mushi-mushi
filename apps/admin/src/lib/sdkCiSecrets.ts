/**
 * FILE: apps/admin/src/lib/sdkCiSecrets.ts
 * PURPOSE: Pure helpers for the SDK CI-secret diagnostic and one-click sync UI.
 *
 * Provides:
 *  - type definitions for the /sdk-diagnostics and /sync-ci-secrets API responses
 *  - buildGuidedFallbackCommands(): generates copy-paste `gh secret set` /
 *    `gh variable set` commands and a CI env: block for manual setup
 *  - sdkCiStatusLabel(): human-readable label + severity for a diagnostic status
 */

import { formatEnvVarPair, mushiEnvVarsForProjectSlug } from './projectMushiEnv'

// ---------------------------------------------------------------------------
// API response types (mirror packages/server/.../project-ci-secrets.ts)
// ---------------------------------------------------------------------------

export type SdkDiagnosticStatus =
  | 'healthy'
  | 'ci-secret-missing'
  | 'native-never-seen'
  | 'banner-disabled'
  | 'unknown'

export interface SdkDiagnosticsResult {
  status: SdkDiagnosticStatus
  bannerEnabled: boolean
  launcherMode: string | null
  hasGithubToken: boolean
  repoUrl: string | null
  presentVars: string[] | null
  requiredVars: string[]
  missingVars: string[] | null
  lastSeenAt: string | null
  nativeEverSeen: boolean
  stack: 'nextjs' | 'expo' | 'vite'
  recommendedFix: string
}

export interface SyncCiSecretsResult {
  minted: { prefix: string; rawKey: string }
  written: string[]
  failed: Array<{ name: string; reason: string }>
  fallback: { commands: string[]; envBlock: string }
}

export interface SyncCiSecretsResponse {
  ok: boolean
  error?: { code: string; message: string }
  data?: SyncCiSecretsResult
}

// ---------------------------------------------------------------------------
// Guided fallback command generator (runs in the browser — no sensitive data)
// ---------------------------------------------------------------------------

export interface GuidedFallbackArgs {
  /** GitHub owner/repo (e.g. "kensaurus/glot.it"). */
  repo: string
  slug: string | null | undefined
  /** The project ID — safe to show (not a secret). */
  projectId: string
  /** The Mushi cloud endpoint — safe to show. */
  endpoint: string
  /** The freshly minted raw API key — must be shown once to the user. */
  rawKey: string
}

export interface GuidedFallback {
  /** Copy-paste shell commands to set GitHub Actions secrets/vars. */
  commands: string[]
  /** YAML snippet to paste into the env: block of build steps. */
  envBlock: string
  /** Individual lines for display in the UI. */
  varRows: Array<{ name: string; ghKind: 'secret' | 'variable'; value: string }>
}

export function buildGuidedFallbackCommands(args: GuidedFallbackArgs): GuidedFallback {
  const { repo, slug, projectId, endpoint, rawKey } = args
  const envVars = mushiEnvVarsForProjectSlug(slug)
  const { projectIdVar, apiKeyVar, endpointVar } = envVars

  type Row = { name: string; ghKind: 'secret' | 'variable'; value: string }

  const rows: Row[] = [
    { name: projectIdVar, ghKind: 'variable', value: projectId },
    { name: apiKeyVar, ghKind: 'secret', value: rawKey },
    ...(endpointVar ? [{ name: endpointVar, ghKind: 'variable' as const, value: endpoint }] : []),
  ]

  const repoFlag = `--repo ${repo}`
  const commands = rows.map((r) => {
    if (r.ghKind === 'secret') {
      return `gh secret set ${r.name} --body "${r.value}" ${repoFlag}`
    }
    return `gh variable set ${r.name} --body "${r.value}" ${repoFlag}`
  })

  const yamlLines = rows.map((r) => {
    const ref = r.ghKind === 'secret' ? `secrets.${r.name}` : `vars.${r.name}`
    return `          ${r.name}: \${{ ${ref} }}`
  })
  const envBlock = `        env:\n${yamlLines.join('\n')}`

  return { commands, envBlock, varRows: rows }
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export interface SdkCiStatusMeta {
  /** Short chip label (1–2 words). */
  chipLabel: string
  /** Dynamic card headline — matches SdkHealthSummary voice. */
  headline: string
  /** One-line subtitle under the headline. */
  subtitle: string
  /** @deprecated Use chipLabel — kept for transitional callers. */
  label: string
  /** @deprecated Use subtitle — kept for transitional callers. */
  description: string
  severity: 'ok' | 'warn' | 'error'
  /** Primary CTA label. */
  cta: string
  /** Numbered fix steps for collapsible playbook (technical detail lives here). */
  playbookSteps: string[]
}

export interface SdkCiStatusMetaArgs {
  status: SdkDiagnosticStatus
  hasGithubToken: boolean
  slug?: string | null
  nativeEverSeen?: boolean
  launcherMode?: string | null
}

export function sdkCiStatusMeta(
  status: SdkDiagnosticStatus,
  hasGithubToken: boolean,
  slug?: string | null,
  extras?: Pick<SdkDiagnosticsResult, 'nativeEverSeen' | 'launcherMode'>,
): SdkCiStatusMeta {
  const env = mushiEnvVarsForProjectSlug(slug)
  const envPair = formatEnvVarPair(env)
  const envWhere = 'GitHub Actions'
  const nativeEverSeen = extras?.nativeEverSeen ?? false
  const launcherMode = extras?.launcherMode ?? 'auto'

  switch (status) {
    case 'healthy':
      return {
        chipLabel: 'Connected',
        headline: nativeEverSeen ? 'Native app is checking in' : 'CI secrets are set',
        subtitle: nativeEverSeen
          ? 'Your store build includes Mushi env vars — new reports should appear within seconds.'
          : 'Secrets are in GitHub Actions — waiting for the first heartbeat from a TestFlight or Play build.',
        label: 'Connected',
        description: nativeEverSeen
          ? 'CI secrets present and the SDK has been seen from native builds.'
          : 'CI secrets present — waiting for first native heartbeat.',
        severity: 'ok',
        cta: hasGithubToken ? 'Re-sync secrets' : 'Copy setup commands',
        playbookSteps: [
          `Confirm ${envPair} are still in your ${envWhere} workflow for ${env.stackLabel} builds.`,
          'OTA updates cannot retrofit compile-time keys — trigger a fresh native build after any secret change.',
        ],
      }
    case 'ci-secret-missing':
      return {
        chipLabel: 'Setup needed',
        headline: 'SDK not connected yet',
        subtitle: `Your app can't reach Mushi until ${envPair} are in ${envWhere} (${env.stackLabel}). Rebuild required.`,
        label: 'Setup needed',
        description: `Missing ${envPair} in ${envWhere}.`,
        severity: 'error',
        cta: hasGithubToken ? 'Sync CI secrets automatically' : 'Copy setup commands',
        playbookSteps: [
          `Add ${envPair} to ${envWhere} for your ${env.stackLabel} release workflow.`,
          hasGithubToken
            ? 'Click Sync CI secrets — Mushi mints a key and writes vars via the GitHub API.'
            : 'Use Copy setup commands — you need a fine-grained GitHub PAT with Actions secrets: Read and write in Settings → GitHub.',
          'Trigger a new native build (CI push). OTA cannot inject keys into an already-installed store binary.',
        ],
      }
    case 'native-never-seen':
      return {
        chipLabel: 'No native ping',
        headline: "Native app hasn't checked in yet",
        subtitle:
          'We see web or CI activity but not a TestFlight or Play build — confirm env vars are in your release workflow.',
        label: 'No native ping',
        description: 'Web/CI heartbeats exist but no native Capacitor, iOS, or Android origin yet.',
        severity: 'warn',
        cta: hasGithubToken ? 'Sync CI secrets automatically' : 'Copy setup commands',
        playbookSteps: [
          `Verify ${envPair} are in the workflow that builds your store/TestFlight binary (not just web CI).`,
          'Install from TestFlight or Play Internal Testing — a dev-server heartbeat does not prove the store build works.',
          'Send test report proves ingest only — you still need a heartbeat from the real native app.',
        ],
      }
    case 'banner-disabled':
      return {
        chipLabel: 'Hidden',
        headline: 'Feedback widget is hidden',
        subtitle: `Turn on Banner launcher in SDK Config so users can send reports from the downloaded app.`,
        label: 'Hidden',
        description: `Launcher mode is "${launcherMode}" — set to banner in SDK Config.`,
        severity: 'warn',
        cta: 'Open SDK Config',
        playbookSteps: [
          'Open Projects → SDK Config → Launcher mode → Banner.',
          `Then confirm ${envPair} are baked into your ${env.stackLabel} release build.`,
        ],
      }
    default:
      return {
        chipLabel: 'Unknown',
        headline: 'Could not verify SDK health',
        subtitle: 'Check that API keys exist and GitHub is linked for this project.',
        label: 'Unknown',
        description: 'Could not determine SDK health.',
        severity: 'warn',
        cta: hasGithubToken ? 'Sync CI secrets automatically' : 'Copy setup commands',
        playbookSteps: [
          'Link GitHub on Connect or Integrations.',
          `Add ${envPair} to ${envWhere} and rebuild.`,
        ],
      }
  }
}
