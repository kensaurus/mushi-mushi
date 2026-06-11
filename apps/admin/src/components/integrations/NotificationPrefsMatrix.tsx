/**
 * FILE: apps/admin/src/components/integrations/NotificationPrefsMatrix.tsx
 *
 * Matrix of toggles for per-event Slack/Discord notification preferences.
 * Reads and writes `project_settings.notification_prefs` via the settings API.
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

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
    description: 'Notify when a bug report is triaged by AI (respects severity filter below)',
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
      <div className="space-y-2">
        {EVENTS.map((e) => <div key={e.key} className="h-10 rounded-lg bg-surface-hover animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {EVENTS.map((event) => (
        <div
          key={event.key}
          className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-surface-hover transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg truncate">{event.label}</p>
            <p className="text-xs text-fg-tertiary truncate">{event.description}</p>
          </div>
          <button
            role="switch"
            aria-checked={prefs[event.key]}
            onClick={() => toggle(event.key)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30 ${
              prefs[event.key] ? 'bg-brand' : 'bg-border'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${
                prefs[event.key] ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      ))}

      {/* Severity threshold for report.classified */}
      {prefs['report.classified'] && (
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-surface-hover/50">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg">Minimum severity for report alerts</p>
            <p className="text-xs text-fg-tertiary">Only send report.classified notifications at or above this severity</p>
          </div>
          <select
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-brand/30"
            value={prefs.report_severity_min}
            onChange={(e) => setPrefs((p) => ({ ...p, report_severity_min: e.target.value as NotifPrefs['report_severity_min'] }))}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      )}

      <div className="pt-2">
        <button
          className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-medium hover:bg-brand/90 disabled:opacity-50 transition-colors"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  )
}
