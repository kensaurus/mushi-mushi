/**
 * FILE: apps/admin/src/components/settings/LabsPanel.tsx
 * PURPOSE: Settings › Display & sidebar, sidebar half. One switch per page outside the core
 *          bug → diagnosis → fix loop (lib/labs.ts), grouped the way the
 *          registry groups them. On adds the page to the sidebar; off only
 *          hides it there — every page stays reachable from ⌘K and by link.
 *          Saved to your account as you switch (lib/labs.ts), so there is no
 *          Save and other browsers get the same pages.
 *
 *          A compact grid (owner, 2026-11-18): about twenty full-width rows
 *          became the groups side by side, one tight row per page (switch,
 *          name, where it is listed and what it is, an Open link).
 */

import { Link } from 'react-router-dom'
import { Toggle } from '../ui'
import { IconArrowRight } from '../icons'
import { SIGNAL_ICON_LINK } from '../signal/AlertCards'
import { LAB_FEATURES, LAB_GROUP_LABEL, useLabs, type LabFeature } from '../../lib/labs'

const GROUPS = Object.keys(LAB_GROUP_LABEL) as LabFeature['group'][]

export function LabsPanel() {
  const { isEnabled, setEnabled } = useLabs()

  return (
    <div className="space-y-3" data-testid="settings-labs">
      <p className="text-sm text-fg-muted">
        Pages to keep in your sidebar under Labs. Every other page is one click away under More pages
        in the sidebar, and in ⌘K.
      </p>
      {/* The query sits on this wrapper; the grid inside reads it (a container never matches its own @min-*). */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {GROUPS.map((group) => {
            const features = LAB_FEATURES.filter((f) => f.group === group)
            if (features.length === 0) return null
            return (
              <section key={group} aria-labelledby={`lab-group-${group}`} className="min-w-0">
                <h3 id={`lab-group-${group}`} className="mb-1 border-b border-edge-subtle pb-1 text-3xs font-bold tracking-wider text-fg-secondary uppercase">
                  {LAB_GROUP_LABEL[group]}
                </h3>
                <ul className="divide-y divide-edge-subtle/60">
                  {features.map((f) => {
                    const on = isEnabled(f.id)
                    return (
                      <li key={f.id} id={`lab-${f.id}`} className="flex min-w-0 items-center gap-2 py-1">
                        {/* The switch only decides the sidebar: "Off" read as "this page
                            is turned off" while it kept working (console journeys
                            2026-10-27), so the row says where the page is listed. */}
                        <Toggle ariaLabel={`${f.label} in the sidebar`} checked={on} onChange={(next) => setEnabled(f.id, next)} />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-xs font-semibold text-fg">{f.label}</span>
                          {/* Only an "on" row says so: "Not in sidebar" on twenty rows was a wall next to
                              the switches the heading already explains (fresh-eyes 2026-11-18). */}
                          <span className="block truncate text-3xs text-fg-secondary" title={f.description}>
                            {on && <span className="font-semibold text-ok-foreground">● In sidebar · </span>}
                            {f.description}
                          </span>
                        </span>
                        <Link
                          to={f.paths[0]}
                          className={`${SIGNAL_ICON_LINK} h-6 w-6 shrink-0`}
                          aria-label={`Open ${f.label}`}
                          title={`Open ${f.label}`}
                          data-testid={`lab-open-${f.id}`}
                        >
                          <IconArrowRight size={12} />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
