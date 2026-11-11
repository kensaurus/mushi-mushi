/**
 * FILE: apps/admin/src/components/AgentCreditsOutCard.tsx
 * PURPOSE: The one-place remedy for "No fix agent has credits since <date>"
 *          (console audit 2026-11-11). Shown where the problem is shown:
 *          Spend credits, Fixes (instead of a Retry that would hit the same
 *          empty account) and the report page. Two ways on, both finishable
 *          from here: copy the command that fixes with Claude Code on your own
 *          computer, or wait for the date the Cursor credits come back.
 */

import { Callout, CodeValue } from './ui'
import {
  agentCreditsTitle,
  CLAUDE_FOLLOWUPS_COMMAND,
  CLAUDE_WORK_COMMAND,
  CLAUDE_WORK_NEEDS,
  creditsBackLine,
  type AgentCreditsState,
} from '../lib/agentCredits'

interface Props {
  state: AgentCreditsState
  /** Also offer the command for review follow-ups (the PRs waiting on review fixes). */
  withFollowups?: boolean
  /** One extra sentence for the page (e.g. why Retry is hidden). */
  note?: string
  className?: string
}

export function AgentCreditsOutCard({ state, withFollowups = true, note, className = '' }: Props) {
  const back = creditsBackLine(state)
  return (
    <div id="agent-credits" className={className} data-testid="agent-credits-out">
      <Callout tone="danger" label="Out of credits">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-fg">{agentCreditsTitle(state)}</p>
          <p className="text-xs text-fg-secondary">
            {state.refused > 0
              ? `The last ${state.refused} fix run${state.refused === 1 ? '' : 's'} that start on their own (Cursor and your local workers) stopped because the coding agent's account is out of usage. Nothing opens a fix by itself until that changes.`
              : 'Every Cursor key is out of credits, so nothing opens a fix by itself.'}{' '}
            {back ?? 'Mushi Mushi does not know when they come back.'}
          </p>
          {note && <p className="text-xs text-fg-secondary">{note}</p>}
          <div className="space-y-0.5">
            <p className="text-2xs text-fg-muted">
              Fix the waiting bugs now with Claude Code on your own computer. Run this in your app's folder:
            </p>
            <CodeValue value={CLAUDE_WORK_COMMAND} multiline />
            <p className="text-2xs text-fg-muted" data-testid="agent-credits-needs">
              Needs:{' '}
              {CLAUDE_WORK_NEEDS.map((n, i) => (
                <span key={n.command}>
                  {i === 0 ? '' : i === CLAUDE_WORK_NEEDS.length - 1 ? ', and ' : ', '}
                  {n.what} (<code className="mushi-code-inline font-mono">{n.command}</code>)
                </span>
              ))}
              .
            </p>
          </div>
          {withFollowups && (
            <div className="space-y-0.5">
              <p className="text-2xs text-fg-muted">Pull requests waiting on review fixes take this one:</p>
              <CodeValue value={CLAUDE_FOLLOWUPS_COMMAND} multiline />
            </div>
          )}
          <p className="text-2xs text-fg-muted">
            No terminal? Open any bug and press Copy fix prompt, then paste it into Lovable, Cursor or Claude Code. Dispatch fix
            on a bug page still works where it says the AI key for writing fixes is ready: that uses your team&apos;s own AI key, not
            these credits.
          </p>
        </div>
      </Callout>
    </div>
  )
}
