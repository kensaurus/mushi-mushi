import { Link } from 'react-router-dom'
import { useRef } from 'react'
import { Badge, Btn, Card, CopyButton, SegmentedControl } from '../ui'
import { IconIntegrations, IconArrowRight } from '../icons'
import { ConfigHelp } from '../ConfigHelp'
import { detectFromPackageJson } from '../../lib/frameworkDetect'
import { McpQuickstartStep, type McpQuickstartStepProps } from './McpQuickstartStep'
import {
  ActionPill,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../report-detail/ReportSurface'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../../lib/env'
import { projectServerName } from '../../lib/cursorDeeplink'
import { MCP_PIN_SPEC } from '@mushi-mushi/mcp/clients'
import { ClientConnectButton } from '../ClientConnectButton'
import { McpAccountKeyCard } from '../McpAccountKeyCard'
import {
  buildSdkInitSnippet,
  buildSdkInstallSnippet,
  validateMcpJsonSyntax,
} from '../../lib/mcpPageHelpers'
import { CHIP_TONE, LINK_ACCENT } from '../../lib/chipTone'
import type { McpProjectRow, McpStats } from './types'
import { CURSOR_CLIENT, VSCODE_CLIENT } from './mcp-clients'

export interface McpSetupPanelProps {
  stats: McpStats
  activeProjectId: string
  displayName: string
  projectId: string
  projects: McpProjectRow[] | undefined
  hasReadKey: boolean
  hasWriteKey: boolean
  step1Tone: McpQuickstartStepProps['tone']
  step2Tone: McpQuickstartStepProps['tone']
  step3Tone: McpQuickstartStepProps['tone']
  snippetMode: 'cursor' | 'env' | 'http'
  onSnippetModeChange: (mode: 'cursor' | 'env' | 'http') => void
  copied: boolean
  snippet: string
  syntaxCheck: ReturnType<typeof validateMcpJsonSyntax>
  testingConnection: boolean
  connectionTestResult: { ok: boolean; message: string; testedAt: number } | null
  onTestConnection: () => void
  monorepoNote: string | null
  onMonorepoNoteChange: (note: string | null) => void
  monoWarnings: string[]
  onMonoWarningsChange: (warnings: string[]) => void
  detectOpen: boolean
  onDetectOpenChange: (open: boolean) => void
  detectText: string
  onDetectTextChange: (text: string) => void
  mintingKey: boolean
  revealedMcpKey: string | null
  onMintMcpReadKey: () => void
  sdkSnippetLang: 'npm' | 'yarn' | 'pnpm'
  onSdkSnippetLangChange: (lang: 'npm' | 'yarn' | 'pnpm') => void
  mcpJsonDraft: string
  onMcpJsonDraftChange: (draft: string) => void
  onCopySnippet: (payload: string, label: string) => void
  onLoadGeneratedSnippet: () => void
}

export function McpSetupPanel({
  stats,
  activeProjectId,
  displayName,
  projectId,
  projects,
  hasReadKey,
  hasWriteKey,
  step1Tone,
  step2Tone,
  step3Tone,
  snippetMode,
  onSnippetModeChange,
  copied,
  snippet,
  syntaxCheck,
  testingConnection,
  connectionTestResult,
  onTestConnection,
  monorepoNote,
  onMonorepoNoteChange,
  monoWarnings,
  onMonoWarningsChange,
  detectOpen,
  onDetectOpenChange,
  detectText,
  onDetectTextChange,
  mintingKey,
  revealedMcpKey,
  onMintMcpReadKey,
  sdkSnippetLang,
  onSdkSnippetLangChange,
  mcpJsonDraft,
  onMcpJsonDraftChange,
  onCopySnippet,
  onLoadGeneratedSnippet,
}: McpSetupPanelProps) {
  const detectTaRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div className="space-y-4" data-dav-anchor="mcp:decide">
      <Card className="p-5 space-y-4" data-testid="mcp-quickstart">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-fg-muted [&>svg]:h-4 [&>svg]:w-4"><IconIntegrations /></span>
            <h3 className="text-sm font-semibold text-fg">Get an agent talking in 60 seconds</h3>
          </div>
          <div className="flex items-center gap-1.5" data-testid="mcp-status-strip">
            <Badge
              className={
                hasReadKey
                  ? CHIP_TONE.okSubtle + ' border border-ok/30'
                  : 'bg-surface-overlay text-fg-muted border border-edge-subtle'
              }
              data-testid="mcp-read-status"
            >
              {hasReadKey ? 'mcp:read ✓' : 'mcp:read —'}
            </Badge>
            <Badge
              className={
                hasWriteKey
                  ? CHIP_TONE.okSubtle + ' border border-ok/30'
                  : 'bg-surface-overlay text-fg-muted border border-edge-subtle'
              }
              data-testid="mcp-write-status"
            >
              {hasWriteKey ? 'mcp:write ✓' : 'mcp:write —'}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <McpQuickstartStep
            n={1}
            tone={step1Tone}
            title="Generate an API key"
            body={
              hasReadKey ? (
                <span>
                  <span className="text-ok">{stats.mcpReadKeyCount} MCP key{stats.mcpReadKeyCount === 1 ? '' : 's'}</span>{' '}
                  on <span className="font-mono text-fg-secondary">{displayName}</span>.
                </span>
              ) : (
                <span>
                  Pick <span className="text-fg">MCP read</span> to browse or{' '}
                  <span className="text-fg">MCP read + write</span> to dispatch fixes.
                </span>
              )
            }
          />
          <McpQuickstartStep
            n={2}
            tone={step2Tone}
            title="Paste the snippet"
            body={
              <>
                Drop the <span className="font-mono text-fg-secondary">.cursor/mcp.json</span> block into your IDE, then restart.
              </>
            }
          />
          <McpQuickstartStep
            n={3}
            tone={step3Tone}
            title="Ask the agent"
            body={
              <>
                Type <span className="font-mono text-fg-secondary">"list mushi tools"</span> — expect {stats.toolCount} tools.
              </>
            }
          />
        </div>

        <div className="pt-1 space-y-3">
          {!hasReadKey && (
            <div className="space-y-2">
              <Btn size="sm" data-testid="mcp-status-mint" loading={mintingKey} onClick={() => void onMintMcpReadKey()}>
                Mint mcp:read key here
                <IconArrowRight className="h-3.5 w-3.5 ml-1" />
              </Btn>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {activeProjectId ? (
              <>
                <ClientConnectButton
                  client={CURSOR_CLIENT}
                  projectId={activeProjectId}
                  projectName={displayName}
                  endpoint={RESOLVED_EXTERNAL_API_URL}
                  mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                  variant="primary"
                  size="sm"
                />
                <ClientConnectButton
                  client={CURSOR_CLIENT}
                  projectId={activeProjectId}
                  projectName={displayName}
                  endpoint={RESOLVED_EXTERNAL_API_URL}
                  mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                  scopes={['mcp:write']}
                  variant="ghost"
                  size="sm"
                />
                <ClientConnectButton
                  client={VSCODE_CLIENT}
                  projectId={activeProjectId}
                  projectName={displayName}
                  endpoint={RESOLVED_EXTERNAL_API_URL}
                  mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                  variant="ghost"
                  size="sm"
                />
              </>
            ) : (
              <Btn size="sm" variant="primary" disabled>
                Add to Cursor
              </Btn>
            )}
          </div>
          <ContainedBlock tone="muted">
            <p className="text-2xs text-fg-muted">
              <strong>"Add to Cursor"</strong> mints a fresh key and opens your IDE's install dialog — no copy-paste needed.
              The key is embedded in the deeplink and will not be shown again unless you save it.
            </p>
          </ContainedBlock>
          {revealedMcpKey ? (
            <ContainedBlock tone="muted">
              <p className="text-2xs text-fg-muted">
                Key minted — paste into your snippet if the deeplink did not open your IDE. Not shown again after you leave.
              </p>
            </ContainedBlock>
          ) : null}
        </div>
      </Card>

      <Card className="p-5 space-y-4" data-testid="mcp-install">
        <div>
          <h3 className="text-sm font-semibold text-fg">Configuration values</h3>
          <ContainedBlock tone="muted" className="mt-2">
            <p className="text-xs text-fg-muted">
              Three env vars wire the MCP binary to <span className="font-mono text-fg-secondary">{displayName}</span>.
            </p>
          </ContainedBlock>
        </div>

        <div className="rounded-md border border-edge-subtle bg-surface-raised">
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onDetectOpenChange(!detectOpen)
              if (!detectOpen) setTimeout(() => detectTaRef.current?.focus(), 50)
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-surface-overlay rounded-md"
            aria-expanded={detectOpen}
          >
            <span className="font-medium text-fg">Detect monorepo / workspace (optional)</span>
            <SignalChip tone="neutral" className="text-2xs" aria-hidden>
              {detectOpen ? '▲ hide' : '▼ paste package.json'}
            </SignalChip>
          </Btn>
          {detectOpen && (
            <div className="px-3 pb-3 pt-1 space-y-2">
              <ContainedBlock tone="muted">
                <InlineProof className="border-0 bg-transparent px-0 py-0 text-2xs leading-snug">
                  Paste your <SignalChip tone="neutral" className="font-mono">package.json</SignalChip> for monorepo install guidance.
                </InlineProof>
              </ContainedBlock>
              <textarea
                ref={detectTaRef}
                value={detectText}
                onChange={(e) => onDetectTextChange(e.target.value)}
                placeholder={'{\n  "workspaces": ["apps/*", "packages/*"],\n  ...\n}'}
                className="w-full h-28 font-mono text-2xs bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1.5 text-fg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand resize-y placeholder:text-fg-faint"
                spellCheck={false}
              />
              <div className="flex gap-2">
                <Btn
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={!detectText.trim()}
                  onClick={() => {
                    const result = detectFromPackageJson(detectText)
                    const globalNote = result.monorepo
                      ? `Detected ${result.monorepo} monorepo.\n\n@mushi-mushi/mcp is a global CLI — install once:\n\n  npm install -g @mushi-mushi/mcp\n\nOr run on demand:\n\n  npx -y ${MCP_PIN_SPEC}`
                      : null
                    onMonorepoNoteChange(globalNote)
                    onMonoWarningsChange(result.warnings)
                    onDetectOpenChange(false)
                  }}
                >
                  Detect
                </Btn>
                <Btn
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onDetectTextChange('')
                    onDetectOpenChange(false)
                    onMonorepoNoteChange(null)
                    onMonoWarningsChange([])
                  }}
                >
                  Cancel
                </Btn>
              </div>
            </div>
          )}
          {!detectOpen && (monorepoNote || monoWarnings.length > 0) && (
            <div className="px-3 pb-3 space-y-1.5">
              {monorepoNote && (
                <div className="rounded-sm border border-info/30 bg-info-muted/10 px-2 py-1.5">
                  <p className="text-2xs text-info font-semibold mb-0.5">Monorepo install guidance</p>
                  <pre className="text-2xs text-fg-secondary whitespace-pre-wrap font-mono leading-snug">{monorepoNote}</pre>
                </div>
              )}
              {monoWarnings.map((w, i) => (
                <p key={i} className="text-2xs text-warn flex gap-1">
                  <span aria-hidden>⚠</span>
                  <span>{w}</span>
                </p>
              ))}
              <ActionPill
                onClick={() => {
                  onMonorepoNoteChange(null)
                  onMonoWarningsChange([])
                }}
              >
                Dismiss
              </ActionPill>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-edge-subtle pb-2 flex-wrap">
          <ConfigHelp helpId="mcp.snippet_mode" />
          <SegmentedControl
            value={snippetMode}
            onChange={onSnippetModeChange}
            options={[
              { id: 'cursor' as const, label: 'Stdio (.cursor/mcp.json)' },
              { id: 'http' as const, label: 'Hosted HTTP' },
              { id: 'env' as const, label: '.env.local' },
            ]}
            ariaLabel="Snippet format"
            size="sm"
            scrollable
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Btn
              size="sm"
              variant="ghost"
              loading={testingConnection}
              onClick={() => void onTestConnection()}
              data-testid="mcp-test-connection"
            >
              {connectionTestResult ? 'Re-test' : 'Test connection'}
            </Btn>
            <Link
              to="/docs-bridge?topic=cli-setup"
              className={`text-xs ${LINK_ACCENT}`}
            >
              CLI: mushi setup --ide cursor
            </Link>
          </div>
          {connectionTestResult && (
            <div
              data-testid="mcp-connection-result"
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${
                connectionTestResult.ok
                  ? 'border-ok/30 bg-ok/8 text-ok'
                  : 'border-danger/30 bg-danger/8 text-danger-foreground'
              }`}
            >
              <span className="shrink-0 text-sm leading-none mt-0.5" aria-hidden>
                {connectionTestResult.ok ? '✓' : '✕'}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">{connectionTestResult.message}</p>
                {!connectionTestResult.ok && (
                  <p className="text-fg-muted">
                    Run <code className="font-mono bg-surface px-1 rounded">mushi doctor --server</code> for a full diagnostic, or check the Supabase Edge Function logs.
                  </p>
                )}
                <p className="text-fg-muted">
                  Tested at {new Date(connectionTestResult.testedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <SignalChip tone="neutral" className="uppercase tracking-wider font-medium">
              {snippetMode === 'cursor'
                ? 'Stdio — drop into IDE settings (recommended — shows Mushi icon in Cursor)'
                : snippetMode === 'http'
                  ? 'Hosted HTTP — no subprocess (URL host may show Supabase icon in Cursor; use stdio for branding)'
                  : 'Drop into your repo root'}
            </SignalChip>
            <CopyButton
              onCopy={() =>
                onCopySnippet(
                  snippet,
                  snippetMode === 'cursor'
                    ? '.cursor/mcp.json block'
                    : snippetMode === 'http'
                      ? 'Hosted HTTP MCP block'
                      : '.env.local block',
                )
              }
              copied={copied}
              label={
                snippetMode === 'cursor'
                  ? 'Copy .cursor/mcp.json block'
                  : snippetMode === 'http'
                    ? 'Copy hosted HTTP block'
                    : 'Copy .env.local block'
              }
              copiedLabel="Snippet copied"
              data-testid="mcp-snippet-copy"
            />
          </div>
          <pre
            className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm px-3 py-2 mt-1 text-2xs font-mono overflow-auto whitespace-pre-wrap wrap-anywhere max-h-64 select-all"
            data-testid="mcp-snippet"
          >
            {snippet}
          </pre>
        </div>

        <div className="rounded-md border border-edge-subtle bg-surface-raised p-3 space-y-2" data-testid="mcp-json-helper">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-fg">mcp.json syntax helper</h3>
              <p className="text-xs text-fg-muted">
                Paste the block Cursor is using. We check JSON shape, stdio/HTTP fields, and Mushi env names.
              </p>
            </div>
            <Btn
              size="sm"
              variant="ghost"
              onClick={onLoadGeneratedSnippet}
              data-testid="mcp-json-helper-load"
            >
              Load generated snippet
            </Btn>
          </div>
          <textarea
            className="w-full min-h-32 rounded-sm border border-edge-subtle bg-surface px-3 py-2 font-mono text-2xs text-fg-secondary outline-none focus-visible:border-brand"
            value={mcpJsonDraft}
            onChange={(event) => onMcpJsonDraftChange(event.target.value)}
            placeholder="Paste your ~/.cursor/mcp.json block here..."
            spellCheck={false}
            data-testid="mcp-json-helper-input"
          />
          <ContainedBlock tone={syntaxCheck.ok ? 'ok' : 'warn'}>
            <p className="text-xs font-semibold text-fg">{syntaxCheck.title}</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5 text-2xs text-fg-muted">
              {syntaxCheck.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </ContainedBlock>
        </div>
      </Card>

      {projects && projects.length > 0 && (
        <Card className="p-5 space-y-4" data-testid="mcp-multi-project">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-fg">Connect all your projects</h3>
              <Badge className={`${CHIP_TONE.infoSubtle} text-2xs`}>
                {projects.length} project{projects.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <ContainedBlock tone="muted" className="mt-2">
              <p className="text-xs text-fg-muted leading-relaxed">
                Each Mushi project uses its own API key and gets a uniquely-named MCP server entry
                (<span className="font-mono text-fg-secondary">mushi-{'{'}name{'}'}-{'{'}id{'}'}</span>).
                Click <strong>Add to Cursor</strong> for each project below — all of them will appear
                simultaneously in your IDE so you can triage bugs across all your apps in one session.
              </p>
            </ContainedBlock>
          </div>
          <div className="space-y-2">
            {projects.map((p) => {
              const serverSlug = projectServerName(p.id, p.name)
              const isActive = p.id === activeProjectId
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 ${
                    isActive ? 'border-brand/40 bg-surface-raised' : 'border-edge-subtle bg-surface-raised/20'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-fg truncate">{p.name}</span>
                      {isActive && (
                        <Badge className="bg-brand/15 text-brand border border-brand/20 text-2xs">active</Badge>
                      )}
                    </div>
                    <p className="text-2xs text-fg-faint font-mono truncate mt-0.5">{serverSlug}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ClientConnectButton
                      client={CURSOR_CLIENT}
                      projectId={p.id}
                      projectName={p.name}
                      endpoint={RESOLVED_EXTERNAL_API_URL}
                      mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                      scopes={['mcp:write']}
                      variant={isActive ? 'primary' : 'ghost'}
                      size="sm"
                    />
                    <ClientConnectButton
                      client={VSCODE_CLIENT}
                      projectId={p.id}
                      projectName={p.name}
                      endpoint={RESOLVED_EXTERNAL_API_URL}
                      mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                      scopes={['mcp:write']}
                      variant="ghost"
                      size="sm"
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <ContainedBlock tone="muted">
            <p className="text-2xs text-fg-muted">
              Once connected, call <span className="font-mono text-fg-secondary">get_account_overview</span> on
              any server to see all your projects and their health. Ask the agent:
              <em className="not-italic text-fg-secondary"> "What are my most urgent bugs across all projects?"</em>
            </p>
          </ContainedBlock>
        </Card>
      )}

      <Card className="p-5 space-y-4" data-testid="mcp-account-key">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-fg">Account key (all projects, one server)</h3>
            <Badge className={`${CHIP_TONE.infoSubtle} text-2xs`}>org-scoped</Badge>
          </div>
          <ContainedBlock tone="muted" className="mt-2">
            <p className="text-xs text-fg-muted leading-relaxed">
              Alternative to per-project keys — one org-scoped key with no{' '}
              <span className="font-mono text-fg-secondary">MUSHI_PROJECT_ID</span> covers all your projects.
              The agent calls <span className="font-mono text-fg-secondary">get_account_overview</span> to
              discover accessible projects and auto-selects when you only have one.
              Use this when you want a single MCP server entry across your entire account.
            </p>
          </ContainedBlock>
        </div>
        <McpAccountKeyCard compact />
      </Card>

      {activeProjectId && (
        <Card className="p-5 space-y-4" data-testid="mcp-sdk-install">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-fg">Wire your app (SDK)</h3>
              <Badge className="bg-surface-overlay text-fg-muted border border-edge-subtle text-2xs">
                end users → Mushi
              </Badge>
            </div>
            <ContainedBlock tone="muted" className="mt-2">
              <p className="text-xs text-fg-muted leading-relaxed">
                The MCP connects <em>your coding agent</em> to Mushi. The SDK connects
                <em> real users in your app</em> so their bug reports flow into your reports inbox.
                Use a <strong>report:write</strong> key for the SDK — never your MCP key.
              </p>
            </ContainedBlock>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <SegmentedControl
                  value={sdkSnippetLang}
                  onChange={onSdkSnippetLangChange}
                  options={[
                    { id: 'npm' as const, label: 'npm' },
                    { id: 'yarn' as const, label: 'yarn' },
                    { id: 'pnpm' as const, label: 'pnpm' },
                  ]}
                  ariaLabel="Package manager"
                  size="sm"
                />
              </div>
              <pre className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm px-3 py-2 text-2xs font-mono overflow-auto select-all">
                {buildSdkInstallSnippet(sdkSnippetLang)}
              </pre>
            </div>
            <div>
              <p className="text-2xs text-fg-faint uppercase tracking-wide font-medium mb-1">Init snippet</p>
              <pre className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm px-3 py-2 text-2xs font-mono overflow-auto whitespace-pre-wrap select-all max-h-52">
                {buildSdkInitSnippet(projectId)}
              </pre>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => void onCopySnippet(buildSdkInstallSnippet(sdkSnippetLang), 'Install command')}
            >
              Copy install command
            </Btn>
            <Link to={`/onboarding?tab=sdk&project=${activeProjectId}`}>
              <Btn variant="ghost" size="sm">Open SDK wizard →</Btn>
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}
