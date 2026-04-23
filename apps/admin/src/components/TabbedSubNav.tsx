/**
 * FILE: apps/admin/src/components/TabbedSubNav.tsx
 * PURPOSE: Wave T (2026-04-23) — reusable tab strip used by the future
 *          collapsed PDCA pages (/plan, /do, /check, /act, /quality,
 *          /connections). The primitive is shipped under the
 *          `VITE_ADVANCED_IA_V2` feature flag and is currently imported only
 *          by the Inbox + any new merged pages; the legacy 24-route surface
 *          is untouched by default.
 *
 *          Why tabs + router redirects instead of nested routers?
 *            - `react-router` v7 handles hash fragments cleanly, so
 *              `/quality#judge` ↔ `/judge` stays a single mental model.
 *            - Each tab is a `<Link>` (not a button): middle-click,
 *              cmd-click, and right-click "Open in new tab" all work
 *              because the underlying route is a real URL.
 *            - No IA state in React context — every state transition is
 *              a URL transition, which keeps back/forward trivially
 *              correct and makes screenshots reproducible.
 *
 *          Usage:
 *            <TabbedSubNav
 *              ariaLabel="Quality sub-nav"
 *              tabs={[
 *                { to: '/quality#judge', label: 'Judge', match: (l) => l.hash === '#judge' },
 *                { to: '/quality#prompts', label: 'Prompts' },
 *                { to: '/quality#weekly', label: 'Weekly digest' },
 *              ]}
 *            />
 */

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface TabbedSubNavTab {
  to: string
  label: string
  /** Optional counter rendered as a small chip after the label (e.g. "3"). */
  badge?: number | string
  /** Optional custom match function — called with the react-router Location
   *  object. Defaults to exact pathname match + hash (if the `to` includes
   *  one); most consumers can leave it unset. */
  match?: (location: { pathname: string; hash: string }) => boolean
}

export interface TabbedSubNavProps {
  /** Accessible name for the landmark region. Keep under 40 chars. */
  ariaLabel: string
  tabs: ReadonlyArray<TabbedSubNavTab>
  /** Optional slot at the right edge of the strip (e.g. filter pill). */
  trailing?: ReactNode
}

export function TabbedSubNav({ ariaLabel, tabs, trailing }: TabbedSubNavProps) {
  const location = useLocation()
  return (
    <nav
      aria-label={ariaLabel}
      data-tabbed-sub-nav
      className="mb-5 flex items-center justify-between gap-3 border-b border-edge"
    >
      <ul className="flex items-center gap-1 overflow-x-auto" role="tablist">
        {tabs.map((tab) => {
          const isActive = (tab.match ?? defaultMatch(tab.to))({
            pathname: location.pathname,
            hash: location.hash,
          })
          return (
            <li key={tab.to} role="presentation">
              <Link
                to={tab.to}
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? 'page' : undefined}
                data-tabbed-sub-nav-tab={tab.to}
                data-active={isActive || undefined}
                className={[
                  'inline-flex items-center gap-2 px-3 py-2 -mb-px text-xs font-medium motion-safe:transition-colors',
                  'border-b-2 rounded-t-sm',
                  isActive
                    ? 'border-brand text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg hover:bg-surface-overlay/50',
                ].join(' ')}
              >
                {tab.label}
                {tab.badge !== undefined && (
                  <span
                    aria-label={`${tab.badge} items`}
                    className={[
                      'inline-flex items-center justify-center rounded-full text-2xs font-semibold',
                      'min-w-[1.25rem] h-5 px-1.5',
                      isActive ? 'bg-brand/20 text-brand' : 'bg-surface-raised text-fg-muted',
                    ].join(' ')}
                  >
                    {tab.badge}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
      {trailing && <div className="pb-1">{trailing}</div>}
    </nav>
  )
}

function defaultMatch(to: string): (loc: { pathname: string; hash: string }) => boolean {
  const [path, hash] = to.split('#')
  return (loc) => {
    if (loc.pathname !== path) return false
    if (!hash) return !loc.hash
    return loc.hash === `#${hash}`
  }
}

/** True when Advanced IA v2 is enabled for this deploy. Read once and
 *  memoised implicitly by the Vite env system — safe to call inside
 *  render paths. */
export function isAdvancedIaV2Enabled(): boolean {
  const raw = import.meta.env.VITE_ADVANCED_IA_V2
  if (raw === undefined || raw === null || raw === '') return false
  return String(raw).toLowerCase() === 'true' || raw === '1'
}
