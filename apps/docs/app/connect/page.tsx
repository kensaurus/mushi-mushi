/** Public Connect landing — client picker + install lanes. */

'use client'

import { useState } from 'react'
import { CONNECT_SKILLS } from '@/lib/public-copy'
import { MCP_CLIENTS, type McpClientDef, type McpBuildInput } from '@mushi-mushi/mcp/clients'
import { TOOL_CATALOG, TDD_TOOL_CATALOG, CODEBASE_TOOL_CATALOG } from '@mushi-mushi/mcp/catalog'
import {
  ConnectLanePicker,
  useConnectSelection,
  renderConnectClientIcon,
  type ConnectLane,
} from '@mushi-mushi/marketing-ui'

// Derived from the canonical catalog (not hand-typed) so this stat can never
// drift from what's actually callable — see packages/mcp/src/catalog.ts.
const MCP_TOOL_COUNT = TOOL_CATALOG.length + TDD_TOOL_CATALOG.length + CODEBASE_TOOL_CATALOG.length

const CONSOLE_CONNECT_URL = 'https://kensaur.us/mushi-mushi/admin/connect'
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

/**
 * Keyless "try it" demo. When the build is configured with a public,
 * read-only demo key (an `mcp:read` key bound to a seeded demo project),
 * the picker installs against it directly — no signup. We lock it down two
 * ways: `mcp:read` scope (server rejects every write tool) and `readOnly`
 * (`?read_only=1` on the hosted URL hides write tools), and we expose only a
 * safe, read-only feature subset. The key is intentionally public and
 * rotatable; it never grants access to real user data (the project holds only
 * synthetic seeded reports).
 *
 * Set these `NEXT_PUBLIC_MUSHI_DEMO_*` vars at docs build time (see
 * apps/docs/.env.example). When unset, the page falls back to placeholder keys
 * + the "sign in to mint" flow — exactly its previous behaviour.
 */
const DEMO_FEATURES = ['triage', 'docs'] as const
const DEMO_API_KEY = process.env.NEXT_PUBLIC_MUSHI_DEMO_API_KEY ?? ''
const DEMO_ENDPOINT = process.env.NEXT_PUBLIC_MUSHI_DEMO_API_ENDPOINT ?? ''
const DEMO_MCP_HTTP = process.env.NEXT_PUBLIC_MUSHI_DEMO_MCP_HTTP ?? ''
const DEMO_PROJECT_ID = process.env.NEXT_PUBLIC_MUSHI_DEMO_PROJECT_ID ?? ''
const DEMO_PROJECT_NAME = process.env.NEXT_PUBLIC_MUSHI_DEMO_PROJECT_NAME ?? 'mushi-demo'

const DEMO_INPUT: McpBuildInput | null =
  DEMO_API_KEY && DEMO_ENDPOINT && DEMO_MCP_HTTP
    ? {
        projectId: DEMO_PROJECT_ID || undefined,
        projectName: DEMO_PROJECT_NAME,
        apiKey: DEMO_API_KEY,
        endpoint: DEMO_ENDPOINT,
        mcpHttpUrl: DEMO_MCP_HTTP,
        features: DEMO_FEATURES,
        readOnly: true,
      }
    : null

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

