/**
 * TesterSubmissionsPage — view and submit bug reports against joined apps.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  TesterEmptyPanel,
  TesterPageIntro,
  TesterPanel,
  TesterPrimaryCta,
} from '../../components/tester/tester-ui'
import { usePageData } from '../../lib/usePageData'
import { TESTER_API_OPTS, normalizeListItems } from '../../lib/tester-page-data'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Badge } from '../../components/ui'
import { CHIP_TONE } from '../../lib/chipTone'

interface TesterSubmission {
  id: string
  appId: string
  appName: string
  title: string
  description: string
  status: 'pending' | 'accepted' | 'informative' | 'duplicate' | 'spam'
  pointsAwarded: number | null
  submittedAt: string
  reviewedAt: string | null
  reviewerNote: string | null
}

interface JoinedAppOption {
  id: string
  name: string
  slug: string
  joined: boolean
}

const STATUS_LABELS: Record<TesterSubmission['status'], { label: string; tone: string }> = {
  pending:     { label: 'Pending review', tone: 'text-fg-muted' },
  accepted:    { label: 'Accepted',       tone: 'text-ok' },
  informative: { label: 'Informative',    tone: 'text-brand' },
  duplicate:   { label: 'Duplicate',      tone: 'text-fg-faint' },
  spam:        { label: 'Spam',           tone: 'text-danger' },
}

export function TesterSubmissionsPage() {
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const prefillAppId = searchParams.get('appId') ?? ''
  const openNew = searchParams.get('new') === '1'

  const { data: subsRaw, loading, error: subsError, reload } = usePageData<{ items: TesterSubmission[]; total: number }>(
    '/v1/tester/submissions',
    TESTER_API_OPTS,
  )
  const { data: appsRaw, error: appsError } = usePageData<JoinedAppOption[] | { data: JoinedAppOption[] }>(
    '/v1/tester/apps',
    TESTER_API_OPTS,
  )

  const submissions = useMemo(() => normalizeListItems<TesterSubmission>(subsRaw), [subsRaw])
  const joinedApps = useMemo(() => {
    const apps = normalizeListItems<JoinedAppOption>(appsRaw)
    return apps.filter((a) => a.joined)
  }, [appsRaw])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(openNew)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    appId: prefillAppId,
    title: '',
    description: '',
    screenshotUrl: '',
  })

  useEffect(() => {
    if (prefillAppId) {
      setForm((f) => ({ ...f, appId: prefillAppId }))
    }
    if (openNew) setShowForm(true)
  }, [prefillAppId, openNew])

  const handleSubmit = async () => {
    if (!form.appId || !form.title.trim() || !form.description.trim()) return
    setSubmitting(true)
    try {
      const res = await apiFetch('/v1/tester/submissions', {
        method: 'POST',
        scope: 'none',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: form.appId,
          title: form.title.trim(),
          description: form.description.trim(),
          screenshotUrl: form.screenshotUrl.trim() || undefined,
        }),
      })
      if (res.ok) {
        toast.success('Bug report submitted — the developer will review it soon.')
        setForm({ appId: joinedApps[0]?.id ?? '', title: '', description: '', screenshotUrl: '' })
        setShowForm(false)
        reload()
      } else {
        const code = res.error?.code
        const msg = res.error?.message ?? 'Submission failed.'
        if (code === 'not_subscribed' || msg.includes('not_subscribed')) {
          toast.error('Join this app first before submitting a report.')
        } else {
          toast.error(msg)
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  const pendingCount = submissions.filter((s) => s.status === 'pending').length

  const loadError = subsError ?? appsError

  return (
    <div className="space-y-6">
      <TesterPageIntro
        title="My reports"
        description="Track submissions and file new bug reports for apps you've joined."
        meta={
          pendingCount > 0 ? (
            <Badge className={`border border-warn/30 ${CHIP_TONE.warnSubtle}`}>
              {pendingCount} pending review
            </Badge>
          ) : undefined
        }
        actions={
          joinedApps.length > 0 ? (
            <Btn onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ Report a bug'}
            </Btn>
          ) : (
            <TesterPrimaryCta to="/tester/apps">Join an app first →</TesterPrimaryCta>
          )
        }
      />

      {loadError && (
        <div className="rounded-md border border-danger/30 bg-danger-muted/30 p-4 space-y-2">
          <p className="text-sm text-danger">Could not load submissions: {loadError}</p>
          <Btn variant="ghost" size="sm" onClick={() => void reload()}>
            Retry
          </Btn>
        </div>
      )}

      {showForm && joinedApps.length > 0 && (
        <TesterPanel className="space-y-3">
          <p className="text-sm font-medium text-fg">Submit a bug report</p>
          <div className="space-y-2">
            <label className="block text-2xs text-fg-muted" htmlFor="submission-app">
              App
            </label>
            <select
              id="submission-app"
              value={form.appId}
              onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
              className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <option value="">Select a joined app…</option>
              {joinedApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
            <label className="block text-2xs text-fg-muted" htmlFor="submission-title">
              Title
            </label>
            <input
              id="submission-title"
              placeholder="One-line summary of the bug"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <label className="block text-2xs text-fg-muted" htmlFor="submission-description">
              Steps & details
            </label>
            <textarea
              id="submission-description"
              placeholder="Steps to reproduce, expected vs actual behavior…"
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full resize-y rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <label className="block text-2xs text-fg-muted" htmlFor="submission-screenshot">
              Screenshot URL (optional)
            </label>
            <input
              id="submission-screenshot"
              placeholder="https://…"
              value={form.screenshotUrl}
              onChange={(e) => setForm((f) => ({ ...f, screenshotUrl: e.target.value }))}
              className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
          </div>
          <Btn
            disabled={!form.appId || !form.title.trim() || !form.description.trim() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting…' : 'Submit bug report'}
          </Btn>
        </TesterPanel>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-surface-overlay" />
          ))}
        </div>
      )}

      {!loading && submissions.length === 0 && (
        <TesterEmptyPanel
          title="No reports yet"
          description="Join an app, test it like a real user, then submit your first bug report to start earning mushi-points."
          action={<TesterPrimaryCta to="/tester/apps">Browse apps →</TesterPrimaryCta>}
        />
      )}

      {!loading && submissions.length > 0 && (
        <div className="space-y-2">
          {submissions.map((sub) => {
            const statusMeta = STATUS_LABELS[sub.status] ?? STATUS_LABELS.pending
            const isExpanded = expandedId === sub.id
            return (
              <div key={sub.id} className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised">
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                  className="w-full items-start justify-between gap-3 p-4 text-left hover:bg-surface-overlay !rounded-none !border-transparent shadow-none focus-visible:ring-inset"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{sub.title}</p>
                    <p className="mt-0.5 text-2xs text-fg-muted">
                      {sub.appName} · {new Date(sub.submittedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {sub.pointsAwarded != null && sub.pointsAwarded > 0 && (
                      <span className="text-2xs font-medium tabular-nums text-ok">
                        +{sub.pointsAwarded.toLocaleString()} pts
                      </span>
                    )}
                    <span className={`text-2xs font-medium ${statusMeta.tone}`}>{statusMeta.label}</span>
                  </div>
                </Btn>

                {isExpanded && (
                  <div className="space-y-2 border-t border-edge-subtle px-4 pb-4 pt-0">
                    <p className="pt-3 text-xs whitespace-pre-wrap text-fg-secondary">{sub.description}</p>
                    {sub.reviewerNote && (
                      <div className="rounded-md bg-surface-root px-3 py-2">
                        <p className="text-2xs text-fg-muted">
                          <span className="font-medium text-fg">Reviewer note:</span> {sub.reviewerNote}
                        </p>
                      </div>
                    )}
                    {sub.reviewedAt && (
                      <p className="text-2xs text-fg-faint">
                        Reviewed {new Date(sub.reviewedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && joinedApps.length === 0 && (
        <p className="text-xs text-fg-muted">
          Need another app?{' '}
          <Link to="/tester/apps" className="font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
            Browse the catalog →
          </Link>
        </p>
      )}
    </div>
  )
}
