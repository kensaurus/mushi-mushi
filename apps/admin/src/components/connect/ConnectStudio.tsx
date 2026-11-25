/**
 * FILE: apps/admin/src/components/connect/ConnectStudio.tsx
 * PURPOSE: "Pick your editor → connect in one click" for /connect.
 *
 * OVERVIEW:
 * - Shared ConnectLanePicker shell from @mushi-mushi/marketing-ui.
 * - Leads with three common editors and the MCP one-click (ADR 0069); the
 *   other editors sit behind "Other editors", the CLI and skills behind
 *   "Use the CLI or skills instead", the manual endpoint behind "Set it up by hand".
 * - Admin-specific lane bodies: ClientConnectButton mint, CLI steps, Skills copy.
 *
 * DEPENDENCIES:
 * - @mushi-mushi/marketing-ui (ConnectLanePicker, useConnectSelection)
 * - @mushi-mushi/mcp/clients, ClientConnectButton, admin ui primitives
 */

import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import type { McpClientDef } from '@mushi-mushi/mcp/clients'
import {
  ConnectLanePicker,
  useConnectSelection,
  renderConnectClientIcon,
  type ConnectLane,
} from '@mushi-mushi/marketing-ui'
import { ClientConnectButton } from '../ClientConnectButton'
import { CopyButton, Panel, RelativeTime, SegmentedControl } from '../ui'
import { StatusPill } from '../signal/StatusMark'
import { BrandIcon, resolveBrand } from '../ui/BrandIcon'
import { LINK_ACCENT } from '../../lib/chipTone'
import { IconTerminal } from '../icons'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL, RESOLVED_MCP_OAUTH_URL } from '../../lib/env'
import { CONNECT_SKILLS } from '../../lib/public-copy-shared'

const ADMIN_STORAGE_KEY = 'mushi_selected_client'

/** The editors a builder most often uses lead the picker; the rest are one click away. */
const COMMON_CLIENTS: ReadonlySet<string> = new Set(['cursor', 'claude-code', 'vscode'])

const ALT_LANES: { id: Exclude<ConnectLane, 'mcp'>; label: string }[] = [
  { id: 'cli', label: 'CLI' },
  { id: 'skills', label: 'Skills' },
]

function CliCommandBlock({
  title,
  command,
}: {
  title: string
  command: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-fg">{title}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-edge-subtle bg-surface-raised px-2 py-1 font-mono text-xs text-fg-secondary">
          {command}
        </code>
        <CopyButton value={command} label="Copy" copiedLabel="Copied" size="sm" />
      </div>
    </div>
  )
}

function CliLane({ client }: { client: McpClientDef }) {
  const cliInstall = 'npm install -g @mushi-mushi/cli@latest'
  const cliLogin = 'mushi login'
  const cliSetup = client.cliIde
    ? `mushi setup --ide ${client.cliIde}`
    : 'mushi setup'

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">
        Install the CLI, log in, then wire {client.label}. Copy each command into your terminal.
      </p>
      <div className="space-y-3">
        <CliCommandBlock title="Install globally" command={cliInstall} />
        <CliCommandBlock title="Log in" command={cliLogin} />
        <CliCommandBlock
          title={
            client.cliIde
              ? `Wire ${client.label}`
              : `Wire ${client.label} (no CLI IDE flag for this client)`
          }
          command={cliSetup}
        />
      </div>
    </div>
  )
}

