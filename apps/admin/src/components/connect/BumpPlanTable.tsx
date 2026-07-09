/**
 * Bump plan table for SDK upgrade PR preview.
 */

import { ResponsiveTable } from '../ResponsiveTable'
import type { BumpEntry } from '../../lib/useSdkUpgrade'

export function BumpPlanTable({ bumps }: { bumps: BumpEntry[] }) {
  if (bumps.length === 0) return null
  return (
    <ResponsiveTable ariaLabel="SDK upgrade bump plan">
      <table className="w-full text-xs">
        <thead className="bg-surface-hover/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-fg-muted">Package</th>
            <th className="px-3 py-2 text-left font-medium text-fg-muted">From</th>
            <th className="px-3 py-2 text-left font-medium text-fg-muted">To</th>
          </tr>
        </thead>
        <tbody>
          {bumps.map((b, i) => (
            <tr key={b.package} className={i % 2 === 0 ? 'bg-surface' : 'bg-surface-hover/30'}>
              <td className="px-3 py-1.5 font-mono">{b.package}</td>
              <td className="px-3 py-1.5 font-mono text-fg-muted">{b.from}</td>
              <td className="px-3 py-1.5 font-mono text-ok">{b.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}
