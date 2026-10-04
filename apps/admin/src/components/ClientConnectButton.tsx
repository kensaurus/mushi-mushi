/**
 * FILE: apps/admin/src/components/ClientConnectButton.tsx
 * PURPOSE: Registry-driven install button for any supported AI client.
 *
 * OVERVIEW:
 * - Handles all four install methods: deeplink (opens IDE), config-json (reveals
 *   copy block), cli-command (reveals copy block), remote-url (shows URL + headers).
 * - Mints a per-project MCP key before building the install artifact: at most
 *   one per (project, client, access) per page session, labelled
 *   "MCP · <client> · <date> · read+write", read+write by default with an
 *   optional read-only choice (lib/mcpConnect.ts, REPORT A7).
 * - Writes the published @mushi-mushi/mcp version (sdk_versions catalog) into
 *   stdio configs, not the version this console was built with.
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

import { useId, useState } from 'react'
import type { McpClientDef, McpBuildInput, McpBuildResult } from '@mushi-mushi/mcp/clients'
import { useToast } from '../lib/toast'
import { LINK_ACCENT } from '../lib/chipTone'
import { getOrMintMcpKey, getPublishedMcpPinSpec, scopesForAccess, type McpAccess } from '../lib/mcpConnect'
import { Btn, CodeValue } from './ui'

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
  /**
   * Exact scopes to mint with. Omit to use the access choice: read + write by
   * default (the fix loop's `submit_fix_result` needs mcp:write).
   */
  scopes?: string[]
  /** Show a "Read-only key" checkbox under the button (when minting). */
  accessChoice?: boolean
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
  scopes,
  accessChoice = false,
  variant = 'primary',
  size = 'md',
  expanded = false,
}: ClientConnectButtonProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<McpBuildResult | null>(null)
  const [showBlock, setShowBlock] = useState(expanded)
  const [access, setAccess] = useState<McpAccess>('read_write')
  const accessId = useId()
  const mints = !preMintedKey && Boolean(projectId)
  const mintScopes = scopes ?? scopesForAccess(access)

  async function handleConnect() {
    setLoading(true)
    try {
      let apiKey = preMintedKey
      const pinPromise = getPublishedMcpPinSpec()
      if (!apiKey && projectId) {
        apiKey =
          (await getOrMintMcpKey({ projectId, clientId: client.id, clientLabel: client.label, scopes: mintScopes })) ??
          undefined
        if (!apiKey) {
          toast.error(
            'Could not create a key',
            'Only project owners and admins can create keys. Ask one, or check your plan limits in Billing.',
          )
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
        pinSpec: await pinPromise,
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

  // Label for the trigger button. It is also the accessible name: a separate
  // aria-label ("Install Mushi MCP in Cursor") hid the visible "Add to Cursor"
  // from voice-control users (REPORT A14, WCAG 2.5.3 label in name).
  const buttonLabel =
    client.method === 'deeplink'
      ? `Add to ${client.label}`
      : client.method === 'cli-command'
        ? `Show ${client.label} command`
        : `Show ${client.label} config`

  return (
    <div>
      {!showBlock && (
        <Btn
          size={size}
          variant={variant}
          loading={loading}
          disabled={loading}
          onClick={() => void handleConnect()}
        >
          {buttonLabel}
        </Btn>
      )}

      {!showBlock && mints && accessChoice && !scopes && (
        <label htmlFor={accessId} className="mt-1.5 flex items-center gap-1.5 text-2xs text-fg-muted">
          <input
            id={accessId}
            type="checkbox"
            checked={access === 'read_only'}
            onChange={(e) => setAccess(e.currentTarget.checked ? 'read_only' : 'read_write')}
          />
          Read-only key (your agent can read reports but cannot mark them fixed)
        </label>
      )}

      {showBlock && result && (
        <div>
          {result.kind === 'config' && (
            <>
              <ConfigCopySection
                label={`Paste into ${result.filePath}`}
                text={result.json}
              />
              <Btn
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowBlock(false)}
                className="mt-2 !px-0 !py-0 text-xs text-fg-muted hover:text-fg"
              >
                ← Back
              </Btn>
            </>
          )}
          {result.kind === 'command' && (
            <>
              <ConfigCopySection label="Run in your terminal" text={result.text} />
              <Btn
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowBlock(false)}
                className="mt-2 !px-0 !py-0 text-xs text-fg-muted hover:text-fg"
              >
                ← Back
              </Btn>
            </>
          )}
          {result.kind === 'remote-url' && (
            <>
              <ConfigCopySection label="MCP endpoint URL" text={result.url} />
              <ConfigCopySection label="Required headers" text={result.headerSnippet} />
              <Btn
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowBlock(false)}
                className="mt-2 !px-0 !py-0 text-xs text-fg-muted hover:text-fg"
              >
                ← Back
              </Btn>
            </>
          )}
          {result.kind === 'deeplink' && (
            // After deeplink was opened, offer a re-open
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-fg-muted">IDE dialog should have opened.</span>
              <Btn
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => { if (result.kind === 'deeplink') window.open(result.url, '_self') }}
                className={`!px-0 !py-0 text-xs ${LINK_ACCENT}`}
              >
                Open again
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
