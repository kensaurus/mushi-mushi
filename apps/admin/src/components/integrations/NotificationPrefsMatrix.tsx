/**
 * FILE: apps/admin/src/components/integrations/NotificationPrefsMatrix.tsx
 *
 * Matrix of toggles for per-event Slack/Discord notification preferences.
 * Reads and writes `project_settings.notification_prefs` via the settings API.
 */

import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeApiFailure } from '../../lib/humanizeApiError'
import { Btn, Toggle } from '../ui/forms'
import { Card } from '../ui'

interface NotifPrefs {
  'report.classified': boolean
  'qa_story.failed': boolean
  'qa_story.recovered': boolean
  'fix.dispatched': boolean
  'fix.pr_opened': boolean
  'fix.failed': boolean
  'fix.merged': boolean
  'intelligence.report': boolean
  'report_severity_min': 'low' | 'medium' | 'high' | 'critical'
}

const DEFAULT_PREFS: NotifPrefs = {
  'report.classified': true,
  'qa_story.failed': true,
  'qa_story.recovered': true,
  'fix.dispatched': true,
  'fix.pr_opened': true,
  'fix.failed': true,
  'fix.merged': true,
  'intelligence.report': true,
  'report_severity_min': 'low',
}

// The label is the event; a subtitle only when it adds something the label
// does not say (round-2 review 2026-11-18: each subtitle restated its title).
const EVENTS: Array<{ key: keyof Omit<NotifPrefs, 'report_severity_min'>; label: string; description?: string }> = [
  { key: 'qa_story.failed', label: 'QA story failed' },
  { key: 'qa_story.recovered', label: 'QA story recovered' },
  { key: 'report.classified', label: 'New bug sorted' },
  { key: 'fix.dispatched', label: 'Fix started' },
  { key: 'fix.pr_opened', label: 'Fix PR opened', description: 'A draft PR on GitHub' },
  { key: 'fix.failed', label: 'Fix attempt failed' },
  { key: 'fix.merged', label: 'Fix merged' },
  { key: 'intelligence.report', label: 'Weekly intelligence report', description: 'How bugs and fixes are trending' },
]

/** How many alert events are switched on (the page's "No alert channel" row counts them). */
function alertEventsOn(prefs: object): number {
  const on = prefs as Partial<Record<string, unknown>>
  return EVENTS.filter((e) => on[e.key] !== false).length
}

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'] as const

interface Props {
  projectId: string
  /**
   * Slack, Discord or Teams is connected. Without one the events go nowhere,
   * so the toggles are disabled until a channel exists (round-2 review).
   */
  channelConnected?: boolean
  /** The saved count of events on, once loaded (null while loading or failed). */
  onEventsOnChange?: (count: number | null) => void
}

