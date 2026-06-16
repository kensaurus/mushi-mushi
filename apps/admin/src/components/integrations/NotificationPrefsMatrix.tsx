/**
 * FILE: apps/admin/src/components/integrations/NotificationPrefsMatrix.tsx
 *
 * Matrix of toggles for per-event Slack/Discord notification preferences.
 * Reads and writes `project_settings.notification_prefs` via the settings API.
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Toggle } from '../ui/forms'

interface NotifPrefs {
  'report.classified': boolean
  'qa_story.failed': boolean
  'qa_story.recovered': boolean
  'fix.dispatched': boolean
  'fix.pr_opened': boolean
  'intelligence.report': boolean
  'report_severity_min': 'low' | 'medium' | 'high' | 'critical'
}

const DEFAULT_PREFS: NotifPrefs = {
  'report.classified': true,
  'qa_story.failed': true,
  'qa_story.recovered': true,
  'fix.dispatched': true,
  'fix.pr_opened': true,
  'intelligence.report': true,
  'report_severity_min': 'low',
}

const EVENTS: Array<{ key: keyof Omit<NotifPrefs, 'report_severity_min'>; label: string; description: string }> = [
  {
    key: 'qa_story.failed',
    label: 'QA story failed',
    description: 'Notify when a QA story fails or errors',
  },
  {
    key: 'qa_story.recovered',
    label: 'QA story recovered',
    description: 'Notify when a previously failing story passes again',
  },
  {
    key: 'report.classified',
    label: 'Report classified',
    description: 'Notify when a bug report is triaged by AI',
  },
  {
    key: 'fix.dispatched',
    label: 'Fix dispatched',
    description: 'Notify when an auto-fix attempt is started',
  },
  {
    key: 'fix.pr_opened',
    label: 'Fix PR opened',
    description: 'Notify when a draft PR is opened on GitHub',
  },
  {
    key: 'intelligence.report',
    label: 'Weekly intelligence report',
    description: 'Weekly LLM narrative of KPI trends',
  },
]

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'] as const

interface Props {
  projectId: string
}

export function NotificationPrefsMatrix({ projectId }: Props) {
  const toast = useToast()
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch<{ notificationPrefs?: Partial<NotifPrefs> | null }>('/v1/admin/settings')
      .then((res) => {
        if (res.ok && res.data?.notificationPrefs) {
          setPrefs({ ...DEFAULT_PREFS, ...res.data.notificationPrefs })
        }
      })
      .catch(() => { /* use defaults */ })
      .finally(() => setLoading(false))
  }, [projectId])

  const toggle = (key: keyof Omit<NotifPrefs, 'report_severity_min'>) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ notification_prefs: prefs }),
      })
      if (res.ok) toast.success('Notification preferences saved.')
      else toast.error('Could not save preferences.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-md border border-edge-subtle divide-y divide-edge-subtle">
        {EVENTS.map((e) => (
          <div key={e.key} className="h-14 bg-surface-overlay motion-safe:animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised divide-y divide-edge-subtle">
        {EVENTS.map((event) => (
          <div
            key={event.key}
            className="flex items-start justify-between gap-4 px-3 py-3 min-h-11"
          >
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs font-semibold text-fg">{event.label}</p>
              <p className="text-2xs text-fg-muted leading-snug mt-0.5">{event.description}</p>
            </div>
            <Toggle
              checked={prefs[event.key]}
              onChange={() => toggle(event.key)}
              ariaLabel={event.label}
            />
          </div>
        ))}

        {prefs['report.classified'] && (
          <div className="flex flex-col gap-2 px-3 py-3 bg-surface-overlay sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-fg">Minimum severity for report alerts</p>
              <p className="text-2xs text-fg-muted leading-snug mt-0.5">
                Only send report-classified notifications at or above this level
              </p>
            </div>
            <select
              className="w-full sm:w-auto shrink-0 bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-xs text-fg-secondary hover:border-edge focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 motion-safe:transition-colors"
              value={prefs.report_severity_min}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  report_severity_min: e.target.value as NotifPrefs['report_severity_min'],
                }))
              }
              aria-label="Minimum severity for report alerts"
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
        <Btn type="button" variant="primary" size="md" loading={saving} onClick={() => void handleSave()}>
          Save preferences
        </Btn>
      </div>
    </div>
  )
}
