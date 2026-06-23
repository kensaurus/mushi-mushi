/**
 * FILE: apps/docs/app/connect/page.tsx
 * PURPOSE: Public "Connect your AI client" landing page.
 *
 * OVERVIEW:
 * - Hero + stats + console CTA.
 * - Shared ConnectLanePicker with placeholder keys (no auth, no real mint).
 *
 * DEPENDENCIES:
 * - @mushi-mushi/marketing-ui (ConnectLanePicker, useConnectSelection)
 * - @mushi-mushi/mcp/clients
 */

'use client'

import { useState } from 'react'
import { MCP_CLIENTS, type McpClientDef, type McpBuildInput } from '@mushi-mushi/mcp/clients'
import {
  ConnectLanePicker,
  useConnectSelection,
  renderConnectClientIcon,
  type ConnectLane,
} from '@mushi-mushi/marketing-ui'

const CONSOLE_CONNECT_URL = 'https://app.mushimushi.dev/connect'
const PLACEHOLDER_KEY = '<your-mushi-api-key>'
const PLACEHOLDER_ENDPOINT = 'https://YOUR-PROJECT.supabase.co/functions/v1/api'
const PLACEHOLDER_MCP_HTTP = 'https://YOUR-PROJECT.supabase.co/functions/v1/mcp'
const PLACEHOLDER_PROJECT_NAME = 'my-app'
const PUBLIC_STORAGE_KEY = 'mushi_selected_client_public'

const PLACEHOLDER_INPUT: McpBuildInput = {
  projectName: PLACEHOLDER_PROJECT_NAME,
  apiKey: PLACEHOLDER_KEY,
  endpoint: PLACEHOLDER_ENDPOINT,
  mcpHttpUrl: PLACEHOLDER_MCP_HTTP,
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {label ? <span className="text-xs text-[var(--mushi-ink-muted)]">{label}</span> : <span />}
        <button
          type="button"
          onClick={copy}
          className="mushi-connect-copy-btn"
          aria-label={copied ? 'Copied to clipboard' : `Copy ${label || 'command'} to clipboard`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mushi-connect-code-block">{text}</pre>
    </div>
  )
}

function McpLane({ client }: { client: McpClientDef }) {
  let result
  try {
    result = client.build(PLACEHOLDER_INPUT)
  } catch {
    return <p className="text-sm text-[var(--mushi-vermillion)]">Failed to build config for this client.</p>
  }

  return (
    <div className="space-y-4">
      <div className="mushi-connect-callout">
        <strong>Placeholder key:</strong> Replace{' '}
        <code className="rounded bg-[var(--mushi-paper)] px-1 font-mono text-xs">{PLACEHOLDER_KEY}</code>{' '}
        with your real key.{' '}
        <a href={CONSOLE_CONNECT_URL} className="font-medium underline [@media(hover:hover)]:hover:opacity-80">
          Sign in to auto-fill &amp; one-click install →
        </a>
      </div>

      <p className="text-sm text-[var(--mushi-ink-muted)]">
        <strong className="text-[var(--mushi-ink)]">{client.description}</strong>
        {' '}
        {result.kind === 'deeplink' && '— click to open your IDE install dialog.'}
        {result.kind === 'config' && `— copy into ${result.filePath}`}
        {result.kind === 'command' && '— run in your terminal.'}
        {result.kind === 'remote-url' && '— use in any MCP-compatible client.'}
      </p>

      {result.kind === 'deeplink' && (
        <div className="space-y-3">
          <a href={result.url} className="mushi-connect-primary-btn">
            Open {client.label} install dialog ↗
          </a>
          <p className="text-xs text-[var(--mushi-ink-muted)]">
            This deeplink uses a placeholder key. Sign in to inject your real key automatically.
          </p>
          <details className="group">
            <summary className="cursor-pointer text-xs text-[var(--mushi-ink-muted)] hover:text-[var(--mushi-ink)]">
              Show raw deeplink URL
            </summary>
            <div className="mt-2">
              <CopyBlock label="Deeplink URL" text={result.url} />
            </div>
          </details>
        </div>
      )}

      {result.kind === 'config' && (
        <CopyBlock label={`Paste into ${result.filePath}`} text={result.json} />
      )}

      {result.kind === 'command' && (
        <CopyBlock label="Run in terminal" text={result.text} />
      )}

      {result.kind === 'remote-url' && (
        <div className="space-y-3">
          <CopyBlock label="MCP endpoint URL" text={result.url} />
          <CopyBlock label="Required headers" text={result.headerSnippet} />
        </div>
      )}
    </div>
  )
}

