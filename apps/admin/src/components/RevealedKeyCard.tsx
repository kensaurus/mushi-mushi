/**
 * FILE: apps/admin/src/components/RevealedKeyCard.tsx
 * PURPOSE: One-time reveal of a freshly minted API key, with frictionless
 *          copy paths for the two places a key actually lives:
 *
 *          1. `.env.local` — for repo agents, CI, and any tool that picks
 *             up `MUSHI_API_KEY` from process env (the MCP binary does).
 *          2. `.cursor/mcp.json` — for Cursor / Claude Desktop / Windsurf
 *             clients that spawn the MCP server themselves.
 *
 *          Previously the only copy target was the raw key string, which
 *          forced users to remember the env-var name AND construct the
 *          JSON block by hand. That friction was the single biggest reason
 *          MCP felt "confusing" per the dogfood feedback.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Badge } from './ui'
import { useToast } from '../lib/toast'
import { RESOLVED_EXTERNAL_API_URL } from '../lib/env'
import { mushiEnvVarsForProjectSlug, isExpoReporterProject, expoReporterGithubRepo, type ProjectMushiEnvVars } from '../lib/projectMushiEnv'
import { CHIP_TONE } from '../lib/chipTone'
import { MCP_PIN_SPEC } from '@mushi-mushi/mcp/clients'

type Mode = 'raw' | 'env' | 'cursor' | 'admin' | 'expo' | 'github'

function defaultModeForSlug(slug: string | null | undefined): Mode {
  if (isExpoReporterProject(slug)) return 'expo'
  if (mushiEnvVarsForProjectSlug(slug).apiKeyVar.startsWith('VITE_MUSHI_SELF_')) return 'admin'
  return 'env'
}

interface Props {
  projectId: string
  projectName: string
  projectSlug?: string | null
  apiKey: string
  scopes: string[]
  onDismiss: () => void
  /** Renders test-id attrs so Playwright can drive the component. */
  testIdPrefix?: string
}

/**
 * Build the `.cursor/mcp.json` snippet. We use `npx -y` with a pinned
 * `@mushi-mushi/mcp` version so users don't have to `pnpm add` the package
 * globally — one less step on day one, without the supply-chain and
 * cold-start costs of `@latest` on every editor launch.
 */
function buildCursorJson(projectId: string, projectName: string, apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [`mushi-${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}`]: {
          command: 'npx',
          args: ['-y', MCP_PIN_SPEC],
          env: {
            // The same endpoint this console talks to — keeps the MCP server
            // and the admin on one host (self-hosted instances included).
            MUSHI_API_ENDPOINT: RESOLVED_EXTERNAL_API_URL,
            MUSHI_API_KEY: apiKey,
            MUSHI_PROJECT_ID: projectId,
          },
        },
      },
    },
    null,
    2,
  )
}

function buildEnvLocal(projectId: string, apiKey: string): string {
  return [
    '# Mushi MCP — drop into .env.local (gitignored). The MCP binary picks these up on spawn.',
    `MUSHI_API_ENDPOINT=${RESOLVED_EXTERNAL_API_URL}`,
    `MUSHI_API_KEY=${apiKey}`,
    `MUSHI_PROJECT_ID=${projectId}`,
    '',
  ].join('\n')
}

function buildAdminDogfoodEnv(projectId: string, apiKey: string, slug: string | null | undefined): string {
  const env = mushiEnvVarsForProjectSlug(slug)
  const file = env.envFileHint ?? 'apps/admin/.env.local'
  const lines = [
    `# Mushi admin dogfood — paste into ${file} and restart the Vite dev server.`,
    `${env.projectIdVar}=${projectId}`,
    `${env.apiKeyVar}=${apiKey}`,
  ]
  if (env.endpointVar) {
    lines.push(`${env.endpointVar}=${RESOLVED_EXTERNAL_API_URL}`)
  }
  lines.push('')
  return lines.join('\n')
}

function buildExpoEnvLocal(projectId: string, apiKey: string, env: ProjectMushiEnvVars): string {
  const file = env.envFileHint ?? 'apps/mobile/.env.local'
  const lines = [
    `# Mushi reporter SDK — paste into ${file} (gitignored).`,
    `# EXPO_PUBLIC_* is baked at bundle time; OTA cannot inject it.`,
    `${env.projectIdVar}=${projectId}`,
    `${env.apiKeyVar}=${apiKey}`,
  ]
  if (env.endpointVar) {
    lines.push(`${env.endpointVar}=${RESOLVED_EXTERNAL_API_URL}`)
  }
  lines.push('')
  return lines.join('\n')
}

function buildGithubCiEnv(projectId: string, apiKey: string, env: ProjectMushiEnvVars, projectSlug?: string | null): string {
  const ci = env.ciVars
  const repo = expoReporterGithubRepo(projectSlug) ?? 'your-org/your-repo'
  if (!ci) {
    return buildEnvLocal(projectId, apiKey)
  }
  const lines = [
    '# GitHub Actions — reporter SDK for store builds (Android + iOS).',
    '# Run from mushi-mushi: node scripts/setup-yen-yen-reporter-secrets.mjs',
    '# Use stdin/body-file when running gh — never paste secrets into shell history.',
    '#',
    '# Reporter (in-app feedback band):',
  ]
  lines.push(`gh variable set ${ci.projectId.name} --body-file project-id.txt --repo ${repo}`)
  lines.push(`gh secret set ${ci.apiKey.name} < api-key.txt --repo ${repo}`)
  if (ci.endpoint) {
    lines.push(`gh variable set ${ci.endpoint.name} --body-file endpoint.txt --repo ${repo}`)
  }
  lines.push(
    '',
    '# Code Health CI only (NOT the reporter band):',
    'gh secret set MUSHI_INGEST_KEY < ingest-key.txt --repo ' + repo,
    '',
    '# Values for this reveal (store in the files above — do not commit):',
    `${ci.projectId.name}=${projectId}`,
    `${ci.apiKey.name}=${apiKey}`,
  )
  if (ci.endpoint) {
    lines.push(`${ci.endpoint.name}=${RESOLVED_EXTERNAL_API_URL}`)
  }
  lines.push('')
  return lines.join('\n')
}

