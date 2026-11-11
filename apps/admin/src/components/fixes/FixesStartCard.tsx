/**
 * FILE: apps/admin/src/components/fixes/FixesStartCard.tsx
 * PURPOSE: The Fixes page before the first fix (console audit 2026-11-11,
 *          finding 7). Every empty fix surface said "Connect GitHub", while the
 *          path that needs no setup, and works today, is the fix prompt on
 *          each bug. So that comes first; GitHub is the optional second way.
 */

import { Btn, Card } from '../ui'

export function FixesStartCard({ githubConnected }: { githubConnected: boolean }) {
  return (
    <Card className="p-4 space-y-3" data-testid="fixes-start">
      <div>
        <h2 className="text-sm font-semibold text-fg">Fix your first bug, no setup needed</h2>
        <p className="mt-0.5 text-xs text-fg-secondary">
          Open any bug and press <strong>Copy fix prompt</strong>. Paste it into Lovable, Bolt, Cursor or Claude Code: it
          says what broke and what to change. You check the change before you publish it.
        </p>
      </div>
      <Btn size="sm" variant="primary" to="/reports">
        Open my bugs
      </Btn>
      {!githubConnected && (
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