function CliLane({ client }: { client: McpClientDef }) {
  const cliInstall = 'npm install -g @mushi-mushi/cli@latest'
  const cliLogin = 'mushi login'
  const cliSetup = client.cliIde ? `mushi setup --ide ${client.cliIde}` : 'mushi setup'

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--mushi-ink-muted)]">
        Install the Mushi CLI once, log in, and wire any supported IDE in seconds.
      </p>
      <ol className="space-y-4">
        {[
          { step: 1, label: 'Install globally', cmd: cliInstall },
          { step: 2, label: 'Log in', cmd: cliLogin },
          { step: 3, label: `Wire ${client.label}`, cmd: cliSetup },
        ].map(({ step, label, cmd }) => (
          <li key={step} className="flex items-start gap-3">
            <span className="mushi-connect-step-badge">{step}</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-medium text-[var(--mushi-ink)]">{label}</p>
              <CopyBlock label="" text={cmd} />
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-[var(--mushi-ink-muted)]">
        Also available: <code className="font-mono">mushi doctor --server</code>{' · '}
        <code className="font-mono">mushi qa stories</code>{' · '}
        <code className="font-mono">mushi upgrade</code>
      </p>
    </div>
  )
}

function SkillsLane({ client }: { client: McpClientDef }) {
  const skillsCmd = 'npx skills add kensaurus/cursor-kenji'

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--mushi-ink-muted)]">
        Agent skills extend your AI coding agent with task-specific playbooks — bug triage,
        fix-and-ship, QA, security audit, and more.
      </p>
      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--mushi-ink)]">
          Install Mushi skills into {client.label}
        </p>
        <CopyBlock label="" text={skillsCmd} />
        <p className="text-xs text-[var(--mushi-ink-muted)]">
          Adds <code className="font-mono text-xs">mushi-health</code>,{' '}
          <code className="font-mono text-xs">mushi-integration</code>,{' '}
          <code className="font-mono text-xs">workflow-fix-and-ship</code> and more.
        </p>
      </div>
      <div className="rounded-md border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] p-4">
        <p className="mb-1 text-sm font-semibold text-[var(--mushi-ink)]">What are skills?</p>
        <p className="text-sm text-[var(--mushi-ink-muted)]">
          Skills are SKILL.md playbooks your AI agent can read on demand. They live in GitHub repos
          and are synced into Mushi&apos;s skill catalog so the triage stage recommends the right
          playbook for each bug.
        </p>
        <a
          href="https://kensaur.us/mushi-mushi/docs/sdks/skills"
          className="mt-2 inline-block text-sm font-medium text-[var(--mushi-vermillion)] hover:underline"
        >
          Learn about skills →
        </a>
      </div>
    </div>
  )
}

export default function ConnectPage() {
  const {
    clients,
    selectedId,
    activeLane,
    setActiveLane,
    selectClient,
  } = useConnectSelection({ storageKey: PUBLIC_STORAGE_KEY })

  function renderLane(lane: ConnectLane, client: McpClientDef) {
    if (lane === 'cli') return <CliLane client={client} />
    if (lane === 'skills') return <SkillsLane client={client} />
    return <McpLane client={client} />
  }

  return (
    <div className="min-h-screen bg-[var(--mushi-paper)]">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">

        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] px-3 py-1 text-xs font-medium text-[var(--mushi-ink-muted)]">
            MCP Integration
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--mushi-ink)] sm:text-5xl">
            Connect your AI&nbsp;agent
          </h1>
          <p className="mt-4 text-lg text-[var(--mushi-ink-muted)]">
            Pick your client. Connect in one click. Start debugging with context in under
            two minutes.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a href={CONSOLE_CONNECT_URL} className="mushi-connect-primary-btn">
              Sign in to one-click install
            </a>
            <a
              href="https://kensaur.us/mushi-mushi/docs/quickstart/mcp"
              className="mushi-connect-secondary-btn"
            >
              Read the docs →
            </a>
          </div>
        </div>

        <div className="mb-8">
          <ConnectLanePicker
            clients={clients}
            selectedId={selectedId}
            onSelectClient={selectClient}
            activeLane={activeLane}
            onLaneChange={setActiveLane}
            renderLane={renderLane}
            renderClientIcon={(id) => renderConnectClientIcon(id, 16)}
          />
        </div>

        <div className="mt-10 grid grid-cols-3 gap-4 text-center">
          {[
            { label: 'AI clients', value: String(MCP_CLIENTS.length) },
            { label: 'MCP tools', value: '71+' },
            { label: 'Setup time', value: '< 2 min' },
          ].map((item) => (
            <div key={item.label} className="rounded-md border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] p-4">
              <p className="text-2xl font-bold text-[var(--mushi-ink)]">{item.value}</p>
              <p className="mt-0.5 text-xs text-[var(--mushi-ink-muted)]">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-md border border-[color-mix(in_oklch,var(--mushi-vermillion)_25%,var(--mushi-rule))] bg-[var(--mushi-vermillion-wash)] p-6 text-center">
          <p className="text-sm font-semibold text-[var(--mushi-vermillion-ink)]">
            Ready to go live?
          </p>
          <p className="mt-1 text-sm text-[var(--mushi-ink-muted)]">
            Sign in to the console and mint a project key. The client picker above will
            auto-fill your key and open your IDE in one click.
          </p>
          <a href={CONSOLE_CONNECT_URL} className="mt-4 inline-flex mushi-connect-primary-btn">
            Sign in &amp; connect →
          </a>
        </div>
      </div>
    </div>
  )
}