function scopeBadgeTone(scope: string): string {
  if (scope === 'mcp:write') return CHIP_TONE.dangerSubtle
  if (scope === 'mcp:read') return CHIP_TONE.infoSubtle
  return 'bg-surface-overlay text-fg-muted border border-edge-subtle'
}

export function RevealedKeyCard({
  projectId,
  projectName,
  projectSlug,
  apiKey,
  scopes,
  onDismiss,
  testIdPrefix,
}: Props) {
  const env = mushiEnvVarsForProjectSlug(projectSlug)
  const [mode, setMode] = useState<Mode>(() => defaultModeForSlug(projectSlug))
  const toast = useToast()

  const envSnippet = buildEnvLocal(projectId, apiKey)
  const cursorSnippet = buildCursorJson(projectId, projectName, apiKey)
  const adminSnippet = buildAdminDogfoodEnv(projectId, apiKey, projectSlug)
  const expoSnippet = buildExpoEnvLocal(projectId, apiKey, env)
  const githubSnippet = buildGithubCiEnv(projectId, apiKey, env, projectSlug)
  const showAdminTab = env.apiKeyVar.startsWith('VITE_MUSHI_SELF_')
  const showExpoTab = isExpoReporterProject(projectSlug)
  const showGithubTab = Boolean(env.ciVars)
  const payload =
    mode === 'raw'
      ? apiKey
      : mode === 'env'
        ? envSnippet
        : mode === 'admin'
          ? adminSnippet
          : mode === 'expo'
            ? expoSnippet
            : mode === 'github'
              ? githubSnippet
              : cursorSnippet

  async function copy() {
    try {
      await navigator.clipboard.writeText(payload)
      toast.success(
        mode === 'raw'
          ? 'Key copied.'
          : mode === 'env'
            ? '.env.local block copied — paste into your repo\'s .env.local.'
            : mode === 'admin'
              ? 'Admin dogfood env copied — paste into apps/admin/.env.local and restart Vite.'
              : mode === 'expo'
                ? 'Expo .env.local block copied — paste into apps/mobile/.env.local.'
                : mode === 'github'
                  ? 'GitHub Actions checklist copied — run gh variable/secret set, then rebuild store apps.'
                  : '.cursor/mcp.json block copied — paste into your IDE\'s MCP config.',
      )
    } catch {
      toast.error('Clipboard blocked — select the text and copy manually.')
    }
  }

  const tabs: Array<{ id: Mode; label: string; hint: string }> = [
    ...(showExpoTab
      ? [
          {
            id: 'expo' as const,
            label: 'Expo (.env.local)',
            hint: 'Reporter SDK vars for apps/mobile — compile-time EXPO_PUBLIC_* pattern.',
          },
        ]
      : []),
    ...(showGithubTab
      ? [
          {
            id: 'github' as const,
            label: 'GitHub Actions',
            hint: 'Repo vars/secrets for release-mobile store builds (reporter vs ingest keys).',
          },
        ]
      : []),
    { id: 'env', label: '.env.local (MCP)', hint: 'For the MCP binary, CI, or any tool that reads MUSHI_* env vars.' },
    ...(showAdminTab
      ? [
          {
            id: 'admin' as const,
            label: 'Admin dogfood',
            hint: 'For this console\'s VITE_MUSHI_SELF_* self-reporting SDK.',
          },
        ]
      : []),
    { id: 'cursor', label: '.cursor/mcp.json', hint: 'For Cursor / Claude Desktop / Windsurf.' },
    { id: 'raw', label: 'Raw key', hint: 'Just the key string.' },
  ]

  return (
    <div
      className="mt-3 pt-2 border-t border-edge-subtle bg-warn-muted/20 -mx-3 px-3 py-2"
      data-testid={testIdPrefix ?? `revealed-key-${projectId}`}
    >
      <div className="text-2xs text-warn font-medium uppercase tracking-wider mb-2 flex items-center gap-2 flex-wrap">
        <span>⚠️ One-time key — copy now, will not be shown again</span>
        {scopes.map((s) => (
          <Badge key={s} className={scopeBadgeTone(s)}>{s}</Badge>
        ))}
      </div>

      <div className="flex items-center gap-1 mb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            title={tab.hint}
            data-testid={`revealed-key-mode-${tab.id}`}
            className={`text-2xs px-2 py-1 rounded-sm border transition-opacity ${
              mode === tab.id
                ? 'bg-accent-muted/70 text-accent-foreground border-accent/40'
                : 'bg-surface-raised text-fg-muted border-edge-subtle hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <pre
        className="mushi-code-block mushi-code-body font-mono text-xs text-fg px-2 py-1 rounded-sm block whitespace-pre-wrap wrap-anywhere select-all max-h-48 overflow-auto"
        data-testid={`revealed-key-payload-${mode}`}
      >
        {payload}
      </pre>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <Btn size="sm" onClick={copy} data-testid="revealed-key-copy">
          Copy {mode === 'raw' ? 'key' : 'snippet'}
        </Btn>
        <Btn variant="cancel" size="sm" onClick={onDismiss}>
          I've stored it — hide
        </Btn>
        <Link
          to="/mcp"
          className="text-2xs text-accent hover:underline ml-auto"
          data-testid="revealed-key-learn-more"
        >
          What can I do with this key? →
        </Link>
      </div>
    </div>
  )
}
