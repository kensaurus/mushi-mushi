/**
 * FILE: apps/admin/src/components/connect/ConnectStudio.tsx
 * PURPOSE: Three-lane "pick your client → connect in one click" hero for /connect.
 *
 * OVERVIEW:
 * - Shared ConnectLanePicker shell from @mushi-mushi/marketing-ui.
 * - Admin-specific lane bodies: ClientConnectButton mint, CLI steps, Skills copy.
 *
 * DEPENDENCIES:
 * - @mushi-mushi/marketing-ui (ConnectLanePicker, useConnectSelection)
 * - @mushi-mushi/mcp/clients, ClientConnectButton, admin ui primitives
 */

import { Link } from 'react-router-dom'
import type { McpClientDef } from '@mushi-mushi/mcp/clients'
import {
  ConnectLanePicker,
  useConnectSelection,
  renderConnectClientIcon,
  type ConnectLane,
} from '@mushi-mushi/marketing-ui'
import { ClientConnectButton } from '../ClientConnectButton'
import { CopyButton, Panel } from '../ui'
import { LINK_BRAND } from '../../lib/chipTone'
import { IconTerminal } from '../icons'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../../lib/env'

const ADMIN_STORAGE_KEY = 'mushi_selected_client'

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
  const skillsCmd = 'npx skills add kensaurus/cursor-kenji'

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">
        Agent skills extend your AI coding agent with task-specific playbooks — fix-and-ship,
        QA, security audit, and more. The Mushi skill set includes Mushi-specific incident-loop
        and triage workflows.
      </p>
      <div className="space-y-2">
        <p className="text-xs font-medium text-fg">Install Mushi skills</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-edge-subtle bg-surface-raised px-2 py-1.5 font-mono text-xs text-fg-secondary">
            {skillsCmd}
          </code>
          <CopyButton value={skillsCmd} label="Copy" copiedLabel="Copied" size="sm" />
        </div>
        <p className="text-2xs text-fg-muted">
          Adds <code className="font-mono text-2xs">mushi-health</code>,{' '}
          <code className="font-mono text-2xs">mushi-integration</code>,{' '}
          <code className="font-mono text-2xs">workflow-fix-and-ship</code> and more to{' '}
          {client.label}.
        </p>
      </div>
      <div className="rounded-md border border-edge-subtle bg-surface-hover/30 p-3 text-xs text-fg-muted space-y-1">
        <p className="font-medium text-fg">What are skills?</p>
        <p>
          Skills are SKILL.md files your AI agent can read on demand — like specialised instructions
          for each task type. They live in a GitHub repo and are synced into Mushi&apos;s skill catalog
          so the classify-report stage can recommend the right playbook for each bug.
        </p>
        <a
          href="https://kensaur.us/mushi-mushi/docs/sdks/skills"
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-block text-xs ${LINK_BRAND}`}
        >
          Learn about skills →
        </a>
      </div>
    </div>
  )
}

interface ConnectStudioProps {
  projectId?: string | null
  projectName?: string | null
}

export function ConnectStudio({ projectId, projectName }: ConnectStudioProps) {
  const {
    clients,
    selectedId,
    activeLane,
    setActiveLane,
    selectClient,
  } = useConnectSelection({ storageKey: ADMIN_STORAGE_KEY })

  const effectiveProjectId = projectId ?? undefined
  const effectiveProjectName = projectName ?? 'My Project'

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
          />
        ) : (
          <div className="rounded-md border border-edge-subtle bg-surface-hover/30 px-3 py-2 text-xs text-fg-muted">
            Select a project above to mint a key and install.
          </div>
        )}

        <div className="rounded-md border border-edge-subtle bg-surface-hover/30 px-3 py-2">
          <p className="text-2xs font-medium text-fg-muted mb-1">MCP HTTP endpoint (for manual setup)</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-2xs text-fg-secondary">
              {RESOLVED_MCP_HTTP_URL}
            </code>
            <CopyButton value={RESOLVED_MCP_HTTP_URL} label="Copy endpoint" copiedLabel="Copied" size="sm" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="p-4 sm:p-5">
          <ConnectLanePicker
            bordered={false}
            clients={clients}
            selectedId={selectedId}
            onSelectClient={selectClient}
            activeLane={activeLane}
            onLaneChange={setActiveLane}
            renderLane={renderLane}
            renderClientIcon={(id) => renderConnectClientIcon(id, 16)}
          />
        </div>
      </Panel>

      <div className="flex items-center gap-2 text-2xs text-fg-muted px-1">
        <IconTerminal size={12} aria-hidden />
        <span>
          Want the full manual setup?{' '}
          <Link to="/mcp" className={LINK_BRAND}>
            Open MCP console →
          </Link>
        </span>
      </div>
    </div>
  )
}
