/**
 * FILE: apps/admin/src/components/report-detail/CursorAgentLaunch.tsx
 * PURPOSE: One-click "Hand this report to Cursor" launcher. Generates a
 *          ready-to-paste prompt for either the desktop Cursor IDE
 *          (deeplink) or Cursor's cloud-agent web surface, pre-filled
 *          with the Mushi MCP tool calls the agent should run.
 *
 *          Today, dispatching a fix from Mushi triggers our own
 *          fix-worker (via `dispatch_fix`). This component exposes the
 *          *operator* path: kick off a Cursor agent that talks to the
 *          Mushi MCP server itself, lets the human watch the trace, and
 *          ends with the same `submit_fix_result` MCP call the worker
 *          would have made. Useful for high-blast-radius reports where
 *          the operator wants to drive the agent loop manually.
 *
 *          References:
 *           - cursor.com/agents — cloud agent web surface (May 2026)
 *           - cursor:// deeplink scheme (desktop IDE; documented in
 *             docs.cursor.com/cli/automation)
 *
 *          Requires the Mushi MCP server already configured in
 *          .cursor/mcp.json — points the user at /mcp setup if not.
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { IconExternalLink } from '../icons'
import { useToast } from '../../lib/toast'
import { ContainedBlock } from './ReportSurface'
import type { ReportDetail } from './types'

interface CursorAgentLaunchProps {
  report: ReportDetail
  /**
   * Optional Cursor account/team slug. When set, the cloud-agent URL
   * targets that workspace; otherwise it opens the generic launcher
   * which lets the user pick their workspace.
   */
  cursorWorkspace?: string
}

/**
 * Build a self-contained prompt that an LLM in any MCP-aware agent can
 * consume to fix a specific Mushi report. The prompt:
 *   1. tells the agent *which* MCP tools to call (in order),
 *   2. embeds the report's UUID so no `?` substitution is needed,
 *   3. ends with the success criterion the human will eyeball.
 *
 * Kept short on purpose — long preambles waste agent context, and the
 * MCP tool descriptions already explain what each call returns.
 */
function buildCursorPrompt(report: ReportDetail): string {
  const summary = (report.summary ?? report.description ?? '')
    .slice(0, 120)
    .replace(/\n+/g, ' ')
    .trim()
  const lines = [
    `# Mushi report: ${report.id}`,
    summary ? `> ${summary}` : null,
    '',
    'Use the Mushi MCP server to fix this report end-to-end:',
    '',
    `1. Call \`get_fix_context\` with reportId="${report.id}" to load the full bundle (description, repro steps, screenshot URL, root-cause hint).`,
    '2. If a `component` is present, call `get_blast_radius` for it so you know what else might break.',
    '3. Author the smallest patch that fixes the root cause. Run the project test suite before committing.',
    '4. Open a PR with a clear title and a body that links back to this report.',
    `5. Call \`submit_fix_result\` with reportId="${report.id}", branch, prUrl, filesChanged, linesChanged, and a one-line summary so Mushi can mark the report fixed and award rewards points.`,
    '',
    'If at any step a Mushi tool returns INSUFFICIENT_SCOPE, stop and tell the human — the API key is read-only.',
  ].filter((line) => line != null)
  return lines.join('\n')
}

/**
 * Build a Cursor cloud-agent launch URL. The docs format is:
 *   https://cursor.com/agents?prompt=<urlencoded>
 * with optional `&workspace=<slug>` to target a specific account.
 */
function buildCursorCloudUrl(prompt: string, workspace?: string): string {
  const params = new URLSearchParams({ prompt })
  if (workspace) params.set('workspace', workspace)
  return `https://cursor.com/agents?${params.toString()}`
}

/**
 * Build a `cursor://` deeplink for the desktop IDE. Falls back to the
 * cloud URL on platforms that haven't registered the scheme.
 */
function buildCursorDeeplink(prompt: string): string {
  return `cursor://anysphere.cursor-deeplink/prompt?prompt=${encodeURIComponent(prompt)}`
}

export function CursorAgentLaunch({ report, cursorWorkspace }: CursorAgentLaunchProps) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const prompt = buildCursorPrompt(report)
  const cloudUrl = buildCursorCloudUrl(prompt, cursorWorkspace)
  const deeplink = buildCursorDeeplink(prompt)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      toast.success('Prompt copied', 'Paste into Cursor (Cmd-K) or any MCP-aware agent.')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed', 'Your browser blocked clipboard access — select the text manually.')
    }
  }

  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/40 p-3 mb-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-fg">Hand to a Cursor agent</div>
        <ContainedBlock tone="muted" className="mt-1.5">
          <p className="text-2xs leading-relaxed text-fg-muted">
            Mushi MCP must be configured in{' '}
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/50 px-1 py-0.5 font-mono text-fg-secondary">
              .cursor/mcp.json
            </code>{' '}
            first. Skip the dispatch worker and drive the fix loop yourself with full visibility into every tool call.
          </p>
        </ContainedBlock>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={deeplink} target="_blank" rel="noopener noreferrer">
          <Btn variant="primary" size="sm" leadingIcon={<IconExternalLink />}>
            Open in Cursor IDE
          </Btn>
        </a>
        <a href={cloudUrl} target="_blank" rel="noopener noreferrer">
          <Btn variant="ghost" size="sm" leadingIcon={<IconExternalLink />}>
            Cloud agent (cursor.com/agents)
          </Btn>
        </a>
        <Btn variant="ghost" size="sm" onClick={onCopy}>
          {copied ? 'Copied ✓' : 'Copy prompt'}
        </Btn>
      </div>

      <details className="mt-2 rounded-md border border-edge-subtle/60 bg-surface-overlay/20 px-2.5 py-2 text-2xs text-fg-muted">
        <summary className="cursor-pointer text-3xs font-medium uppercase tracking-wider text-fg-faint hover:text-fg-secondary">
          View prompt
        </summary>
        <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-sm border border-edge-subtle/50 bg-surface-overlay/40 p-2 font-mono text-fg-secondary">
          {prompt}
        </pre>
      </details>
    </div>
  )
}
