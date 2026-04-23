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
import { Btn, Badge } from './ui'
import { useToast } from '../lib/toast'

type Mode = 'raw' | 'env' | 'cursor'

interface Props {
  projectId: string
  projectName: string
  apiKey: string
  scopes: string[]
  onDismiss: () => void
  /** Renders test-id attrs so Playwright can drive the component. */
  testIdPrefix?: string
}

/**
 * Build the `.cursor/mcp.json` snippet. We use `npx -y mushi-mcp@latest` so
 * users don't have to `pnpm add` the package globally — one less step on
 * day one, and they'll upgrade automatically.
 */
function buildCursorJson(projectId: string, projectName: string, apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [`mushi-${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}`]: {
          command: 'npx',
          args: ['-y', 'mushi-mcp@latest'],
          env: {
            MUSHI_API_ENDPOINT: 'https://api.mushimushi.dev',
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
    'MUSHI_API_ENDPOINT=https://api.mushimushi.dev',
    `MUSHI_API_KEY=${apiKey}`,
    `MUSHI_PROJECT_ID=${projectId}`,
    '',
  ].join('\n')
}

function scopeBadgeTone(scope: string): string {
  if (scope === 'mcp:write') return 'bg-danger-muted text-danger border border-danger/30'
  if (scope === 'mcp:read') return 'bg-info-muted text-info border border-info/30'
  return 'bg-surface-overlay text-fg-muted border border-edge-subtle'
}

export function RevealedKeyCard({ projectId, projectName, apiKey, scopes, onDismiss, testIdPrefix }: Props) {
  const [mode, setMode] = useState<Mode>('env')
  const toast = useToast()

  const envSnippet = buildEnvLocal(projectId, apiKey)
  const cursorSnippet = buildCursorJson(projectId, projectName, apiKey)
  const payload = mode === 'raw' ? apiKey : mode === 'env' ? envSnippet : cursorSnippet

  async function copy() {
    try {
      await navigator.clipboard.writeText(payload)
      toast.success(
        mode === 'raw'
          ? 'Key copied.'
          : mode === 'env'
            ? '.env.local block copied — paste into your repo\'s .env.local.'
            : '.cursor/mcp.json block copied — paste into your IDE\'s MCP config.',
      )
    } catch {
      toast.error('Clipboard blocked — select the text and copy manually.')
    }
  }

  const tabs: Array<{ id: Mode; label: string; hint: string }> = [
    { id: 'env',    label: '.env.local',       hint: 'For the MCP binary, CI, or any tool that reads env vars.' },
    { id: 'cursor', label: '.cursor/mcp.json', hint: 'For Cursor / Claude Desktop / Windsurf.' },
    { id: 'raw',    label: 'Raw key',          hint: 'Just the key string.' },
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
            className={`text-2xs px-2 py-1 rounded-sm border transition-colors ${
              mode === tab.id
                ? 'bg-accent-muted text-accent border-accent/40'
                : 'bg-surface-raised text-fg-muted border-edge-subtle hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <pre
        className="font-mono text-xs text-fg bg-surface-raised px-2 py-1 rounded-sm block whitespace-pre-wrap wrap-anywhere select-all max-h-48 overflow-auto"
        data-testid={`revealed-key-payload-${mode}`}
      >
        {payload}
      </pre>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <Btn size="sm" onClick={copy} data-testid="revealed-key-copy">
          Copy {mode === 'raw' ? 'key' : 'snippet'}
        </Btn>
        <Btn variant="ghost" size="sm" onClick={onDismiss}>
          I've stored it — hide
        </Btn>
        <a
          href="/mcp"
          className="text-2xs text-accent hover:underline ml-auto"
          data-testid="revealed-key-learn-more"
        >
          What can I do with this key? →
        </a>
      </div>
    </div>
  )
}
