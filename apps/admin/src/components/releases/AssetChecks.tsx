/**
 * FILE: apps/admin/src/components/releases/AssetChecks.tsx
 * PURPOSE: One release-kit asset's spec checks for the chosen preset, as
 *          chips (Plan 025 P5/P6): ok (measured from the file), declared (only
 *          the uploader said so), not read, or no (the store will refuse it).
 *          Text, not colour alone; the detail is the chip's hover title.
 */

import { CHECK_BADGE, type KitAsset, type SpecCheck } from '../../lib/releaseShipView'
import { Badge } from '../ui'

const CHECK_WORD: Record<SpecCheck['state'], string> = { pass: 'ok', fail: 'no', declared: 'declared', unknown: 'not read' }

export function AssetChecks({ asset }: { asset: Pick<KitAsset, 'checks' | 'usableAs'> }) {
  if (!asset.checks?.length) return null
  return (
    <ul role="list" aria-label="Checks for the chosen preset" className="flex flex-wrap gap-1" data-testid="asset-checks">
      {asset.checks.map((c) => (
        <li key={c.id}>
          <Badge tone={CHECK_BADGE[c.state].tone} title={c.detail}>
            {c.label}: {CHECK_WORD[c.state]}
          </Badge>
        </li>
      ))}
      {asset.usableAs && (
        <li>
          <Badge tone="neutral" title="How the kit can use it">as {asset.usableAs}</Badge>
        </li>
      )}
    </ul>
  )
}
