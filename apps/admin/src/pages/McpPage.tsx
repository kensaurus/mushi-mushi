/**
 * FILE: apps/admin/src/pages/McpPage.tsx
 * PURPOSE: "MCP for beginners" — a single, self-explaining surface that
 *          answers the three questions dogfooders kept asking:
 *
 *              1. What is this for?  (pitch + use cases)
 *              2. How do I wire it up?  (copy-paste .cursor/mcp.json + .env.local)
 *              3. What can an agent actually do?  (tool catalog with hints)
 *
 *          The page is deliberately read-only — it doesn't mint keys.
 *          Minting lives on /projects where scope presets and revocation
 *          already live. This page links there for that flow.
 *
 *          Design-system notes:
 *          - Uses the same `<Card className="p-5 space-y-4">` + `<h3 className="text-sm font-semibold text-fg">`
 *            rhythm as OnboardingPage so the two beginner surfaces feel like one flow.
 *          - Semantic colour tokens (`ok`, `warn`, `danger`, `info`, `accent`) — never
 *            `success` (that token does not exist; earlier revisions rendered transparent).
 *          - Tabs match the SDK-snippet tabs on /onboarding (brand pill).
 */

import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  EmptyState,
} from '../components/ui'
import { IconIntegrations, IconCopy, IconCheck, IconArrowRight } from '../components/icons'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  TOOL_CATALOG,
  RESOURCE_CATALOG,
  PROMPT_CATALOG,
  type ToolSpec,
  type McpScope,
} from '../lib/mcpCatalog'

interface McpStatus {
  activeProject: { id: string; name: string } | null
  hasReadKey: boolean
  hasWriteKey: boolean
  activeKeyCount: number
}

interface ProjectsResponse {
  projects: Array<{
    id: string
    name: string
    api_keys: Array<{ is_active: boolean; revoked: boolean; scopes?: string[] }>
  }>
}

function deriveStatus(data: ProjectsResponse | null, activeId: string | null): McpStatus {
  const active = activeId
    ? data?.projects.find((p) => p.id === activeId)
    : data?.projects[0]
  if (!active) {
    return { activeProject: null, hasReadKey: false, hasWriteKey: false, activeKeyCount: 0 }
  }
  const liveKeys = active.api_keys.filter((k) => k.is_active && !k.revoked)
  const hasWrite = liveKeys.some((k) => (k.scopes ?? []).includes('mcp:write'))
  const hasRead = hasWrite || liveKeys.some((k) => (k.scopes ?? []).includes('mcp:read'))
  return {
    activeProject: { id: active.id, name: active.name },
    hasReadKey: hasRead,
    hasWriteKey: hasWrite,
    activeKeyCount: liveKeys.length,
  }
}

function scopeBadgeTone(scope: McpScope): string {
  return scope === 'mcp:write'
    ? 'bg-warn-muted text-warn border border-warn/30'
    : 'bg-info-muted text-info border border-info/30'
}

function hintBadges(spec: ToolSpec) {
  const chips: Array<{ label: string; tone: string; title: string }> = []
  if (spec.hints.readOnly) {
    chips.push({
      label: 'read-only',
      tone: 'bg-ok-muted text-ok border border-ok/30',
      title: 'Client can auto-approve. No side effects.',
    })
  } else {
    chips.push({
      label: 'writes',
      tone: 'bg-warn-muted text-warn border border-warn/30',
      title: 'Will mutate data. Your client should prompt for confirmation.',
    })
  }
  if (spec.hints.destructive) {
    chips.push({
      label: 'destructive',
      tone: 'bg-danger-muted text-danger border border-danger/30',
      title: 'Can remove data from triage queues. Confirm every call.',
    })
  }
  if (spec.hints.idempotent) {
    chips.push({
      label: 'idempotent',
      tone: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
      title: 'Calling twice with the same args is safe.',
    })
  }
  return chips
}

