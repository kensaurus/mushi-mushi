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
 *
 *          "Turn on" turns Autofix on here, with a toast, when GitHub access
 *          is ready. It used to open Integrations, where the person still
 *          had to find the toggle (owner, 2026-11-17). Without GitHub
 *          access it says so ("Connect GitHub first") and goes there.
 *
 *          `required`: on a report page whose Dispatch fix buttons are
 *          disabled only by these steps, it is not optional to dispatch, so
 *          the card drops "Optional" and starts open (feedback 2026-11-22).
 */

import { useNavigate } from 'react-router-dom'
import type { PreflightCheck, PreflightState } from '../../lib/useDispatchPreflight'
import { useTurnOnAutofix } from '../../lib/useTurnOnAutofix'
import { Btn } from '../ui'

interface Props {
  preflight: PreflightState
  /** The report's app: "Turn on" switches its Autofix on in place. */
  projectId?: string | null
  className?: string
  /** Dispatch on this page waits on these steps: no "Optional", open by default. */
  required?: boolean
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
}

/** What each line means to someone who never heard "codebase index" or "autofix". */
const CHECK_PLAIN: Record<string, string> = {
  github: 'Your code on GitHub, so the change can be opened as a pull request.',
  codebase: 'Mushi Mushi reads your code to write a change that fits it.',
  autofix: 'You say yes to Mushi Mushi dispatching fixes for this app.',
}

/**
 * @internal Exported for unit tests only.
 * What a step's button does: Autofix turns on in place once GitHub is ready,
 * else it names what is missing and opens that step.
 */
export function stepAction(check: PreflightCheck, checks: readonly PreflightCheck[]): { label: string; kind: 'turn_on_autofix' | 'go'; href: string } {
  if (check.key === 'autofix') {
    const github = checks.find((c) => c.key === 'github')
    if (github && !github.ready) return { label: 'Connect GitHub first', kind: 'go', href: github.fixHref }
    return { label: 'Turn on', kind: 'turn_on_autofix', href: check.fixHref }
  }
  return { label: CHECK_FIX_LABELS[check.key] ?? 'Fix this', kind: 'go', href: check.fixHref }
}

export function DispatchPreflightBanner({ preflight, projectId = null, className = '', required = false }: Props) {
  const navigate = useNavigate()
  const autofix = useTurnOnAutofix(projectId, preflight.reload)

  // Don't render: loading, no problems, or we couldn't reach the preflight API
  if (preflight.loading) return null
  if (preflight.ready) return null
  if (preflight.error) return null

  const failing = preflight.failing
  if (failing.length === 0) return null

  return (
    <details
      aria-label="Let Mushi Mushi dispatch the fix for you"
      className={`rounded-lg border border-edge-subtle bg-surface-raised px-3 py-2 ${className}`}
      data-testid="dispatch-preflight"
      open={required}
    >
      <summary className="cursor-pointer text-xs font-semibold text-fg">
        {required ? 'Let Mushi Mushi dispatch the fix for you' : 'Optional: let Mushi Mushi dispatch the fix for you'}{' '}
        <span className="font-normal text-fg-muted">
          ({failing.length === 1 ? '1 step left' : `${failing.length} steps left`})
        </span>
      </summary>
      <p className="mt-1 text-2xs text-fg-muted leading-snug">
        You don&apos;t need this to fix the bug: the fix prompt above works in Lovable, Cursor or Claude Code. Finish these
        steps if you want Mushi Mushi to make the change and open it for your review.
      </p>
      <div className="mt-2 space-y-1.5">
        {failing.map((check) => {
          const action = stepAction(check, preflight.checks)
          const inPlace = action.kind === 'turn_on_autofix' && Boolean(projectId)
          return (
          <div key={check.key} className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-1.5 min-w-0">
              <span aria-hidden="true" className="mt-px shrink-0">
                {CHECK_ICONS[check.key] ?? '•'}
              </span>
              <div className="min-w-0">
                {/* The colon belongs to the label: "Autofix enabled : You say yes" had a gap before it (2026-11-22). */}
                <span className="text-2xs font-medium text-fg-secondary">{check.label}:</span>{' '}
                <span className="text-2xs text-fg-muted">{CHECK_PLAIN[check.key] ?? check.hint}</span>
                {CHECK_PLAIN[check.key] && check.hint ? (
                  <span className="block text-2xs text-fg-muted">{check.hint}</span>
                ) : null}
              </div>
            </div>
            <Btn
              variant="ghost"
              size="sm"
              loading={inPlace && autofix.saving}
              disabled={inPlace && autofix.saving}
              onClick={() => {
                if (inPlace) {
                  void autofix.turnOn()
                } else if (action.href.startsWith('http')) {
                  window.open(action.href, '_blank', 'noreferrer')
                } else {
                  navigate(action.href)
                }
              }}
              className="shrink-0 text-2xs"
              data-testid={`dispatch-step-${check.key}`}
            >
              {action.label}
            </Btn>
          </div>
          )
        })}
      </div>
    </details>
  )
}
