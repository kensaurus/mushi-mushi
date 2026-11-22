/**
 * FILE: apps/admin/src/components/OperatorRoute.tsx
 * PURPOSE: Route guard for the operator cockpit (ADR 0052; console audit
 *          2026-11-11, finding 8): Mushi Mushi's own processing queue, SQL
 *          console, triage grading and prompts (navRegistry OPERATOR_ROUTES).
 *          The registry flag only hid them from the sidebar; a link still
 *          opened them for every account.
 *
 *          Uses the console's one operator signal (entitlements `operator`,
 *          server `operator_users` / MUSHI_OPERATOR_USER_IDS). While the
 *          entitlements load it shows a loader, and a failed read never
 *          sends anyone away: an operator reloading /queue must not be thrown
 *          off it because one request was slow.
 */

import type { ReactNode } from 'react'
import { useEntitlements } from '../lib/useEntitlements'
import { Btn, Loading } from './ui'

export function OperatorRoute({ children }: { children: ReactNode }) {
  const { isOperator, loading, error } = useEntitlements()
  if (isOperator || error) return <>{children}</>
  if (loading) return <Loading text="Loading…" />
  return (
    <div className="mx-auto max-w-md space-y-3 py-12 text-center" data-testid="operator-only">
      <h1 className="text-base font-semibold text-fg">This page is for the Mushi Mushi team</h1>
      <p className="text-sm text-fg-secondary">
        It shows how Mushi Mushi itself runs, not your app. Your bugs, their explanations and fixes are on the pages in
        your sidebar.
      </p>
      <Btn size="sm" variant="primary" to="/dashboard">
        Go to Home
      </Btn>
    </div>
  )
}