function buildCursorJson(projectId: string, projectName: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [`mushi-${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}`]: {
          command: 'npx',
          args: ['-y', 'mushi-mcp@latest'],
          env: {
            MUSHI_API_ENDPOINT: 'https://api.mushimushi.dev',
            MUSHI_API_KEY: 'paste-your-key-here',
            MUSHI_PROJECT_ID: projectId,
          },
        },
      },
    },
    null,
    2,
  )
}

function buildEnvBlock(projectId: string): string {
  return [
    '# Mushi MCP — paste into .env.local (gitignored).',
    'MUSHI_API_ENDPOINT=https://api.mushimushi.dev',
    'MUSHI_API_KEY=paste-your-key-here',
    `MUSHI_PROJECT_ID=${projectId}`,
    '',
  ].join('\n')
}

interface UseCase {
  title: string
  ask: string
  calls: string[]
}

const USE_CASES: UseCase[] = [
  {
    title: 'Start my day',
    ask: 'What should I focus on right now?',
    calls: ['triage_next_steps', 'project://dashboard', 'get_recent_reports'],
  },
  {
    title: 'Fix a specific bug',
    ask: 'Fix rep_abc123.',
    calls: ['summarize_report_for_fix', 'get_fix_context', 'get_blast_radius', 'submit_fix_result'],
  },
  {
    title: 'Debug a failed fix',
    ask: 'Why did fix_xyz fail?',
    calls: ['get_fix_timeline', 'explain_judge_result'],
  },
  {
    title: 'Spot duplicates fast',
    ask: 'Have we seen a bug like this before in Checkout?',
    calls: ['get_similar_bugs'],
  },
  {
    title: 'Ask production data in English',
    ask: 'Which components had the most critical bugs this week?',
    calls: ['run_nl_query'],
  },
]

interface QuickstartStepProps {
  n: number
  title: string
  body: React.ReactNode
  tone: 'idle' | 'done' | 'next'
}