export function NotificationPrefsMatrix({ projectId, channelConnected = true, onEventsOnChange }: Props) {
  const toast = useToast()
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // True when prefs could not be loaded for THIS project. Gates the save so
  // defaulted state can never be written over a project's real settings.
  const [error, setError] = useState(false)
  // Bumped by Retry to re-run the load effect.
  const [reloadNonce, setReloadNonce] = useState(0)
  // A report-back callback: held in a ref so a new identity never refetches.
  const reportOn = useRef(onEventsOnChange)
  useEffect(() => {
    reportOn.current = onEventsOnChange
  })

  // Three bugs lived here:
  //
  // 1. A swallowed failure rendered DEFAULT_PREFS — every toggle ON — which
  //    is indistinguishable from "this project really has everything on".
  //    The user then believes they are looking at saved settings.
  // 2. `loading` was only ever set false, so switching projects showed no
  //    skeleton, and if the next project had no saved prefs `setPrefs` was
  //    never called — the PREVIOUS project's values stayed on screen.
  //    Clicking Save then wrote them over the current project.
  // 3. No stale-response guard, so a fast A→B→A switch could land B's
  //    response on A.
  //
  // Now: reset per project, guard against stale responses, and surface the
  // failure instead of fabricating state.
  //
  // GET /v1/admin/settings returns the raw project_settings row, so the key
  // is snake_case `notification_prefs` (only /settings/stats camelCases it).
  // Reading `notificationPrefs` here always got undefined: the matrix showed
  // defaults and the next Save wrote them over the saved suppressions.
  //
  // A successful load with `notification_prefs: null` is NOT a failure: the
  // project has never saved prefs, and the server then delivers every event
  // (toggles are `!== false`) with a 'low' severity floor — exactly
  // DEFAULT_PREFS (classify-report, fast-filter, _shared/plugins.ts). Only a
  // failed request hides the matrix.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    apiFetch<{ notification_prefs?: Partial<NotifPrefs> | null }>('/v1/admin/settings')
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          const loaded = { ...DEFAULT_PREFS, ...(res.data?.notification_prefs ?? {}) }
          setPrefs(loaded)
          reportOn.current?.(alertEventsOn(loaded))
        } else {
          setError(true)
          reportOn.current?.(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          reportOn.current?.(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadNonce])

  const toggle = (key: keyof Omit<NotifPrefs, 'report_severity_min'>) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
  }

  const handleSave = async () => {
    // Defence in depth: the error branch returns before the Save button
    // renders, but never PATCH a full prefs object we could not load — that
    // is how defaulted state overwrites a project's real suppressions.
    if (error) return
    setSaving(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ notification_prefs: prefs }),
      })
      if (res.ok) {
        toast.success('Notification preferences saved.')
        reportOn.current?.(alertEventsOn(prefs))
      }
      else {
        const t = describeApiFailure(res.error, 'Could not save notification preferences')
        toast.error(t.title, t.description)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="divide-y divide-edge-subtle">
        {EVENTS.map((e) => (
          <div key={e.key} className="h-12 bg-surface-overlay motion-safe:animate-pulse" />
        ))}
      </div>
    )
  }

  // Render the failure rather than a matrix of defaults. Showing all-ON here
  // would claim these are the project's saved preferences.
  if (error) {
    return (
      <Card className="px-3 py-4 space-y-2">
        <p className="text-xs font-semibold text-fg">
          Couldn&apos;t load notification preferences for this project
        </p>
        <p className="text-2xs text-fg-muted leading-snug">
          The toggles aren&apos;t shown because we can&apos;t tell which events are currently
          enabled — showing defaults would misrepresent your settings.
        </p>
        <Btn size="sm" variant="ghost" onClick={() => setReloadNonce((n) => n + 1)}>
          Retry
        </Btn>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {!channelConnected && (
        <p className="text-2xs leading-snug text-fg-secondary" data-testid="notification-prefs-no-channel">
          Connect Slack, Discord or Teams above to change these. With no channel they have nowhere to go.
        </p>
      )}
      {/* Rows only: the Alert events panel is the card (no bordered box inside it).
          Two columns on a wide screen, so a label and its switch sit close together. */}
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2" data-testid="notification-prefs-rows">
        {EVENTS.map((event) => (
          <div
            key={event.key}
            className="flex min-h-11 items-center justify-between gap-4 border-b border-edge-subtle py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-fg">{event.label}</p>
              {event.description ? <p className="mt-0.5 text-2xs leading-snug text-fg-muted">{event.description}</p> : null}
            </div>
            <Toggle
              checked={prefs[event.key]}
              onChange={() => toggle(event.key)}
              ariaLabel={event.label}
              disabled={!channelConnected}
            />
          </div>
        ))}
      </div>
      <div>

        {prefs['report.classified'] && (
          <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-fg">Minimum severity for report alerts</p>
              <p className="text-2xs text-fg-muted leading-snug mt-0.5">
                Only send report-classified notifications at or above this level
              </p>
            </div>
            <select
              className="w-full sm:w-auto shrink-0 bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-xs text-fg-secondary hover:border-edge focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40 motion-safe:transition-opacity"
              value={prefs.report_severity_min}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  report_severity_min: e.target.value as NotifPrefs['report_severity_min'],
                }))
              }
              aria-label="Minimum severity for report alerts"
              disabled={!channelConnected}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-edge-subtle/80 pt-3">
        <Btn type="button" variant="primary" size="md" loading={saving} disabled={!channelConnected} onClick={() => void handleSave()}>
          Save preferences
        </Btn>
      </div>
    </div>
  )
}
