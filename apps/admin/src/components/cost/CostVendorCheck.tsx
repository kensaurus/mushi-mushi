/**
 * FILE: apps/admin/src/components/cost/CostVendorCheck.tsx
 * PURPOSE: The daily check of the recorded AI spend against what OpenAI and
 *          Anthropic actually billed (GET /v1/admin/costs/reconciliation,
 *          written by recipe-collector through _shared/llm-cost-reconcile.ts).
 *          A provider with no admin key is said to be not checked, with the
 *          one step that turns the check on.
 */

import { usePageData } from '../../lib/usePageData'
import { StatusMark } from '../signal/StatusMark'
import { Btn } from '../ui'
import type { CostReconciliation } from './types'
import { vendorCheckLines } from './vendorCheck'

export function CostVendorCheck({ projectId }: { projectId: string }) {
  const page = usePageData<CostReconciliation>(`/v1/admin/costs/reconciliation?project_id=${encodeURIComponent(projectId)}`)
  if (!page.data) return null
  const lines = vendorCheckLines(page.data)
  const anyKey = page.data.providers.some((p) => p.hasAdminKey)
  return (
    <section aria-labelledby="cost-vendor-check-title" className="rounded-md border border-edge bg-surface p-3" data-testid="cost-vendor-check">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cost-vendor-check-title" className="text-xs font-semibold text-fg">Checked against the provider's bill</h3>
        {!anyKey && (
          <Btn size="sm" variant="ghost" to="/portfolio?tab=spend#portfolio-connectors">
            Add an admin key
          </Btn>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <li key={l.provider} className="flex items-start gap-1.5 text-2xs text-fg-secondary">
            <StatusMark status={l.status} className="mt-0.5" />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-2xs text-fg-muted">A difference above 3% raises an alert in Ops.</p>
    </section>
  )
}