function McpLane({ client, input, isDemo }: { client: McpClientDef; input: McpBuildInput; isDemo: boolean }) {
  let result
  try {
    result = client.build(input)
  } catch {
    return <p className="text-sm text-[var(--mushi-vermillion)]">Failed to build config for this client.</p>
  }

  return (
    <div className="space-y-4">
      {isDemo ? (
        <div className="mushi-connect-callout">
          <strong>Live demo — no signup.</strong> Installs <strong>read-only</strong> access to a
          seeded Mushi project so you can try the tools right now.{' '}
          <a href={CONSOLE_CONNECT_URL} className="font-medium underline [@media(hover:hover)]:hover:opacity-80">
            Connect your own project →
          </a>
        </div>
      ) : (
        <div className="mushi-connect-callout">
          <strong>Placeholder key:</strong> Replace{' '}
          <code className="rounded bg-[var(--mushi-paper)] px-1 font-mono text-xs">{PLACEHOLDER_KEY}</code>{' '}
          with your real key.{' '}
          <a href={CONSOLE_CONNECT_URL} className="font-medium underline [@media(hover:hover)]:hover:opacity-80">
            Sign in to auto-fill &amp; one-click install →
          </a>
        </div>
      )}

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
            {isDemo
              ? 'Installs the read-only demo — no signup. Connect your own project to use your data and write tools.'
              : 'This deeplink uses a placeholder key. Sign in to inject your real key automatically.'}
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
        {CONNECT_SKILLS.intro}
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
        <p className="mb-1 text-sm font-semibold text-[var(--mushi-ink)]">{CONNECT_SKILLS.whatAreSkillsTitle}</p>
        <p className="text-sm text-[var(--mushi-ink-muted)]">
          {CONNECT_SKILLS.whatAreSkillsBody}
        </p>
        <a
          href={CONNECT_SKILLS.learnMoreHref}
          className="mt-2 inline-block text-sm font-medium text-[var(--mushi-vermillion)] hover:underline"
        >
          {CONNECT_SKILLS.learnMoreLabel}
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

  const [mode, setMode] = useState<'demo' | 'own'>(DEMO_INPUT ? 'demo' : 'own')
  const isDemo = mode === 'demo' && DEMO_INPUT != null
  const activeInput = isDemo && DEMO_INPUT ? DEMO_INPUT : PLACEHOLDER_INPUT

  function renderLane(lane: ConnectLane, client: McpClientDef) {
    if (lane === 'cli') return <CliLane client={client} />
    if (lane === 'skills') return <SkillsLane client={client} />
    return <McpLane client={client} input={activeInput} isDemo={isDemo} />
  }

  return (
    <div className="min-h-screen bg-[var(--mushi-paper)]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--mushi-ink)] sm:text-4xl">
            Connect your editor
          </h1>
          <p className="mt-2 text-base text-[var(--mushi-ink-muted)]">
            Pick a client below. Demo needs no signup; sign in when you want your own project.
          </p>
          <p className="mt-3 text-xs text-[var(--mushi-ink-muted)]">
            {MCP_CLIENTS.length} clients · {MCP_TOOL_COUNT} MCP tools · usually under 2 minutes
            {' · '}
            <a href={CONSOLE_CONNECT_URL} className="underline decoration-[var(--mushi-rule)] underline-offset-2 hover:text-[var(--mushi-ink)]">
              Sign in to mint a key
            </a>
            {' · '}
            <a
              href="https://kensaur.us/mushi-mushi/docs/quickstart/mcp"
              className="underline decoration-[var(--mushi-rule)] underline-offset-2 hover:text-[var(--mushi-ink)]"
            >
              MCP docs
            </a>
          </p>
        </header>

        {DEMO_INPUT ? (
          <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="Install mode">
            <button
              type="button"
              onClick={() => setMode('demo')}
              aria-pressed={mode === 'demo'}
              className={mode === 'demo' ? 'mushi-connect-primary-btn' : 'mushi-connect-secondary-btn'}
            >
              Try the demo · no signup
            </button>
            <button
              type="button"
              onClick={() => setMode('own')}
              aria-pressed={mode === 'own'}
              className={mode === 'own' ? 'mushi-connect-primary-btn' : 'mushi-connect-secondary-btn'}
            >
              Use my project
            </button>
          </div>
        ) : null}

        <ConnectLanePicker
          clients={clients}
          selectedId={selectedId}
          onSelectClient={selectClient}
          activeLane={activeLane}
          onLaneChange={setActiveLane}
          renderLane={renderLane}
          renderClientIcon={(id) => renderConnectClientIcon(id, 16)}
        />

        <p className="mt-10 text-center text-xs text-[var(--mushi-ink-muted)]">
          Also on{' '}
          <a
            href="https://smithery.ai/servers/kensaurus/mushi-mushi"
            className="underline decoration-[var(--mushi-rule)] underline-offset-2 hover:text-[var(--mushi-ink)]"
            rel="noopener noreferrer"
          >
            Smithery
          </a>
          {' '}for one-click MCP install.
        </p>
      </div>
    </div>
  )
}
