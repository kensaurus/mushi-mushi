import { useState } from 'react'

/**
 * ObservedRouteCard — replaces the flat "Observed routes" table.
 *
 * The flat table forced the user to read every cell to figure out
 * which route is "loud" (lots of events) and which one is "interesting"
 * (lots of testids / APIs). The card layout exposes that at a squint:
 *
 *   - The event-count bar's *width* encodes traffic share.
 *   - The route path is the headline; the page title is supporting.
 *   - testids are colour-coded info chips (the "actions" the SDK saw).
 *   - APIs are colour-coded ok chips (the "writes" the SDK saw).
 *   - Click to expand for the full lists.
 *
 * Hidden-failure-mode notes:
 *   - H4 brand-color competition: the route path is `text-fg`,
 *     not brand. Brand is reserved for the global Generate CTA.
 *   - H16 left-anchored stack: the events count + last-seen sit on
 *     the right of each row to balance the path on the left.
 *   - H1 active-state mass: expanded ≠ painted differently — only
 *     the chevron rotates and the detail region appears below.
 */
export interface ObservedRoute {
  route: string
  pageTitle: string | null
  eventCount: number
  uniqueUsers: number
  testids: string[]
  apis: string[]
}

interface Props {
  route: ObservedRoute
  /** The largest event count across the visible set; drives the bar width. */
  maxEventCount: number
}

export function ObservedRouteCard({ route, maxEventCount }: Props) {
  const [expanded, setExpanded] = useState(false)
  const ratio =
    maxEventCount > 0 ? Math.max(0.04, route.eventCount / maxEventCount) : 0
  const widthPct = `${Math.round(ratio * 100)}%`
  return (
    <article className="group rounded-lg border border-edge-subtle bg-surface-overlay/40 hover:bg-surface-overlay transition-colors">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full text-left p-3 flex flex-col gap-2"
      >
        {/* Top row: path + counts */}
        <div className="flex items-baseline gap-3">
          <code className="text-sm font-medium text-fg font-mono truncate min-w-0 flex-1">
            {route.route}
          </code>
          <div className="flex items-center gap-3 shrink-0 text-2xs text-fg-faint tabular-nums">
            <span className="text-fg font-medium">
              {route.eventCount}
              <span className="ml-0.5 font-normal text-fg-faint">
                {route.eventCount === 1 ? ' event' : ' events'}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              {route.uniqueUsers}
              <span className="ml-0.5">{route.uniqueUsers === 1 ? ' user' : ' users'}</span>
            </span>
            <Chevron expanded={expanded} />
          </div>
        </div>

        {/* Event share bar — visual traffic intensity. Calm info-tinted bar
            on a visible neutral track so the "ratio" reads as data, not as
            an alert. (Brand reserved for the page-level CTA.) */}
        <div
          className="h-1.5 w-full rounded-full bg-edge-subtle/40 overflow-hidden"
          role="meter"
          aria-valuenow={route.eventCount}
          aria-valuemin={0}
          aria-valuemax={maxEventCount || 1}
          aria-label={`${route.eventCount} of ${maxEventCount || 1} events`}
        >
          <div
            className="h-full rounded-full bg-info/60"
            style={{ width: widthPct }}
            aria-hidden
          />
        </div>

        {/* Title + chip count summary */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          {route.pageTitle && (
            <span className="truncate max-w-[40ch]">
              <span className="text-fg-faint">title </span>
              <span className="text-fg">{route.pageTitle}</span>
            </span>
          )}
          {route.testids.length > 0 && (
            <ChipCountSummary
              tone="info"
              count={route.testids.length}
              label="testids"
              previewItems={route.testids}
            />
          )}
          {route.apis.length > 0 && (
            <ChipCountSummary
              tone="ok"
              count={route.apis.length}
              label="APIs"
              previewItems={route.apis}
            />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-edge-subtle px-3 py-3 grid gap-3 md:grid-cols-2">
          <DetailColumn
            heading="Test IDs"
            empty="No data-testid attributes seen on this route yet."
            items={route.testids}
            chipClassName="bg-info-muted/20 text-info ring-1 ring-info/25"
          />
          <DetailColumn
            heading="API paths"
            empty="No same-origin API requests seen on this route yet."
            items={route.apis}
            chipClassName="bg-ok-muted/15 text-ok ring-1 ring-ok/25"
          />
        </div>
      )}
    </article>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function ChipCountSummary({
  tone,
  count,
  label,
  previewItems,
}: {
  tone: 'info' | 'ok'
  count: number
  label: string
  previewItems: string[]
}) {
  const previewClass =
    tone === 'info'
      ? 'bg-info-muted/20 text-info ring-1 ring-info/25'
      : 'bg-ok-muted/15 text-ok ring-1 ring-ok/25'
  // Show first preview chip + count to give the user a "feel" for what the
  // SDK observed without dumping the whole list (tier-C density).
  const first = previewItems[0]
  return (
    <span className="inline-flex items-center gap-1.5">
      {first && (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono ${previewClass}`}
        >
          {first.length > 22 ? `${first.slice(0, 22)}…` : first}
        </span>
      )}
      {count > 1 && (
        <span className="text-fg-faint tabular-nums">
          +{count - 1} {label.toLowerCase()}
        </span>
      )}
      {count === 1 && first && (
        <span className="text-fg-faint">{label.toLowerCase().replace(/s$/, '')}</span>
      )}
    </span>
  )
}

function DetailColumn({
  heading,
  empty,
  items,
  chipClassName,
}: {
  heading: string
  empty: string
  items: string[]
  chipClassName: string
}) {
  return (
    <section>
      <h4 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">
        {heading} <span className="text-fg-muted tabular-nums">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="text-2xs text-fg-faint italic">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <code
              key={item}
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono ${chipClassName}`}
            >
              {item}
            </code>
          ))}
        </div>
      )}
    </section>
  )
}
