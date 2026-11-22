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
 * - Claude Code (`oauthDefault`) is keyless first: the URL-only command the
 *   docs give, signed in from Claude Code with OAuth. The key command is a
 *   second action, "For CI or headless use", whose label says a key is made
 *   (re-audit 2026-11-11: Connect minted a key and put it in a --header while
 *   the docs said OAuth with no header).
 * - Writes the published @mushi-mushi/mcp version (sdk_versions catalog) into
 *   stdio configs, not the version this console was built with.
 * - Used by the ConnectStudio client grid and
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
import {
  buildOAuthInstall,
  MCP_OAUTH_CLIENT_IDS,
  type McpBuildInput,
  type McpBuildResult,
  type McpClientDef,
  type McpOAuthClientId,
} from '@mushi-mushi/mcp/clients'
import { RESOLVED_MCP_HTTP_URL, RESOLVED_MCP_OAUTH_URL } from '../lib/env'
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
  /**
   * The hosted MCP URL that runs the client's OAuth sign-in. Defaults to this
   * console's; a self-hosted one equals `mcpHttpUrl` and has no sign-in, so
   * the key install stays the only one there.
   */
  mcpOAuthUrl?: string
}

function isOAuthClientId(id: string): id is McpOAuthClientId {
  return (MCP_OAUTH_CLIENT_IDS as readonly string[]).includes(id)
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
  mcpOAuthUrl = RESOLVED_MCP_OAUTH_URL,
}: ClientConnectButtonProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<McpBuildResult | null>(null)
  const [showBlock, setShowBlock] = useState(expanded)
  const [access, setAccess] = useState<McpAccess>('read_write')
  const accessId = useId()
  // OAuth sign-in first, when this console's hosted MCP URL can run it.
  const oauthFirst =
    client.oauthDefault === true && isOAuthClientId(client.id) && !preMintedKey && mcpOAuthUrl !== RESOLVED_MCP_HTTP_URL
  /** Which install the open block shows: the OAuth one, or the one with a key. */
  const [withKey, setWithKey] = useState(false)
  // A keyless client (Lovable) signs in with OAuth on first use: no key is minted.
  const mints = !preMintedKey && Boolean(projectId) && client.keyless !== true
  const mintScopes = scopes ?? scopesForAccess(access)

  function showOAuthInstall() {
    if (!isOAuthClientId(client.id)) return
    setWithKey(false)
    setResult(buildOAuthInstall(client.id, { mcpOAuthUrl }))
    setShowBlock(true)
  }

  async function handleConnect() {
    setLoading(true)
    try {
      setWithKey(true)
      let apiKey = preMintedKey ?? (client.keyless ? '' : undefined)
      const pinPromise = getPublishedMcpPinSpec()
      if (!apiKey && projectId && !client.keyless) {
        try {
          apiKey = await getOrMintMcpKey({ projectId, clientId: client.id, clientLabel: client.label, scopes: mintScopes })
        } catch (err) {
          // The server's own reason (e.g. owner/admin required), not a guess.
          toast.error('Could not create a key', err instanceof Error ? err.message : undefined)
          return
        }
      }
      if (!apiKey && !client.keyless) {
        toast.error('No API key', 'Provide a projectId to mint a key, or pass apiKey directly.')
        return
      }

      const input: McpBuildInput = {
        projectId,
        projectName,
        apiKey: apiKey ?? '',
        endpoint,
        mcpHttpUrl,
        pinSpec: await pinPromise,
      }
      const built = client.build(input)
      setResult(built)

      if (built.kind === 'deeplink') {
        window.open(built.url, '_self')
        toast.success(`${client.label} install launched`, 'The IDE install dialog should open.')
      }
      // Deeplinks too: the "Open again" block below only renders with
      // showBlock set, so it was unreachable (QA bug 125).
      setShowBlock(true)
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
        : client.keyless
          ? `Add to ${client.label}`
          : `Show ${client.label} config`

  return (
    <div>
      {!showBlock && (
        <Btn
          size={size}
          variant={variant}
          loading={loading}
          disabled={loading}
          onClick={() => (oauthFirst ? showOAuthInstall() : void handleConnect())}
        >
          {buttonLabel}
        </Btn>
      )}

      {!showBlock && mints && accessChoice && !scopes && !oauthFirst && (
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
              {oauthFirst && !withKey && (
                <div className="mt-2 space-y-1.5" data-testid="oauth-install-next">
                  <p className="text-xs text-fg-secondary">
                    Then in {client.label} type <code className="mushi-code-inline font-mono">/mcp</code>, pick{' '}
                    <code className="mushi-code-inline font-mono">mushi</code> and choose Authenticate. Your browser
                    opens, you sign in and pick the projects it may see. No key is created or copied.
                  </p>
                  {mints && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-2xs text-fg-muted">For CI or headless use (no browser to sign in with):</span>
                      <Btn
                        type="button"
                        size="sm"
                        variant="ghost"
                        loading={loading}
                        disabled={loading}
                        onClick={() => void handleConnect()}
                      >
                        Create a key and show the command with it
                      </Btn>
                    </div>
                  )}
                </div>
              )}
              {oauthFirst && withKey && (
                <p className="mt-2 text-2xs text-fg-muted">
                  A key was created for this command and is part of it. Keep it out of shared logs; revoke it under
                  Projects, Keys.
                </p>
              )}
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
              <ConfigCopySection label={client.keyless ? 'Server URL' : 'MCP endpoint URL'} text={result.url} />
              {result.headerSnippet ? <ConfigCopySection label="Required headers" text={result.headerSnippet} /> : null}
              {result.steps?.length ? (
                <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-fg-secondary">
                  {result.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
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
              <span className="text-xs text-fg-muted">{client.label} install dialog should have opened.</span>
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
