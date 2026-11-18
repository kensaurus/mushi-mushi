/**
 * FILE: apps/admin/src/lib/sdkCiSecrets.ts
 * PURPOSE: Pure helpers for the SDK CI-secret diagnostic and one-click sync UI.
 *
 * Provides:
 *  - type definitions for the /sdk-diagnostics and /sync-ci-secrets API responses
 *  - sdkCiStatusLabel(): human-readable label + severity for a diagnostic status
 */

import { formatEnvVarPair, mushiEnvVarsForProjectSlug, type ProjectMushiEnvVars } from './projectMushiEnv'

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
  stack: 'nextjs' | 'nuxt' | 'expo' | 'vite'
  /** `repo`: read from the repo's package.json; `slug`: a guess (older API: absent). */
  stackSource?: 'repo' | 'slug'
  recommendedFix: string
}

export interface SyncCiSecretsResult {
  minted: { prefix: string; rawKey: string }
  written: string[]
  failed: Array<{ name: string; reason: string }>
  fallback: { commands: string[]; envBlock: string }
  /**
   * Prefixes of the older ci-auto keys revoked after GitHub accepted the new
   * one. Empty when nothing was revoked (the key secret was not written);
   * null when the revoke itself failed and the old key is still live.
   */
  priorKeysRevoked?: string[] | null
  revokeError?: string | null
}

// ---------------------------------------------------------------------------
// Guided fallback command generator (runs in the browser — no sensitive data)
// ---------------------------------------------------------------------------

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

export function sdkCiStatusMeta(
  status: SdkDiagnosticStatus,
  hasGithubToken: boolean,
  slug?: string | null,
  extras?: Partial<Pick<SdkDiagnosticsResult, 'nativeEverSeen' | 'launcherMode'>> & {
    /** Names already resolved from the repo stack. Beats the slug guess. */
    env?: ProjectMushiEnvVars
  },
): SdkCiStatusMeta {
  const env = extras?.env ?? mushiEnvVarsForProjectSlug(slug)
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
          ? 'Your store build includes Mushi Mushi env vars — new reports should appear within seconds.'
          : 'Secrets are in GitHub Actions — waiting for the first heartbeat from a TestFlight or Play build.',
        label: 'Connected',
        description: nativeEverSeen
          ? 'CI secrets present and the SDK has been seen from native builds.'
          : 'CI secrets are set. Waiting for a store build to check in.',
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
        subtitle: `Your app can't reach Mushi Mushi until ${envPair} are in ${envWhere} (${env.stackLabel}). Rebuild required.`,
        label: 'Setup needed',
        description: `Missing ${envPair} in ${envWhere}.`,
        severity: 'error',
        cta: hasGithubToken ? 'Sync CI secrets automatically' : 'Copy setup commands',
        playbookSteps: [
          `Add ${envPair} to ${envWhere} for your ${env.stackLabel} release workflow.`,
          hasGithubToken
            ? 'Click Sync CI secrets — Mushi Mushi mints a key and writes vars via the GitHub API.'
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
        description: 'Your web build checks in, but no iOS or Android build has yet.',
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

/** The placeholder the server puts where the API key goes (_shared/sdk-diagnostics.ts). */
const KEY_PLACEHOLDER = '<your-mushi-project-api-key>'

/**
 * What a CI-secrets write that did not fully work should say, and the `gh`
 * commands left to run, with the new key already in them so the person only
 * pastes. Partial: only the names that failed.
 *
 * Owner, 2026-11-17: the variables were written, the secret was not, and the
 * console said only "Some names were not written: VITE_MUSHI_API_KEY". The
 * GitHub App has no "Secrets: write" permission (AGENTS.md, "GitHub App vs
 * PAT permission boundary"), so GitHub refuses the secret.
 */
export function ciSecretsManualStep(input: {
  status: 'partial' | 'forbidden' | 'no-repo' | 'failed'
  failed?: ReadonlyArray<{ name: string; reason: string }>
  commands?: readonly string[]
  rawKey?: string
  errorMessage?: string
}): { reason: string; commands: string[] } {
  const failedNames = (input.failed ?? []).map((f) => f.name)
  const forbidden = input.status === 'forbidden' || (input.failed ?? []).some((f) => /\b403\b|permission/i.test(f.reason))
  const fill = (cmd: string) => (input.rawKey ? cmd.split(KEY_PLACEHOLDER).join(input.rawKey) : cmd)
  const all = (input.commands ?? []).map(fill)
  const commands =
    input.status === 'partial' && failedNames.length > 0
      ? all.filter((cmd) => failedNames.some((name) => cmd.split(/\s+/).slice(0, 4).join(' ').endsWith(` set ${name}`)))
      : all
  const names = failedNames.join(', ')
  const run = commands.length === 1 ? 'Run this command once' : 'Run these commands once'
  let reason: string
  if (input.status === 'no-repo') {
    reason = `No GitHub repo or token is connected, so Mushi Mushi could not write anything. ${run}:`
  } else if (forbidden && input.status === 'partial') {
    reason = `The variables were written, but GitHub refused ${names || 'the secret'}: the Mushi Mushi GitHub App has no "Secrets: write" permission. ${run} to set ${failedNames.length === 1 ? 'it' : 'them'} yourself:`
  } else if (forbidden) {
    reason = `GitHub refused the write: the Mushi Mushi GitHub App has no "Secrets: write" permission. ${run} instead:`
  } else if (input.status === 'partial') {
    const why = (input.failed ?? []).map((f) => `${f.name}: ${f.reason}`).join('; ')
    reason = `Some names were not written (${why}). ${run} to set them yourself:`
  } else {
    reason = `${input.errorMessage ?? 'The secrets were not written.'} ${run} instead:`
  }
  return { reason, commands }
}