function SkillsLane({ client }: { client: McpClientDef }) {
  const skillsCmd = 'npx skills add kensaurus/mushi-mushi'
  // Agent-install prompt (Sentry "Copy Prompt" pattern) — mirrors the public
  // /connect page so both onboarding surfaces lead with the zero-typing path.
  const agentPrompt =
    'Install the Mushi Mushi skills from github.com/kensaurus/mushi-mushi ' +
    '(`npx skills add kensaurus/mushi-mushi`), then run the mushi-setup skill to wire the ' +
    'Mushi Mushi SDK and MCP server into this app and send a test report to verify the connection.'

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">{CONNECT_SKILLS.intro}</p>
      <div className="space-y-2">
        <p className="text-xs font-medium text-fg">Fastest: paste this prompt into {client.label}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-words rounded-md border border-edge-subtle bg-surface-raised px-2 py-1.5 font-mono text-xs text-fg-secondary">
            {agentPrompt}
          </code>
          <CopyButton value={agentPrompt} label="Copy" copiedLabel="Copied" size="sm" />
        </div>
        <p className="text-2xs text-fg-muted">
          Your agent installs the skills, wires the SDK + MCP, and verifies with a test report.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-fg">Or install Mushi Mushi skills yourself</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-words rounded-md border border-edge-subtle bg-surface-raised px-2 py-1.5 font-mono text-xs text-fg-secondary">
            {skillsCmd}
          </code>
          <CopyButton value={skillsCmd} label="Copy" copiedLabel="Copied" size="sm" />
        </div>
        <p className="text-2xs text-fg-muted">
          {/* The names come from CONNECT_SKILLS.skillNames, which
              sync-skills --check holds to the repo's skills/ folder;
              workflow-fix-and-ship is not one of them (QA bug 267). */}
          Adds{' '}
          {CONNECT_SKILLS.skillNames.map((name, i, all) => (
            <Fragment key={name}>
              {i > 0 && (i === all.length - 1 ? ' and ' : ', ')}
              <code className="font-mono text-2xs">{name}</code>
            </Fragment>
          ))}{' '}
          to {client.label}.
        </p>
      </div>
      <div className="rounded-md border border-edge-subtle bg-surface-hover/30 p-3 text-xs text-fg-muted space-y-1">
        <p className="font-medium text-fg">{CONNECT_SKILLS.whatAreSkillsTitle}</p>
        <p>{CONNECT_SKILLS.whatAreSkillsBody}</p>
        <a
          href={CONNECT_SKILLS.learnMoreHref}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-block text-xs ${LINK_ACCENT}`}
        >
          {CONNECT_SKILLS.learnMoreLabel}
        </a>
      </div>
    </div>
  )
}

interface ConnectStudioProps {
  projectId?: string | null
  projectName?: string | null
  /**
   * An editor already connected (lib/connectEditor.ts): the picker folds to
   * "Connected ✓ · add another" until opened (owner, 2026-11-18).
   */
  connectedEditor?: { lastSeenAt: string | null } | null
}

const FOLD_TOGGLE =
  'inline-flex h-7 items-center rounded-sm border border-edge bg-surface-raised px-2 text-2xs font-semibold text-fg ' +
  'motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px hover:border-accent hover:text-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function ConnectStudio({ projectId, projectName, connectedEditor }: ConnectStudioProps) {
  const [addingAnother, setAddingAnother] = useState(false)
  const [allClients, setAllClients] = useState(false)
  const [byHand, setByHand] = useState(false)
  const folded = Boolean(connectedEditor) && !addingAnother
  const {
    clients,
    selectedId,
    activeLane,
    setActiveLane,
    selectClient,
  } = useConnectSelection({ storageKey: ADMIN_STORAGE_KEY })

  const effectiveProjectId = projectId ?? undefined
  const effectiveProjectName = projectName ?? 'My Project'
  // The picked editor always shows, even when it is not one of the three.
  const shownClients = allClients ? clients : clients.filter((c) => COMMON_CLIENTS.has(c.id) || c.id === selectedId)
  const otherCount = clients.length - clients.filter((c) => COMMON_CLIENTS.has(c.id)).length
  const altLane = activeLane === 'mcp' ? null : activeLane
  const selectedClient = clients.find((c) => c.id === selectedId) ?? clients[0]

  function renderLane(lane: ConnectLane, client: McpClientDef) {
    if (lane === 'cli') return <CliLane client={client} />
    if (lane === 'skills') return <SkillsLane client={client} />

    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-fg mb-0.5">{client.description}</p>
          <p className="text-2xs text-fg-muted">
            {client.method === 'deeplink' && 'Opens your IDE install dialog automatically — no copy-paste needed.'}
            {client.method === 'config-json' && 'Copy the JSON config block below into the indicated file.'}
            {client.method === 'cli-command' && 'Run the command below in your terminal.'}
            {client.method === 'remote-url' && 'Use this URL and headers in any MCP-compatible client.'}
          </p>
        </div>

        {effectiveProjectId ? (
          <ClientConnectButton
            client={client}
            projectId={effectiveProjectId}
            projectName={effectiveProjectName}
            endpoint={RESOLVED_EXTERNAL_API_URL}
            mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
            variant="primary"
            size="md"
            accessChoice
          />
        ) : (
          <div className="rounded-md border border-edge-subtle bg-surface-hover/30 px-3 py-2 text-xs text-fg-muted">
            Pick an app above to make a key and install.
          </div>
        )}

        <button
          type="button"
          className={FOLD_TOGGLE}
          aria-expanded={byHand}
          aria-controls="connect-mcp-by-hand"
          onClick={() => setByHand((v) => !v)}
        >
          {byHand ? 'Hide the manual setup' : 'Set it up by hand'}
        </button>
        {byHand && (
        <div id="connect-mcp-by-hand" className="rounded-md border border-edge-subtle bg-surface-hover/30 px-3 py-2">
          <p className="text-2xs font-medium text-fg-muted mb-1">MCP endpoint for OAuth sign-in (manual setup)</p>
          <div className="flex items-center gap-2">
            {/* One line that scrolls: wrapping broke the URL at its hyphen ("mushi-/mushi") on a phone. */}
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-2xs text-fg-secondary">
              {RESOLVED_MCP_OAUTH_URL}
            </code>
            <CopyButton value={RESOLVED_MCP_OAUTH_URL} label="Copy endpoint" copiedLabel="Copied" size="sm" />
          </div>
          {RESOLVED_MCP_OAUTH_URL === RESOLVED_MCP_HTTP_URL ? (
            <p className="mt-1 text-2xs text-fg-faint">
              Send an X-Mushi-Api-Key header, or for Claude Code sign-in add{' '}
              <code className="font-mono">oauth.authServerMetadataUrl</code> ={' '}
              <code className="font-mono break-all">{RESOLVED_MCP_HTTP_URL}/.well-known/oauth-authorization-server</code>.
            </p>
          ) : null}
          <Link to="/mcp" className={`mt-1 inline-flex items-center gap-1 text-2xs ${LINK_ACCENT}`}>
            <IconTerminal size={12} aria-hidden />
            All MCP options →
          </Link>
        </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {connectedEditor && (
        <div
          className="ci-rise flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-ok/45 bg-ok-muted px-3 py-2"
          data-testid="connect-editor-connected"
        >
          <StatusPill status="passed" label="Editor connected" />
          {connectedEditor.lastSeenAt ? (
            <span className="text-xs text-fg-secondary">
              Last check-in <RelativeTime value={connectedEditor.lastSeenAt} />
            </span>
          ) : null}
          <button
            type="button"
            className={`${FOLD_TOGGLE} ml-auto`}
            aria-expanded={!folded}
            aria-controls="connect-client-picker"
            onClick={() => setAddingAnother((v) => !v)}
          >
            {folded ? 'Add another editor' : 'Hide the editor list'}
          </button>
        </div>
      )}
      {!folded && (
      <Panel>
        <div className="p-4 sm:p-5" id="connect-client-picker">
          <ConnectLanePicker
            bordered={false}
            surface="operator"
            clientSectionLabel="Your editor"
            clients={shownClients}
            selectedId={selectedId}
            onSelectClient={selectClient}
            activeLane="mcp"
            onLaneChange={setActiveLane}
            lanes={['mcp']}
            afterClients={
              otherCount > 0 ? (
                <button
                  type="button"
                  className={`${FOLD_TOGGLE} mt-2`}
                  aria-expanded={allClients}
                  onClick={() => setAllClients((v) => !v)}
                  data-testid="connect-other-editors"
                >
                  {allClients ? 'Fewer editors ▴' : `Other editors (${otherCount}) ▾`}
                </button>
              ) : null
            }
            renderLane={renderLane}
            renderClientIcon={(id) =>
              resolveBrand(id) ? (
                <BrandIcon brand={id} size={16} decorative />
              ) : (
                renderConnectClientIcon(id, 16)
              )
            }
          />
          {/* MCP is the one-click path; the CLI and skills are the same setup another way. */}
          <div className="mt-3 space-y-3 border-t border-edge-subtle pt-3">
            <button
              type="button"
              className={FOLD_TOGGLE}
              aria-expanded={altLane !== null}
              aria-controls="connect-alt-lanes"
              onClick={() => setActiveLane(altLane ? 'mcp' : 'cli')}
              data-testid="connect-alt-lanes-toggle"
            >
              {altLane ? 'Hide the CLI and skills' : 'Use the CLI or skills instead'}
            </button>
            {altLane && selectedClient && (
              <div id="connect-alt-lanes" className="space-y-3">
                <SegmentedControl
                  value={altLane}
                  options={ALT_LANES}
                  onChange={setActiveLane}
                  ariaLabel="Setup method"
                  size="sm"
                />
                {renderLane(altLane, selectedClient)}
              </div>
            )}
          </div>
        </div>
      </Panel>
      )}
    </div>
  )
}
