/**
 * FILE: apps/admin/src/components/reports/DispatchPreflightBanner.tsx
 * PURPOSE: On a report page, below the diagnosis and the fix prompt: what is
 *          missing before Mushi Mushi can open the change for you. Optional,
 *          so it is a collapsed card, not an alarm (console audit 2026-11-11:
 *          "Auto-fix is paused — 3 prerequisites missing" sat above the title
 *          of a new account's test report that never asked for auto-fix).
 *
 *          The agent line names the agent that really runs the fix (server
 *          `_shared/agent-credits.ts`): the OpenAI key for a team on OpenAI,
 *          Cursor's credits for a Cursor app. It used to say "Add Anthropic
 *          key" to everyone, and adding one changed nothing.
 *
 *          Reads from `useDispatchPreflight()` (already mounted on
 *          ReportsPage / ReportDetailPage) via a prop so we don't issue a
 *          second fetch per page load.
 */

import { useNavigate } from 'react-router-dom'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { Btn } from '../ui'

interface Props {
  preflight: PreflightState
  className?: string
}

const CHECK_ICONS: Record<string, string> = {
  github: '🔗',
  codebase: '📂',
  agent: '🔑',
  anthropic: '🔑',
  autofix: '⚡',
}

/** Plain names: what each step lets Mushi Mushi do. */
const CHECK_FIX_LABELS: Record<string, string> = {
  github: 'Connect GitHub',
  codebase: 'Let Mushi Mushi read your code',
  agent: 'Fix this',
  anthropic: 'Add an AI key',
  autofix: 'Turn on',
}

/** What each line means to someone who never heard "codebase index" or "autofix". */
const CHECK_PLAIN: Record<string, string> = {
  github: 'Your code on GitHub, so the change can be opened as a pull request.',
  codebase: 'Mushi Mushi reads your code to write a change that fits it.',
  autofix: 'You say yes to Mushi Mushi opening changes for this app.',
}

export function DispatchPreflightBanner({ preflight, className = '' }: Props) {
  const navigate = useNavigate()

  // Don't render: loading, no problems, or we couldn't reach the preflight API
  if (preflight.loading) return null
  if (preflight.ready) return null
  if (preflight.error) return null

  const failing = preflight.failing
  if (failing.length === 0) return null

  return (
    <details
      aria-label="Let Mushi Mushi open the change for you"
      className={`rounded-lg border border-edge-subtle bg-surface-raised px-3 py-2 ${className}`}
      data-testid="dispatch-preflight"
    >
      <summary className="cursor-pointer text-xs font-semibold text-fg">
        Optional: let Mushi Mushi open the change for you{' '}
        <span className="font-normal text-fg-muted">
          ({failing.length === 1 ? '1 step left' : `${failing.length} steps left`})
        </span>
      </summary>
      <p className="mt-1 text-2xs text-fg-muted leading-snug">
        You don&apos;t need this to fix the bug: the fix prompt above works in Lovable, Cursor or Claude Code. Finish these
        steps if you want Mushi Mushi to make the change and open it for your review.
      </p>
      <div className="mt-2 space-y-1.5">
        {failing.map((check) => (
          <div key={check.key} className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-1.5 min-w-0">
              <span aria-hidden="true" className="mt-px shrink-0">
                {CHECK_ICONS[check.key] ?? '•'}
              </span>
              <div className="min-w-0">
                <span className="text-2xs font-medium text-fg-secondary">{check.label}</span>
                <span className="text-2xs text-fg-muted ml-1">: {CHECK_PLAIN[check.key] ?? check.hint}</span>
                {CHECK_PLAIN[check.key] && check.hint ? (
                  <span className="block text-2xs text-fg-muted">{check.hint}</span>
                ) : null}
              </div>
            </div>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                if (check.fixHref.startsWith('http')) {
                  window.open(check.fixHref, '_blank', 'noreferrer')
                } else {
                  navigate(check.fixHref)
                }
              }}
              className="shrink-0 text-2xs"
            >
              {CHECK_FIX_LABELS[check.key] ?? 'Fix this'}
            </Btn>
          </div>
        ))}
      </div>
    </details>
  )
}
