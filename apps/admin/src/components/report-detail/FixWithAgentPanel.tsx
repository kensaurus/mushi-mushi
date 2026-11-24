/**
 * FILE: apps/admin/src/components/report-detail/FixWithAgentPanel.tsx
 * PURPOSE: "Fix it with your coding agent" on the report page.
 *
 * REGRESSION (2026-10-04, REPORT B15): this was "Hand to a Cursor agent". It
 * required `.cursor/mcp.json`, its "Copy prompt" held Mushi MCP tool calls
 * instead of the bug, and "Copy code for this bug" dumped ~50k tokens of repo
 * code with no bug text. A vibe coder in Claude Code, Codex or Windsurf
 * without MCP had nothing that worked.
 *
 * Now the primary action is "Copy fix prompt": one self-contained prompt
 * (fixPrompt.ts) that works pasted into any agent with no setup. Three
 * secondary lanes keep the editor-specific paths:
 *   - Use with Claude Code: paste the prompt; optionally connect Mushi MCP
 *     (the `claude mcp add` command) so the agent can close the report.
 *   - Use with Cursor: the Cursor IDE deeplink / cloud agent, carrying a
 *     shorter copy of the same prompt (URLs cap how much they can carry).
 *   - Use MCP: the previous MCP-tool prompt, for agents that have it.
 * The whole-repo digest stays available as a small secondary link.
 *
 * Owner's walkthrough, 2026-11-17: the explanation sits under a fold (Copy
 * stays in view), the lane picked last opens by default, and opening Cursor
 * says "Sent to Cursor".
 *
 * ADR 0069 (2026-11-24): one row, one primary. Copy fix prompt leads and the
 * three editor lanes sit beside it as small buttons. What the prompt holds,
 * the prompt itself and the whole-codebase copy share one "View the prompt"
 * fold instead of two folds and a footer line.
 */

import { useMemo, useState } from 'react'
import { reportHasCodeLocation } from '../../lib/reportCodeLocation'
import { getMcpClient } from '@mushi-mushi/mcp/clients'
import { Card } from '../../components/ui'
import { Btn } from '../ui'
import { IconCopy, IconExternalLink } from '../icons'
import { useToast } from '../../lib/toast'
import { trackSelf } from '../../lib/track'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../../lib/env'
import { ClientConnectButton } from '../ClientConnectButton'
import { ContainedBlock } from './ReportSurface'
import { CopyRepoDigestButton } from '../explore/CopyRepoDigestButton'
import { buildFixPrompt, buildMcpFixPrompt, buildUrlFixPrompt } from './fixPrompt'
import type { ReportDetail } from './types'

interface FixWithAgentPanelProps {
  report: ReportDetail
  /**
   * Optional Cursor account/team slug. When set, the cloud-agent URL
   * targets that workspace; otherwise it opens the generic launcher.
   */
  cursorWorkspace?: string
}

type Lane = 'claude' | 'cursor' | 'mcp'

const LANE_LABEL: Record<Lane, string> = {
  claude: 'Use with Claude Code',
  cursor: 'Use with Cursor',
  mcp: 'Use MCP',
}

type PulledVia = 'copy_fix_prompt' | 'claude_code' | 'cursor_ide' | 'cursor_cloud' | 'copy_mcp_prompt'

/** cursor.com/agents?prompt=<urlencoded>[&workspace=<slug>] */
function buildCursorCloudUrl(prompt: string, workspace?: string): string {
  const params = new URLSearchParams({ prompt })
  if (workspace) params.set('workspace', workspace)
  return `https://cursor.com/agents?${params.toString()}`
}

/** `cursor://` deeplink for the desktop IDE. */
function buildCursorDeeplink(prompt: string): string {
  return `cursor://anysphere.cursor-deeplink/prompt?prompt=${encodeURIComponent(prompt)}`
}

/** The hand-off the person used last, opened by default next time (per browser). */
const LAST_LANE_KEY = 'mushi:fix-handoff-lane'

function readLastLane(): Lane | null {
  try {
    const v = window.localStorage.getItem(LAST_LANE_KEY)
    return v === 'claude' || v === 'cursor' || v === 'mcp' ? v : null
  } catch {
    return null
  }
}

