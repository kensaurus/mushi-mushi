/**
 * FILE: apps/admin/src/components/ui/app-group.tsx
 * PURPOSE: The section every multi-app view uses to group its rows by app
 *          (owner, 2026-11-19: "group … data of project and app so it's
 *          easier to read"). Pair with lib/groupByApp.ts.
 *
 *          ▾ [icon] yen-yen   ✕ 3 failed  ● 2 running  ✓ 12      15 rows  →
 *            …rows…
 *
 *          - Header: the app's icon and name, status counts as StatusPills
 *            (colour + glyph, never colour alone), an optional right-side
 *            summary, and a link to that app's own view.
 *          - Collapsible; a group whose `defaultOpen` is false starts closed.
 *          - Dense: one 28px header row, no card padding (console-dense rule).
 */

import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ProjectFavicon } from '../ProjectFavicon'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { useSetupStatus } from '../../lib/useSetupStatus'
import { UNASSIGNED_APP_ID } from '../../lib/groupByApp'
import { openAppOnly } from '../../lib/projectScope'
import { faviconSourceFromProject } from '../../lib/resolveProjectDomain'

const STATUS_ORDER: readonly RunStatus[] = ['failed', 'slow', 'waiting', 'running', 'cancelled', 'passed', 'idle']

export interface AppGroupSectionProps {
  app: { id: string; name: string }
  /** Status counts for the header chips, e.g. { failed: 3, running: 2, passed: 12 }. Zero counts are hidden. */
  counts?: Partial<Record<RunStatus, number>>
  /** Short words for a count, e.g. { passed: 'ok' } → "✓ 12 ok". */
  countLabels?: Partial<Record<RunStatus, string>>
  /** Right-aligned meta (row count, wait time …). */
  summary?: ReactNode
  /** Link to this app's own view of the page. Clicking it leaves All apps and pins this app. */
  to?: string
  defaultOpen?: boolean
  children: ReactNode
  'data-testid'?: string
}

export function AppGroupSection({
  app,
  counts,
  countLabels,
  summary,
  to,
  defaultOpen = true,
  children,
  'data-testid': testId,
}: AppGroupSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const setup = useSetupStatus()
  const project = setup.data?.projects.find((p) => p.project_id === app.id)
  const chips = STATUS_ORDER.filter((s) => (counts?.[s] ?? 0) > 0)

  return (
    <section
      aria-label={app.name}
      data-testid={testId ?? `app-group-${app.id}`}
      className="min-w-0 border-t border-edge-subtle first:border-t-0"
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span aria-hidden className={`inline-block w-3 text-fg-muted motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}>
            ▸
          </span>
          {app.id !== UNASSIGNED_APP_ID ? (
            <ProjectFavicon
              {...(project
                ? faviconSourceFromProject(project)
                : { project_id: app.id, project_name: app.name, project_slug: '' })}
              size={14}
            />
          ) : null}
          <span className="truncate text-sm font-semibold text-fg">{app.name}</span>
        </button>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {chips.map((s) => (
            <StatusPill key={s} status={s} label={`${counts?.[s]}${countLabels?.[s] ? ` ${countLabels[s]}` : ''}`} />
          ))}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-2xs text-fg-muted tabular-nums">
          {summary}
          {to ? (
            <Link
              to={to}
              // All apps mode lives in storage, so a plain link would land on the combined page again.
              // Opening one app leaves All apps and pins that app, as picking it in the switcher does.
              onClick={() => {
                if (app.id !== UNASSIGNED_APP_ID) openAppOnly(app.id)
              }}
              className="text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
              aria-label={`Open ${app.name} only`}
            >
              Open →
            </Link>
          ) : null}
        </span>
      </div>
      <div id={bodyId} hidden={!open} className="min-w-0 pb-1.5 pl-4">
        {children}
      </div>
    </section>
  )
}
