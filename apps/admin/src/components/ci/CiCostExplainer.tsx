/**
 * FILE: apps/admin/src/components/ci/CiCostExplainer.tsx
 * PURPOSE: "Why this costs what it costs" on /ci (ADR 0037): the rules
 *          GitHub bills by, each with this window's evidence when the data
 *          shows it happening (public repos free, included minutes, whole
 *          minutes per job, macOS ≈ 10× Linux, re-runs bill again, jobs
 *          pinned to GitHub with the workflow's reason, main and Dependabot
 *          always on GitHub, smaller machines for private repos, expired
 *          jobs, the postponed self-hosted fee). Rules that apply come first,
 *          open; the rest sit in one native disclosure (keyboard friendly).
 */

import type { CiCompare } from '../../lib/ciCompareTypes'
import { costFacts, type CostFact } from '../../lib/ciCompareView'
import { IconInfo } from '../icons'

function Fact({ fact }: { fact: CostFact }) {
  return (
    <li className="flex flex-col gap-1 py-2" data-testid={`ci-cost-fact-${fact.id}`}>
      <p className="text-sm font-medium text-fg">{fact.title}</p>
      <p className="text-xs text-fg-secondary">{fact.detail}</p>
      {fact.evidence && (
        <p className="flex items-start gap-1 text-2xs text-fg-muted">
          <IconInfo size={12} className="mt-px shrink-0" />
          <span className="wrap-break-word">{fact.evidence}</span>
        </p>
      )}
      {fact.items && fact.items.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-2xs text-fg-secondary">
          {fact.items.map((i) => (
            <li key={i.key} className="wrap-break-word">
              <span className="font-mono">{i.label}</span>
              {i.note && <span className="text-fg-muted"> — {i.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function CiCostExplainer({ data }: { data: CiCompare }) {
  const facts = costFacts(data)
  const applies = facts.filter((f) => f.applies)
  const rest = facts.filter((f) => !f.applies)
  return (
    <div data-testid="ci-cost-explainer">
      {applies.length > 0 ? (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {applies.map((f) => (
            <Fact key={f.id} fact={f} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">Nothing unusual in this window. The rules GitHub bills by are below.</p>
      )}
      <details className="group mt-2 rounded-md border border-edge-subtle px-2.5 py-1.5">
        <summary className="cursor-pointer select-none text-xs font-medium text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          {applies.length > 0 ? `The other ${rest.length} rules GitHub bills by` : `All ${rest.length} rules`}
        </summary>
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {rest.map((f) => (
            <Fact key={f.id} fact={f} />
          ))}
        </ul>
      </details>
    </div>
  )
}
