export interface DriftBucketItem {
  label: string
  detail?: string
}

interface Props {
  /** False while there is no inventory to compare against: one line instead of three "None" boxes. */
  hasInventory?: boolean
  missingInInventory: DriftBucketItem[]
  missingInApp: DriftBucketItem[]
  mismatches: DriftBucketItem[]
}

/**
 * Crawl results by bucket. The crawl itself is started from the page's one
 * "Run crawler" action (the action row above every inventory tab), so this
 * panel no longer repeats its own crawler button.
 */
export function DriftDiffPanel({ hasInventory = true, missingInInventory, missingInApp, mismatches }: Props) {
  // "None" three times said "in sync" for an app with no inventory at all (2026-11-18).
  if (!hasInventory) {
    return (
      <p className="text-xs text-fg-muted" data-testid="drift-nothing-to-compare">
        Nothing to compare yet: accept drafted stories on Discovery, or save a map file, then run the crawler.
      </p>
    )
  }
  const col = (title: string, items: DriftBucketItem[], tone: string) => (
    <div className={`rounded-md border p-3 ${tone}`}>
      <h4 className="text-2xs font-semibold mb-2">{title}</h4>
      {items.length === 0 ? (
        <p className="text-2xs text-fg-faint">None</p>
      ) : (
        <ul className="space-y-1 text-2xs">
          {items.map((it, i) => (
            <li key={`${title}-${i}`}>
              <span className="font-mono text-fg-secondary">{it.label}</span>
              {it.detail && <span className="text-fg-faint"> — {it.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {col(
          'Missing in inventory',
          missingInInventory,
          'border-warn/30 bg-warn/5',
        )}
        {col('Missing in app', missingInApp, 'border-info/30 bg-info/5')}
        {col('Attribute mismatches', mismatches, 'border-edge-subtle bg-surface-overlay/30')}
      </div>
    </div>
  )
}
