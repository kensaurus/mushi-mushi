/**
 * FILE: apps/admin/src/components/fixes/FixesStartCard.tsx
 * PURPOSE: The Fixes page before the first fix (console audit 2026-11-11,
 *          finding 7). Every empty fix surface said "Connect GitHub", while the
 *          path that needs no setup, and works today, is the fix prompt on
 *          each bug. So that comes first; GitHub is the optional second way.
 *
 *          Owner's walkthrough, 2026-11-17: "0 attempts, No fixes in the last
 *          30 days" read as a dead end. The card now says how a fix starts,
 *          opens the worst open bug, and offers to turn Autofix on in place
 *          when GitHub is ready and Autofix is off.
 */

import { Btn, Card } from '../ui'
import { useDispatchPreflight } from '../../lib/useDispatchPreflight'
import { useTurnOnAutofix } from '../../lib/useTurnOnAutofix'

/** The Bugs list, worst first (severity_rank: critical=4 … low=1). @internal Exported for unit tests only. */
export const WORST_BUG_HREF = '/reports?sort=severity&dir=desc'

export function FixesStartCard({ githubConnected, projectId = null }: { githubConnected: boolean; projectId?: string | null }) {
  const preflight = useDispatchPreflight(projectId)
  const autofix = useTurnOnAutofix(projectId, preflight.reload)
  const autofixCheck = preflight.checks.find((c) => c.key === 'autofix')
  const githubReady = preflight.checks.find((c) => c.key === 'github')?.ready ?? githubConnected
  const offerAutofix = Boolean(projectId) && githubReady && autofixCheck?.ready === false
  return (
    <Card className="p-4 space-y-3" data-testid="fixes-start">
      <div>
        <h2 className="text-sm font-semibold text-fg">How a fix starts</h2>
        <ul className="mt-1 space-y-0.5 text-xs text-fg-secondary">
          <li>
            <strong>You:</strong> open a bug and press <strong>Copy fix prompt</strong>. Paste it into Lovable, Bolt, Cursor or
            Claude Code: it says what broke and what to change. No setup needed.
          </li>
          <li>
            <strong>Mushi Mushi:</strong> with Autofix on, it writes the change for each sorted bug and opens it as a draft
            pull request for you to review. Nothing goes live without you.
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="primary" to={WORST_BUG_HREF}>
          Open the worst open bug
        </Btn>
        {offerAutofix && (
          <Btn size="sm" variant="ghost" onClick={() => void autofix.turnOn()} loading={autofix.saving} data-testid="fixes-turn-on-autofix">
            Turn on Autofix
          </Btn>
        )}
      </div>
      {!githubReady && (
        <div className="border-t border-edge-subtle pt-3">
          <p className="text-xs font-medium text-fg">Optional: let Mushi Mushi make the change for you</p>
          <p className="mt-0.5 text-2xs text-fg-muted">
            Connect the GitHub repository your app&apos;s code lives in. Mushi Mushi then writes the change and opens it as a
            pull request for you to review. Nothing goes live without you.
          </p>
          <Btn size="sm" variant="ghost" to="/connect#connect-github" className="mt-2">
            Connect GitHub
          </Btn>
        </div>
      )}
    </Card>
  )
}
