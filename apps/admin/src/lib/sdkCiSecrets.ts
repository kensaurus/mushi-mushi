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

import { mushiEnvVarsForProjectSlug } from './projectMushiEnv'

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
  label: string
  description: string
  severity: 'ok' | 'warn' | 'error'
  /** Short action hint for the primary CTA. */
  cta: string
}

export function sdkCiStatusMeta(status: SdkDiagnosticStatus, hasGithubToken: boolean): SdkCiStatusMeta {
  switch (status) {
    case 'healthy':
      return {
        label: 'Native SDK reporting',
        description: 'CI secrets present and the SDK has been seen from native builds.',
        severity: 'ok',
        cta: 'Re-sync secrets',
      }
    case 'ci-secret-missing':
      return {
        label: 'CI secrets missing',
        description:
          'One or more Mushi env vars are absent from GitHub Actions. ' +
          'The SDK is disabled at build time in native (store/TestFlight) builds.',
        severity: 'error',
        cta: hasGithubToken ? 'Sync CI secrets automatically' : 'Copy setup commands',
      }
    case 'native-never-seen':
      return {
        label: 'Native app never reported',
        description:
          'The SDK reached this backend from web/CI, but never from a native Capacitor, ' +
          'iOS, or Android origin. The banner may be missing in the downloaded app.',
        severity: 'warn',
        cta: hasGithubToken ? 'Sync CI secrets' : 'Copy setup commands',
      }
    case 'banner-disabled':
      return {
        label: 'Banner launcher disabled',
        description:
          'The SDK config has the banner launcher set to hidden or manual. ' +
          'Update SDK Config → Launcher mode → Banner to re-enable it.',
        severity: 'warn',
        cta: 'Open SDK Config',
      }
    default:
      return {
        label: 'SDK status unknown',
        description: 'Could not determine SDK health. Check that keys are configured.',
        severity: 'warn',
        cta: 'Sync CI secrets',
      }
  }
}
