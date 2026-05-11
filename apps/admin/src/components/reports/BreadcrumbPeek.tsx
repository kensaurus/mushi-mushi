/**
 * FILE: apps/admin/src/components/reports/BreadcrumbPeek.tsx
 * PURPOSE: Hover-card popover showing the last 5 breadcrumbs and any
 *          sticky tags for a row in the Reports list. Triagers scan a
 *          long queue in <2s per row; surfacing the breadcrumb tail
 *          inline lets them filter "needs deeper look" from "obvious
 *          dupe" without committing to opening the drawer.
 *
 *          Lives as a portal-free, absolute-positioned span so it
 *          composes the same way `Tooltip` does — no positioning libs,
 *          no measurement work. Renders on the *trigger* element's
 *          hover/focus and stays open while the cursor is inside it
 *          (so the user can scroll long messages).
 */

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Badge } from '../ui'
import type { ReportBreadcrumbLite } from './types'

interface Props {
  breadcrumbs?: ReportBreadcrumbLite[] | null
  tags?: Record<string, string | number | boolean> | null
  sentryRelease?: string | null
  sentryEnvironment?: string | null
  /** Element that the popover is anchored to. */
  children: ReactNode
}

const LEVEL_TONE: Record<string, string> = {
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-fg-secondary',
  debug: 'text-fg-muted',
}

const CATEGORY_DOT: Record<string, string> = {
  navigation: 'bg-info',
  'ui.click': 'bg-brand',
  // Native SDKs emit `ui.tap` instead of `ui.click` (touch devices) — same
  // bucket in admin tooling.
  'ui.tap': 'bg-brand',
  console: 'bg-warn',
  xhr: 'bg-fg-muted',
  fetch: 'bg-fg-muted',
  // Native SDKs emit `network` instead of `xhr` / `fetch`.
  network: 'bg-fg-muted',
  lifecycle: 'bg-ok',
  custom: 'bg-fg-secondary',
}

const PEEK_LIMIT = 5
const TAG_LIMIT = 6

export function BreadcrumbPeek({
  breadcrumbs,
  tags,
  sentryRelease,
  sentryEnvironment,
  children,
}: Props) {
  const [visible, setVisible] = useState(false)
  const enterRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trail =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs.slice(-PEEK_LIMIT)
      : []
  const tagEntries = tags ? Object.entries(tags) : []

  const empty =
    trail.length === 0 &&
    tagEntries.length === 0 &&
    !sentryRelease &&
    !sentryEnvironment

  // No data → render the children unwrapped so we don't pay for hover
  // listeners on every row in a 200-row table.
  if (empty) return <>{children}</>

  const open = () => {
    if (leaveRef.current) clearTimeout(leaveRef.current)
    if (enterRef.current) clearTimeout(enterRef.current)
    enterRef.current = setTimeout(() => setVisible(true), 250)
  }
  const close = () => {
    if (enterRef.current) clearTimeout(enterRef.current)
    if (leaveRef.current) clearTimeout(leaveRef.current)
    leaveRef.current = setTimeout(() => setVisible(false), 100)
  }

  useEffect(() => () => {
    if (enterRef.current) clearTimeout(enterRef.current)
    if (leaveRef.current) clearTimeout(leaveRef.current)
  }, [])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocusCapture={open}
      onBlurCapture={close}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute z-[120] left-0 top-full mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] p-2 text-2xs text-fg bg-surface border border-edge rounded-sm shadow-raised tooltip-enter pointer-events-auto cursor-default"
          // Keep the popover open while the cursor moves into it so
          // the user can read longer messages without a flicker race.
          onMouseEnter={() => {
            if (leaveRef.current) clearTimeout(leaveRef.current)
          }}
          onMouseLeave={close}
        >
          {(sentryRelease || sentryEnvironment) && (
            <div className="flex items-center gap-1 mb-2">
              {sentryEnvironment && (
                <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle text-2xs">
                  env · {sentryEnvironment}
                </Badge>
              )}
              {sentryRelease && (
                <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle text-2xs font-mono">
                  {truncate(sentryRelease, 32)}
                </Badge>
              )}
            </div>
          )}

          {tagEntries.length > 0 && (
            <div className="mb-2">
              <div className="text-[0.625rem] uppercase tracking-wider text-fg-muted mb-1">
                Tags
              </div>
              <div className="flex flex-wrap gap-1">
                {tagEntries.slice(0, TAG_LIMIT).map(([k, v]) => (
                  <Badge
                    key={k}
                    className="bg-surface-overlay text-fg-secondary border border-edge-subtle font-mono text-2xs"
                    title={`${k} = ${String(v)}`}
                  >
                    <span className="text-fg-muted">{k}</span>
                    <span className="mx-0.5 text-fg-faint">:</span>
                    <span>{truncate(String(v), 18)}</span>
                  </Badge>
                ))}
                {tagEntries.length > TAG_LIMIT && (
                  <span className="text-2xs text-fg-faint self-center">
                    +{tagEntries.length - TAG_LIMIT}
                  </span>
                )}
              </div>
            </div>
          )}

          {trail.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[0.625rem] uppercase tracking-wider text-fg-muted">
                  Last {trail.length} breadcrumb{trail.length === 1 ? '' : 's'}
                </div>
                {breadcrumbs && breadcrumbs.length > PEEK_LIMIT && (
                  <span className="text-[0.625rem] text-fg-faint">
                    +{breadcrumbs.length - PEEK_LIMIT} earlier
                  </span>
                )}
              </div>
              <ol className="space-y-1">
                {trail.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 leading-snug">
                    <span
                      aria-hidden
                      className={`mt-1 size-1.5 rounded-full shrink-0 ${
                        CATEGORY_DOT[c.category] ?? 'bg-fg-faint'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <span className="font-mono text-2xs text-fg-muted shrink-0">
                          {c.category}
                        </span>
                        {c.level && c.level !== 'info' && (
                          <span
                            className={`font-mono text-2xs ${
                              LEVEL_TONE[c.level] ?? 'text-fg-muted'
                            }`}
                          >
                            {c.level}
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-fg-secondary truncate" title={c.message}>
                        {c.message || <span className="italic text-fg-faint">no message</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-2xs italic text-fg-faint">
              No breadcrumbs captured for this report.
            </p>
          )}
        </span>
      )}
    </span>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}
