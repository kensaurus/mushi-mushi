/**
 * FILE: apps/admin/src/components/ClientConnectButton.tsx
 * PURPOSE: Registry-driven install button for any supported AI client.
 *
 * OVERVIEW:
 * - Handles all four install methods: deeplink (opens IDE), config-json (reveals
 *   copy block), cli-command (reveals copy block), remote-url (shows URL + headers).
 * - Mints a per-project MCP key before building the install artifact.
 * - Used by McpInstallButtons (back-compat wrapper), ConnectStudio client grid, and
 *   the public docs /connect landing (pass apiKey directly; no minting).
 *
 * DEPENDENCIES:
 * - @mushi-mushi/mcp/clients  (McpClientDef, McpBuildInput, McpBuildResult)
 * - apps/admin/src/lib/supabase  (apiFetch — only when projectId is provided)
 * - apps/admin/src/lib/toast
 * - apps/admin/src/components/ui  (Btn, CopyButton)
 *
 * USAGE:
 *   // With project key minting (console):
 *   <ClientConnectButton client={cursorClient} projectId="..." projectName="..." endpoint={...} mcpHttpUrl={...} />
 *
 *   // Without minting (public docs page — pass apiKey directly):
 *   <ClientConnectButton client={cursorClient} projectName="Demo" endpoint="..." mcpHttpUrl="..." apiKey="<placeholder>" />
 */

import { useState } from 'react'
import type { McpClientDef, McpBuildInput, McpBuildResult } from '@mushi-mushi/mcp/clients'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { LINK_BRAND } from '../lib/chipTone'
import { Btn, CodeValue } from './ui'

// ─── Key minting (project-scoped only) ───────────────────────────────────────

async function mintMcpKey(
  scopes: string[],
  projectId: string,
): Promise<string | null> {
  const res = await apiFetch<{ key: string; prefix: string }>(
    `/v1/admin/projects/${projectId}/keys`,
    {
      method: 'POST',
      body: JSON.stringify({ scopes }),
      idempotencyKey: crypto.randomUUID(),
    },
  )
  if (!res.ok || !res.data?.key) return null
  return res.data.key
}

// ─── Config copy section ─────────────────────────────────────────────────────

function ConfigCopySection({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-3 space-y-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <CodeValue value={text} multiline copyable />
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ClientConnectButtonProps {
  client: McpClientDef
  projectName: string
  endpoint: string
  mcpHttpUrl: string
  /** When provided, key is minted on click. Omit to use `apiKey` directly. */
  projectId?: string
  /** Pre-minted or placeholder key (used when projectId is absent, e.g. public page). */
  apiKey?: string
  /** Additional scopes to include when minting. Default: ['mcp:read']. */
  scopes?: string[]
  /** Style override for the trigger button. */
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md'
  /** If true, immediately shows the config block without a button (e.g. already expanded). */
  expanded?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClientConnectButton({
  client,
  projectName,
  endpoint,
  mcpHttpUrl,
  projectId,
  apiKey: preMintedKey,
  scopes = ['mcp:read'],
  variant = 'primary',
  size = 'md',
  expanded = false,
}: ClientConnectButtonProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<McpBuildResult | null>(null)
  const [showBlock, setShowBlock] = useState(expanded)

  async function handleConnect() {
    setLoading(true)
    try {
      let apiKey = preMintedKey
      if (!apiKey && projectId) {
        apiKey = await mintMcpKey(scopes, projectId) ?? undefined
        if (!apiKey) {
          toast.error('Key mint failed', 'Could not mint an MCP key — check your plan limits.')
          return
        }
      }
      if (!apiKey) {
        toast.error('No API key', 'Provide a projectId to mint a key, or pass apiKey directly.')
        return
      }

      const input: McpBuildInput = {
        projectId,
        projectName,
        apiKey,
        endpoint,
        mcpHttpUrl,
      }
      const built = client.build(input)
      setResult(built)

      if (built.kind === 'deeplink') {
        window.open(built.url, '_self')
        toast.success(`${client.label} install launched`, 'The IDE install dialog should open.')
      } else {
        setShowBlock(true)
      }
    } finally {
      setLoading(false)
    }
  }

  // Label for the trigger button
  const buttonLabel =
    client.method === 'deeplink'
      ? `Add to ${client.label}`
      : client.method === 'cli-command'
        ? `Show command`
        : `Show config`

  return (
    <div>
      {!showBlock && (
        <Btn
          size={size}
          variant={variant}
          loading={loading}
          disabled={loading}
          onClick={() => void handleConnect()}
          aria-label={`Install Mushi MCP in ${client.label}`}
        >
          {buttonLabel}
        </Btn>
      )}

      {showBlock && result && (
        <div>
          {result.kind === 'config' && (
            <>
              <ConfigCopySection
                label={`Paste into ${result.filePath}`}
                text={result.json}
              />
              <button
                type="button"
                onClick={() => setShowBlock(false)}
                className="mt-2 rounded text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                ← Back
              </button>
            </>
          )}
          {result.kind === 'command' && (
            <>
              <ConfigCopySection label="Run in your terminal" text={result.text} />
              <button
                type="button"
                onClick={() => setShowBlock(false)}
                className="mt-2 rounded text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                ← Back
              </button>
            </>
          )}
          {result.kind === 'remote-url' && (
            <>
              <ConfigCopySection label="MCP endpoint URL" text={result.url} />
              <ConfigCopySection label="Required headers" text={result.headerSnippet} />
              <button
                type="button"
                onClick={() => setShowBlock(false)}
                className="mt-2 rounded text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                ← Back
              </button>
            </>
          )}
          {result.kind === 'deeplink' && (
            // After deeplink was opened, offer a re-open
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-fg-muted">IDE dialog should have opened.</span>
              <button
                type="button"
                onClick={() => { if (result.kind === 'deeplink') window.open(result.url, '_self') }}
                className={`rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${LINK_BRAND}`}
              >
                Open again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
