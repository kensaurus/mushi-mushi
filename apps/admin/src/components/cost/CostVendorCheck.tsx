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
import { Link } from 'react-router-dom'
import type { CostReconciliation } from './types'
import { vendorCheckLines } from './vendorCheck'

export function CostVendorCheck({ projectId }: { projectId: string }) {
  const page = usePageData<CostReconciliation>(`/v1/admin/costs/reconciliation?project_id=${encodeURIComponent(projectId)}`)
  if (!page.data) return null
  const lines = vendorCheckLines(page.data)
  const anyKey = page.data.providers.some((p) => p.hasAdminKey)
  return (
    <section aria-labelledby="cost-vendor-check-title" className="rounded-md border border-edge bg-surface p-3" data-testid="cost-vendor-check">
      <h3 id="cost-vendor-check-title" className="text-xs font-semibold text-fg">Checked against the provider's bill</h3>
      {!anyKey ? (
        <div className="mt-1 space-y-1 text-2xs text-fg-secondary" data-testid="cost-vendor-check-no-key">
          <p className="flex items-start gap-1.5">
            <StatusMark status="idle" className="mt-0.5" />
            <span>Add an OpenAI / Anthropic admin key to compare against your bill.</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4">
            <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer" className="text-link underline">
              OpenAI admin keys
            </a>
            <a href="https://console.anthropic.com/settings/admin-keys" target="_blank" rel="noreferrer" className="text-link underline">
              Anthropic admin keys
            </a>
            <Link to="/portfolio?tab=spend#portfolio-connectors" className="text-link underline">
              Add it under AI provider spend
            </Link>
          </p>
        </div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {lines.map((l) => (
            <li key={l.provider} className="flex items-start gap-1.5 text-2xs text-fg-secondary">
              <StatusMark status={l.status} className="mt-0.5" />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-2xs text-fg-muted">Checked daily. A difference above 3% raises an alert in Ops.</p>
    </section>
  )
}