function QuickstartStep({ n, title, body, tone }: QuickstartStepProps) {
  const badgeTone =
    tone === 'done'
      ? 'bg-ok-muted text-ok border-ok/40'
      : tone === 'next'
        ? 'bg-brand text-brand-fg border-brand'
        : 'bg-surface-overlay text-fg-muted border-edge-subtle'
  return (
    <div className="flex gap-3 items-start">
      <span
        className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold ${badgeTone}`}
        aria-hidden="true"
      >
        {tone === 'done' ? <IconCheck className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <div className="text-xs text-fg-muted mt-0.5">{body}</div>
      </div>
    </div>
  )
}

export function McpPage() {
  const activeId = useActiveProjectId()
  const toast = useToast()
  const [snippetMode, setSnippetMode] = useState<'cursor' | 'env'>('cursor')
  const [copied, setCopied] = useState(false)

  const { data, loading, error } = usePageData<ProjectsResponse>('/v1/admin/projects', { deps: [activeId] })
  const status = useMemo(() => deriveStatus(data, activeId), [data, activeId])

  async function copy(payload: string, label: string) {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      toast.success(`${label} copied.`)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Clipboard blocked — select the text and copy manually.')
    }
  }

  const projectId = status.activeProject?.id ?? '<your-project-id>'
  const projectName = status.activeProject?.name ?? 'project'
  const snippet = snippetMode === 'cursor' ? buildCursorJson(projectId, projectName) : buildEnvBlock(projectId)

  const readTools = TOOL_CATALOG.filter((t) => t.scope === 'mcp:read')
  const writeTools = TOOL_CATALOG.filter((t) => t.scope === 'mcp:write')

  const step1Tone: QuickstartStepProps['tone'] = status.hasReadKey ? 'done' : 'next'
  const step2Tone: QuickstartStepProps['tone'] = status.hasReadKey ? 'next' : 'idle'
  const step3Tone: QuickstartStepProps['tone'] = 'idle'

  return (
    <div className="space-y-5">
      <PageHeader
        title="MCP — Model Context Protocol"
        description="Connect Cursor, Claude Desktop, or any MCP-aware agent to this project's live triage queue. Agents read reports, dispatch fixes, and log PRs without copy-pasting IDs into chat."
        projectScope={status.activeProject?.name ?? null}
      >
        <Link to="/projects">
          <Btn variant="ghost" size="sm" data-testid="mcp-mint-key-link">
            Mint an API key
          </Btn>
        </Link>
      </PageHeader>

      <PageHelp
        title="MCP — Model Context Protocol"
        whatIsIt="MCP is an open protocol that lets a coding agent (Cursor, Claude Desktop, Windsurf, etc.) call your app's tools and read its data as if they were local. Mushi ships an MCP server (`mushi-mcp`) that exposes this project's triage queue — reports, fixes, the knowledge graph, NL-to-SQL — as tools the agent can call during a chat."
        useCases={[
          'Ask your agent "what should I fix next?" and get a prioritised answer drawn from your live dashboard.',
          'Say "fix bug rep_abc" and watch the agent pull the full context bundle, propose a patch, and log the PR against the report.',
          'Ask "why did this fix fail?" and get a human verdict from the judge scores + timeline.',
          'Run natural-language queries against your production data without leaving the chat.',
        ]}
        howToUse={
          '1. On /projects, pick a scope preset (MCP read-only to browse, MCP read + write to dispatch). ' +
          '2. Click "Mint key" — the reveal card shows the exact .env.local and .cursor/mcp.json blocks to copy. ' +
          '3. Paste the .cursor/mcp.json block into your IDE\'s MCP settings, then restart the IDE. ' +
          '4. Ask your agent "list mushi tools" to confirm the handshake.'
        }
      />

      {/* ── Quickstart strip ─────────────────────────────────────────
          Three honest steps that drive the whole onboarding:
          mint → paste → ask. Connection-state-aware, so returning
          users see "step 1 done" instead of the same flat sequence. */}
      <Card className="p-5 space-y-4" data-testid="mcp-quickstart">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-fg-muted [&>svg]:h-4 [&>svg]:w-4"><IconIntegrations /></span>
            <h3 className="text-sm font-semibold text-fg">Get an agent talking to this project in 60 seconds</h3>
          </div>
          {loading ? (
            <span className="text-2xs text-fg-muted">Checking keys…</span>
          ) : error ? (
            <span className="text-2xs text-danger">Couldn&apos;t load key status</span>
          ) : !status.activeProject ? (
            <span className="text-2xs text-fg-muted">Pick a project first</span>
          ) : (
            <div className="flex items-center gap-1.5" data-testid="mcp-status-strip">
              <Badge
                className={status.hasReadKey
                  ? 'bg-ok-muted text-ok border border-ok/30'
                  : 'bg-surface-overlay text-fg-muted border border-edge-subtle'}
                data-testid="mcp-read-status"
              >
                {status.hasReadKey ? 'mcp:read ✓' : 'mcp:read —'}
              </Badge>
              <Badge
                className={status.hasWriteKey
                  ? 'bg-ok-muted text-ok border border-ok/30'
                  : 'bg-surface-overlay text-fg-muted border border-edge-subtle'}
                data-testid="mcp-write-status"
              >
                {status.hasWriteKey ? 'mcp:write ✓' : 'mcp:write —'}
              </Badge>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <QuickstartStep
            n={1}
            tone={step1Tone}
            title="Mint an API key"
            body={
              status.hasReadKey ? (
                <span>
                  <span className="text-ok">{status.activeKeyCount} active key{status.activeKeyCount === 1 ? '' : 's'}</span> on{' '}
                  <span className="font-mono text-fg-secondary">{projectName}</span>. Mint more anytime.
                </span>
              ) : (
                <span>
                  Pick <span className="text-fg">MCP read</span> to browse or{' '}
                  <span className="text-fg">MCP read + write</span> to dispatch fixes.
                </span>
              )
            }
          />
          <QuickstartStep
            n={2}
            tone={step2Tone}
            title="Paste the snippet"
            body={
              <>
                Drop the <span className="font-mono text-fg-secondary">.cursor/mcp.json</span> block into your IDE (or the{' '}
                <span className="font-mono text-fg-secondary">.env.local</span> block into your repo), then restart.
              </>
            }
          />
          <QuickstartStep
            n={3}
            tone={step3Tone}
            title="Ask the agent"
            body={
              <>
                Type <span className="font-mono text-fg-secondary">"list mushi tools"</span> — you should see all {TOOL_CATALOG.length} tools below.
              </>
            }
          />
        </div>

        {!status.hasReadKey && !loading && status.activeProject && (
          <div className="pt-1">
            <Link to="/projects">
              <Btn size="sm" data-testid="mcp-status-mint">
                Mint a key on /projects
                <IconArrowRight className="h-3.5 w-3.5 ml-1" />
              </Btn>
            </Link>
          </div>
        )}
      </Card>

      {/* ── Install card ─────────────────────────────────────────────
          Tabs match the SDK-snippet tabs on /onboarding so the two
          beginner surfaces feel like a single IA. */}
      <Card className="p-5 space-y-4" data-testid="mcp-install">
        <div>
          <h3 className="text-sm font-semibold text-fg">Install snippet</h3>
          <p className="text-xs text-fg-muted mt-1">
            Your active project id is pre-filled. Replace{' '}
            <code className="mx-0.5 px-1 py-0.5 rounded bg-surface-raised text-fg-secondary font-mono text-2xs">paste-your-key-here</code>{' '}
            with a key minted on <Link to="/projects" className="text-accent hover:underline">/projects</Link>.
          </p>
        </div>

        <div className="flex gap-1 border-b border-edge-subtle pb-2">
          {(['cursor', 'env'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSnippetMode(m)}
              data-testid={`mcp-snippet-mode-${m}`}
              className={`px-2.5 py-1 rounded-sm text-xs transition-colors ${
                snippetMode === m
                  ? 'bg-brand text-brand-fg font-medium'
                  : 'text-fg-muted hover:text-fg hover:bg-surface-overlay'
              }`}
            >
              {m === 'cursor' ? '.cursor/mcp.json' : '.env.local'}
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">
              {snippetMode === 'cursor' ? 'Drop into your IDE settings' : 'Drop into your repo root'}
            </span>
            <button
              type="button"
              onClick={() => copy(snippet, snippetMode === 'cursor' ? '.cursor/mcp.json block' : '.env.local block')}
              data-testid="mcp-snippet-copy"
              className="inline-flex items-center gap-1 text-2xs text-brand hover:text-brand-hover"
            >
              {copied ? (
                <>
                  <IconCheck className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <IconCopy className="h-3 w-3" />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre
            className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-2xs font-mono text-fg-secondary overflow-auto whitespace-pre-wrap wrap-anywhere max-h-64 select-all"
            data-testid="mcp-snippet"
          >
            {snippet}
          </pre>
        </div>
      </Card>

      {/* ── Use cases ────────────────────────────────────────────────
          Each card shows (agent ask) + (tool chain it will run) so a
          beginner can see the shape of an MCP conversation without
          actually running one. */}
      <Card className="p-5 space-y-4" data-testid="mcp-use-cases-card">
        <div>
          <h3 className="text-sm font-semibold text-fg">What agents do with this</h3>
          <p className="text-xs text-fg-muted mt-1">
            Five real asks you can paste into your agent. Each one is one or two MCP calls under the hood.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="mcp-use-cases">
          {USE_CASES.map((uc) => (
            <div
              key={uc.title}
              className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3 space-y-2 motion-safe:transition-colors hover:border-edge"
            >
              <div className="text-xs font-semibold text-fg">{uc.title}</div>
              <div className="text-sm text-fg-secondary leading-snug">
                <span className="text-accent">“</span>
                {uc.ask}
                <span className="text-accent">”</span>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {uc.calls.map((c) => (
                  <code
                    key={c}
                    className="font-mono text-2xs text-fg-muted bg-surface-overlay border border-edge-subtle rounded-sm px-1.5 py-0.5"
                  >
                    {c}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Tool catalog ─────────────────────────────────────────────
          Grouped by scope so the read-only (always-safe) half is
          visually separated from the mutating half. */}
      <Card className="p-5 space-y-4" data-testid="mcp-tool-catalog-card">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-fg" data-testid="mcp-tool-catalog-header">
              Tools ({TOOL_CATALOG.length})
            </h3>
            <p className="text-xs text-fg-muted mt-1">
              Every tool the MCP server advertises. Badges tell you whether it's safe to auto-approve.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-2xs text-fg-muted">
            <Badge className="bg-info-muted text-info border border-info/30">mcp:read</Badge>
            <Badge className="bg-warn-muted text-warn border border-warn/30">mcp:write</Badge>
          </div>
        </div>

        <div>
          <h4 className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-2">
            Read — always safe to loop on
          </h4>
          <div className="grid gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-read">
            {readTools.map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-2">
            Write — mutate project state
          </h4>
          <div className="grid gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-write">
            {writeTools.map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>
      </Card>

      {/* ── Resources + Prompts ──────────────────────────────────── */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Resources ({RESOURCE_CATALOG.length})</h3>
            <p className="text-xs text-fg-muted mt-1">
              URIs the agent can re-read whenever the chat needs fresh numbers.
            </p>
          </div>
          <div className="space-y-2" data-testid="mcp-resource-catalog">
            {RESOURCE_CATALOG.map((r) => (
              <div
                key={r.name}
                className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3 motion-safe:transition-colors hover:border-edge"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <code className="text-xs font-mono text-fg wrap-anywhere">{r.uri}</code>
                  <Badge className={scopeBadgeTone(r.scope)}>{r.scope}</Badge>
                </div>
                <div className="text-xs text-fg-muted leading-snug">{r.description}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Prompts ({PROMPT_CATALOG.length})</h3>
            <p className="text-xs text-fg-muted mt-1">
              Slash-menu templates your IDE surfaces automatically.
            </p>
          </div>
          <div className="space-y-2" data-testid="mcp-prompt-catalog">
            {PROMPT_CATALOG.map((p) => (
              <div
                key={p.name}
                className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3 motion-safe:transition-colors hover:border-edge"
              >
                <div className="text-sm font-semibold text-fg">{p.title}</div>
                <code className="text-2xs text-fg-muted font-mono block mt-0.5 mb-1">/{p.name}</code>
                <div className="text-xs text-fg-muted leading-snug">{p.description}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {!status.activeProject && !loading && (
        <EmptyState
          title="No projects yet"
          description="Create a project first — then come back here for the one-click install."
          action={<Link to="/projects"><Btn>Go to /projects</Btn></Link>}
        />
      )}
    </div>
  )
}

interface ToolCardProps {
  tool: ToolSpec
}

function ToolCard({ tool }: ToolCardProps) {
  const stripeTone = tool.scope === 'mcp:write' ? 'bg-warn' : 'bg-info'
  return (
    <div className="relative rounded-md border border-edge-subtle bg-surface-raised/30 p-3 pl-4 motion-safe:transition-colors hover:border-edge">
      <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-sm ${stripeTone}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{tool.title}</div>
          <code className="text-2xs text-fg-muted font-mono wrap-anywhere">{tool.name}</code>
        </div>
        <Badge className={scopeBadgeTone(tool.scope)}>{tool.scope}</Badge>
      </div>
      <div className="text-sm text-fg-secondary leading-snug mb-1">
        <span className="text-accent">“</span>
        {tool.useCase}
        <span className="text-accent">”</span>
      </div>
      <div className="text-xs text-fg-muted mb-2 leading-snug">{tool.description}</div>
      <div className="flex items-center gap-1 flex-wrap">
        {hintBadges(tool).map((chip) => (
          <Badge key={chip.label} className={chip.tone} title={chip.title}>{chip.label}</Badge>
        ))}
      </div>
    </div>
  )
}