function rememberLane(lane: Lane): void {
  try {
    window.localStorage.setItem(LAST_LANE_KEY, lane)
  } catch {
    // Storage blocked: the lanes just start closed.
  }
}

export function FixWithAgentPanel({ report, cursorWorkspace }: FixWithAgentPanelProps) {
  const toast = useToast()
  const [copied, setCopied] = useState<'fix' | 'mcp' | null>(null)
  const [open, setOpen] = useState<Lane | null>(() => readLastLane())
  const [sentTo, setSentTo] = useState<string | null>(null)

  // The page re-renders every second while a fix runs; build the prompts once per report.
  const { fixPrompt, urlPrompt, mcpPrompt } = useMemo(
    () => ({
      fixPrompt: buildFixPrompt(report),
      urlPrompt: buildUrlFixPrompt(report),
      mcpPrompt: buildMcpFixPrompt(report),
    }),
    [report],
  )
  const projectName = report.project_name?.trim() || 'My Project'

  // Funnel: every hand-off path pulls the fix context into an editor/agent.
  const trackPulled = (via: PulledVia) => trackSelf('fix_context_pulled', { report_id: report.id, via })

  const copy = async (which: 'fix' | 'mcp') => {
    try {
      await navigator.clipboard.writeText(which === 'fix' ? fixPrompt : mcpPrompt)
      trackPulled(which === 'fix' ? 'copy_fix_prompt' : 'copy_mcp_prompt')
      setCopied(which)
      toast.success(
        which === 'fix' ? 'Fix prompt copied' : 'MCP prompt copied',
        which === 'fix'
          ? 'Paste it into your coding agent (Claude Code, Cursor, Codex, Windsurf). No setup needed.'
          : 'Paste it into an agent that has the Mushi Mushi MCP server connected.',
      )
      setTimeout(() => setCopied(null), 1500)
    } catch {
      toast.error('Copy failed', 'Your browser blocked clipboard access. Open "View the prompt" and select the text.')
    }
  }

  const openUrl = (url: string, via: PulledVia, target: '_self' | '_blank') => {
    trackPulled(via)
    window.open(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
    if (via === 'cursor_ide' || via === 'cursor_cloud') {
      const where = via === 'cursor_ide' ? 'Cursor' : 'a Cursor cloud agent'
      setSentTo(where)
      toast.success(`Sent to ${where}`, 'The fix prompt is waiting there. Check the change before you merge it.')
    }
  }

  return (
    // #fix-prompt: links that say "copy the fix prompt" land here.
    <div id="fix-prompt" className="scroll-mt-chrome">
    <Card className="p-3 mb-3">
      <h2 className="text-sm font-semibold text-fg">Fix it with your coding agent</h2>
      {/* One row: the primary copy, then the editor lanes as small secondary buttons. */}
      <div role="group" aria-label="Ways to fix it" className="mt-2 flex flex-wrap items-center gap-2">
        {/* With no stack trace or file the triage bar leads with "Not a code
            bug"; a red Copy fix prompt here argued with it (sweep 2026-11-18). */}
        <Btn variant={reportHasCodeLocation(report) ? 'primary' : 'ghost'} size="sm" leadingIcon={<IconCopy />} onClick={() => void copy('fix')} data-testid="copy-fix-prompt">
          {copied === 'fix' ? 'Copied' : 'Copy fix prompt'}
        </Btn>
        {(Object.keys(LANE_LABEL) as Lane[]).map((lane) => (
          <Btn
            key={lane}
            variant="ghost"
            size="sm"
            aria-expanded={open === lane}
            aria-controls={`fix-lane-${lane}`}
            onClick={() => {
              const next = open === lane ? null : lane
              setOpen(next)
              if (next) rememberLane(next)
            }}
          >
            {LANE_LABEL[lane]}
          </Btn>
        ))}
      </div>

      {open === 'claude' && (
        <div id="fix-lane-claude" className="mt-2">
          <ContainedBlock tone="muted">
            <ol className="list-decimal space-y-1 pl-4 text-xs text-fg-secondary">
              <li>Click <span className="font-medium text-fg">Copy fix prompt</span> above.</li>
              <li>
                In your project folder run{' '}
                <code className="rounded-sm border border-edge-subtle bg-surface-overlay/50 px-1 py-0.5 font-mono">
                  claude
                </code>{' '}
                and paste it.
              </li>
            </ol>
            {report.project_id && (
              <div className="mt-2.5 border-t border-edge-subtle pt-2.5">
                <p className="mb-1.5 text-2xs text-fg-muted">
                  Optional: connect Mushi Mushi to Claude Code once, so the agent can look up other reports and mark this one
                  fixed when its PR is open. Skip this if you already did.
                </p>
                <ClientConnectButton
                  client={getMcpClient('claude-code')}
                  projectId={report.project_id}
                  projectName={projectName}
                  endpoint={RESOLVED_EXTERNAL_API_URL}
                  mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                  variant="ghost"
                  size="sm"
                  accessChoice
                />
              </div>
            )}
          </ContainedBlock>
        </div>
      )}

      {open === 'cursor' && (
        <div id="fix-lane-cursor" className="mt-2">
          <ContainedBlock tone="muted">
            <p className="text-2xs leading-relaxed text-fg-muted">
              Opens Cursor with a shorter copy of the fix prompt (a link can only carry so much). For the full prompt,
              use Copy fix prompt and paste it into Cursor&rsquo;s chat.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn
                variant="ghost"
                size="sm"
                leadingIcon={<IconExternalLink />}
                onClick={() => openUrl(buildCursorDeeplink(urlPrompt), 'cursor_ide', '_self')}
              >
                Open in Cursor
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                leadingIcon={<IconExternalLink />}
                onClick={() => openUrl(buildCursorCloudUrl(urlPrompt, cursorWorkspace), 'cursor_cloud', '_blank')}
              >
                Cursor cloud agent
              </Btn>
            </div>
            {sentTo && (
              <p className="mt-1.5 flex items-center gap-1 text-2xs font-medium text-ok-foreground" role="status" data-testid="fix-sent-to">
                <span aria-hidden="true">✓</span> Sent to {sentTo}.
              </p>
            )}
          </ContainedBlock>
        </div>
      )}

      {open === 'mcp' && (
        <div id="fix-lane-mcp" className="mt-2">
          <ContainedBlock tone="muted">
            <p className="text-2xs leading-relaxed text-fg-muted">
              For agents with the Mushi Mushi MCP server connected. The agent loads the full context itself and marks the
              report fixed when its PR is open, which needs a read and write key.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn variant="ghost" size="sm" leadingIcon={<IconCopy />} onClick={() => void copy('mcp')}>
                {copied === 'mcp' ? 'Copied' : 'Copy MCP prompt'}
              </Btn>
              <Btn variant="ghost" size="sm" to="/connect">
                Set up MCP
              </Btn>
            </div>
          </ContainedBlock>
        </div>
      )}

      <details className="mt-2 text-2xs text-fg-muted" data-testid="fix-agent-explainer">
        <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg-secondary">
          View the prompt <span className="font-normal text-fg-faint">({(fixPrompt.length / 1000).toFixed(1)}k characters)</span>
        </summary>
        <p className="mt-1 text-xs">
          One prompt with the bug, why it broke, the suggested fix, where it happened and how to check the fix. Paste it
          into Claude Code, Cursor, Codex, Windsurf or any other agent. No setup needed.
        </p>
        {/* Scrollable, so it takes keyboard focus (REPORT A14). */}
        <pre
          tabIndex={0}
          aria-label="Fix prompt"
          className="mushi-code-block mushi-code-body mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-sm border border-code-surface-border p-2 font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
        >
          {fixPrompt}
        </pre>
        {report.project_id && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-fg-faint">
            <span>Want the whole codebase as context instead? It is large (tens of thousands of tokens).</span>
            <CopyRepoDigestButton
              projectId={report.project_id}
              reportId={report.id}
              showBudgetPicker={false}
              label="Copy code for this bug"
            />
          </div>
        )}
      </details>
    </Card>
    </div>
  )
}
