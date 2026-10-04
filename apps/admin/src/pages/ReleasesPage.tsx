/**
 * FILE: apps/admin/src/pages/ReleasesPage.tsx
 * PURPOSE: Release management — banner + RELEASES SNAPSHOT + tabs:
 *          Overview | Drafts | Published | Draft.
 */

import { useState, useCallback, useMemo } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { apiErrorText } from '../lib/apiErrorText'
import { publishReleaseRequest } from '../lib/releasePublish'
import { resolveModeAwareTab } from '../lib/modeAwareTab'
import { useEntitlements } from '../lib/useEntitlements'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useRealtimeReload } from '../lib/realtime'
import { useToast } from '../lib/toast'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { SetupNudge } from '../components/SetupNudge'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useReleasesUx, resolveQuickReleasesTab } from '../lib/releasesModeUx'
import { pluralizeWithCount } from '../lib/format'
import {
  Card,
  Badge,
  Btn,
  Input,
  ErrorAlert,
  RelativeTime,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
} from '../components/ui'
import { ReleasesStatusBanner } from '../components/releases/ReleasesStatusBanner'
import { ReleasesSnapshotStrip } from '../components/releases/ReleasesSnapshotStrip'
import { ReleasesProvenanceReadout } from '../components/releases/ReleasesProvenanceReadout'
import { AutoReleaseCard } from '../components/releases/AutoReleaseCard'
import {
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import {
  EMPTY_RELEASES_STATS,
  type ReleasesStats,
  type ReleasesTabId,
} from '../components/releases/ReleasesStatsTypes'
import { IconReleases, IconChevronRight } from '../components/icons'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { ResponsiveTable } from '../components/ResponsiveTable'
import { FulfilledTicketsPicker } from '../components/support/FulfilledTicketsPicker'
import { CHIP_TONE, runStatusChipTone, HEADER_BADGE_TONE } from '../lib/chipTone'

function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

interface Release {
  id: string
  project_id: string
  version: string
  title: string
  body_md: string
  status: 'draft' | 'published'
  published_at: string | null
  fixed_report_ids: string[]
  credited_reporter_ids: string[]
  fulfilled_ticket_ids?: string[]
  created_at: string
  updated_at: string
  credits?: Credit[]
}

interface Credit {
  id: string
  end_user_id: string | null
  report_id: string | null
  contribution_type: 'reporter' | 'first_reproducer' | 'top_voter'
  display_name_at_time: string | null
  notified_at: string | null
}

const STATUS_CLS: Record<Release['status'], string> = {
  draft: runStatusChipTone('draft'),
  published: runStatusChipTone('published'),
}

const STATUS_LABEL: Record<Release['status'], string> = {
  draft: 'Draft',
  published: 'Published',
}

function statusBadge(status: Release['status']) {
  return <Badge className={STATUS_CLS[status]}>{STATUS_LABEL[status]}</Badge>
}

const TABS: Array<{ id: ReleasesTabId; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Posture banner and how AI drafting, reporter credits, and publish notifications work.' },
  { id: 'drafts', label: 'Drafts', description: 'Edit changelog Markdown, link feedback tickets, then publish to notify credited reporters.' },
  { id: 'published', label: 'Published', description: 'Shipped changelogs with fix counts, contributor credits, and notification stamps.' },
  { id: 'draft', label: 'Draft', description: 'Generate a new AI changelog from fixed reports in a time window.' },
]

/** The tab named in the URL, or null so quickstart can pick one. */
function explicitReleasesTab(value: string | null): ReleasesTabId | null {
  if (value === 'drafts' || value === 'published' || value === 'draft') return value
  return null
}

function DraftForm({ onCreated, projectName, canEdit }: { onCreated: () => void; projectName: string | null; canEdit: boolean }) {
  const [version, setVersion] = useState('')
  const [title, setTitle] = useState('')
  const [windowDays, setWindowDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const projectId = useActiveProjectId()

  const handleDraft = useCallback(async () => {
    if (!version.trim()) { toast.error('Enter a version number'); return }
    if (!projectId) { toast.error('Select a project first'); return }
    setLoading(true)
    try {
      const windowEnd = new Date()
      const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000)
      const res = await apiFetch('/v1/admin/releases/draft', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          version,
          title: title || undefined,
          window_start: windowStart.toISOString(),
          window_end: windowEnd.toISOString(),
        }),
      })
      if (!res.ok) {
        toast.error('Could not draft the release', apiErrorText(res.error, 'Try again in a minute.'))
        return
      }
      toast.success('Release draft created')
      setVersion('')
      setTitle('')
      onCreated()
    } catch {
      toast.error('Could not draft the release', 'Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [version, title, projectId, windowDays, onCreated, toast])

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-secondary">Generate draft with AI</h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="Version" placeholder="1.2.3" value={version} onChange={(e) => setVersion(e.target.value)} />
          <Input label="Title (optional)" placeholder="Performance update" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input
            label="Report window (days)"
            type="number"
            min={1}
            max={365}
            value={String(windowDays)}
            onChange={(e) => setWindowDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
          <Btn
            variant="primary"
            loading={loading}
            onClick={handleDraft}
            disabled={!canEdit}
            title={canEdit ? undefined : 'Viewers have read-only access and cannot draft releases.'}
            leadingIcon={<IconReleases className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            Generate draft with AI
          </Btn>
          <InlineProof className="max-w-xs sm:text-right">
            Scans fixed reports in the last {windowDays} days
            {projectName ? ` for ${projectName}` : ''}, drafts a changelog, and credits reporters.
          </InlineProof>
        </div>
      </div>
    </Card>
  )
}

function ReleaseDrawer({
  release,
  onClose,
  onPublished,
  canEdit,
}: {
  release: Release
  onClose: () => void
  onPublished: () => void
  canEdit: boolean
}) {
  const [body, setBody] = useState(release.body_md)
  const [fulfilledTicketIds, setFulfilledTicketIds] = useState<string[]>(release.fulfilled_ticket_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const toast = useToast()

  const { data: detailData } = usePageData<Release>(`/v1/admin/releases/${release.id}`)
  const credits = detailData?.credits ?? []
  const detailRelease = detailData ?? release
  const ticketCount = fulfilledTicketIds.length

  /** Returns null on success, or a plain-English reason. */
  const persistDraft = useCallback(async (patch: { body_md?: string; fulfilled_ticket_ids?: string[] }): Promise<string | null> => {
    try {
      const res = await apiFetch(`/v1/admin/releases/${release.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return res.ok ? null : apiErrorText(res.error, 'The draft could not be saved. Try again in a moment.')
    } catch {
      return 'Could not reach the server. Check your connection and try again.'
    }
  }, [release.id])

  const handleSave = useCallback(async () => {
    setSaving(true)
    const problem = await persistDraft({ body_md: body, fulfilled_ticket_ids: fulfilledTicketIds })
    setSaving(false)
    if (problem) toast.error('Draft not saved', problem)
    else toast.success('Draft saved')
  }, [body, fulfilledTicketIds, persistDraft, toast])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const res = await apiFetch(`/v1/admin/releases/${release.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Draft not deleted', apiErrorText(res.error, 'Try again in a moment.'))
        return
      }
      toast.success('Draft deleted', 'Auto-release can draft the next build again.')
      setConfirmDelete(false)
      onPublished()
      onClose()
    } catch {
      toast.error('Draft not deleted', 'Check your connection and try again.')
    } finally {
      setDeleting(false)
    }
  }, [release.id, onPublished, onClose, toast])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      const saveProblem = await persistDraft({ body_md: body, fulfilled_ticket_ids: fulfilledTicketIds })
      if (saveProblem) {
        toast.error('Not published', `The latest edits could not be saved first. ${saveProblem}`)
        return
      }
      const outcome = await publishReleaseRequest(release.id)
      if (outcome.kind === 'failed') {
        toast.error('Not published', outcome.message)
        return
      }
      setConfirmPublish(false)
      if (outcome.kind === 'published-with-errors') {
        // It is live: close and refresh so the list stops showing a draft.
        toast.push({ tone: 'warning', title: 'Published, with problems', description: outcome.message })
      } else {
        const { told, held, failed, alreadyShipped } = outcome
        const ticketMsg = ticketCount > 0 ? ` · ${ticketCount} feedback ticket${ticketCount === 1 ? '' : 's'} marked shipped` : ''
        const heldMsg = held > 0 ? ` · ${held} waiting in the Outbox` : ''
        const shippedMsg = alreadyShipped > 0
          ? ` · ${alreadyShipped} fix${alreadyShipped === 1 ? '' : 'es'} already shipped in an earlier release (not messaged again)`
          : ''
        toast.success(`Published! ${told} reporter${told === 1 ? '' : 's'} told it shipped${heldMsg}${shippedMsg}${ticketMsg}.`)
        if (failed > 0) toast.error(`${failed} reporter message${failed === 1 ? '' : 's'} could not be delivered`, 'See Notifications for the failed messages.')
      }
      onPublished()
      onClose()
    } finally {
      setPublishing(false)
    }
  }, [release.id, body, fulfilledTicketIds, ticketCount, persistDraft, onPublished, onClose, toast])

  return (
    <Drawer open title={`v${release.version} — ${release.title}`} onClose={onClose} width="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge(release.status)}
          <span className="text-xs text-fg-muted">
            {pluralizeWithCount(release.fixed_report_ids.length, 'fix', 'fixes')}
            {' · '}
            {pluralizeWithCount(release.credited_reporter_ids.length, 'contributor', 'contributors')}
            {ticketCount > 0 && (
              <>
                {' · '}
                {pluralizeWithCount(ticketCount, 'feedback ticket', 'feedback tickets')}
              </>
            )}
          </span>
        </div>

        {release.status === 'draft' && release.project_id && (
          <FulfilledTicketsPicker
            projectId={release.project_id}
            selectedIds={fulfilledTicketIds}
            onChange={setFulfilledTicketIds}
            disabled={saving || publishing}
          />
        )}

        {release.status === 'published' && (detailRelease.fulfilled_ticket_ids?.length ?? 0) > 0 && (
          <p className="text-2xs text-ok">
            {detailRelease.fulfilled_ticket_ids!.length} admin feedback submission
            {detailRelease.fulfilled_ticket_ids!.length === 1 ? '' : 's'} credited in this release.
          </p>
        )}

        {release.status === 'draft' && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Changelog (Markdown)
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="h-56 w-full resize-y rounded-lg border border-edge-subtle bg-surface px-3 py-2 font-mono text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            />
          </div>
        )}

        {release.status === 'published' && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-secondary">Changelog</h3>
            <pre className="mushi-code-block mushi-code-body max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-code-surface-border p-3 text-sm">
              {release.body_md}
            </pre>
          </div>
        )}

        {credits.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Reporter credits ({credits.length})
            </h3>
            <div className="space-y-1">
              {credits.map((credit) => (
                <div key={credit.id} className="flex items-center justify-between rounded-md border border-edge-subtle p-2 text-sm">
                  <span className="font-medium">
                    {credit.display_name_at_time ?? `User-${credit.end_user_id?.slice(-4) ?? 'anon'}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-surface-raised text-fg-secondary">{credit.contribution_type}</Badge>
                    {credit.notified_at ? (
                      <span className="text-xs text-ok">notified</span>
                    ) : (
                      <span className="text-xs text-warn">pending</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {release.status === 'draft' && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Btn loading={saving} variant="ghost" onClick={handleSave} disabled={!canEdit || publishing}>Save draft</Btn>
            <Btn
              loading={publishing}
              variant="primary"
              onClick={() => setConfirmPublish(true)}
              disabled={!canEdit || saving}
              title={canEdit ? undefined : 'Viewers have read-only access and cannot publish.'}
            >
              Publish + notify
            </Btn>
            <Btn
              variant="ghost"
              className="ml-auto text-danger"
              onClick={() => setConfirmDelete(true)}
              disabled={!canEdit || saving || publishing}
              title={canEdit ? 'Delete this draft. Nothing is sent to reporters.' : 'Viewers have read-only access and cannot delete drafts.'}
            >
              Delete draft
            </Btn>
          </div>
        )}

        {confirmPublish && (
          <ConfirmDialog
            title={`Publish v${release.version}?`}
            body={`This publishes the changelog, marks ${pluralizeWithCount(release.fixed_report_ids.length, 'fix', 'fixes')} as shipped${ticketCount > 0 ? ` and ${pluralizeWithCount(ticketCount, 'feedback ticket', 'feedback tickets')} as shipped` : ''}, and messages ${pluralizeWithCount(release.credited_reporter_ids.length, 'credited reporter', 'credited reporters')}. A published release cannot be unpublished.`}
            confirmLabel="Publish + notify"
            cancelLabel="Not yet"
            loading={publishing}
            onConfirm={() => void handlePublish()}
            onCancel={() => {
              if (!publishing) setConfirmPublish(false)
            }}
          />
        )}

        {confirmDelete && (
          <ConfirmDialog
            title={`Delete draft v${release.version}?`}
            body="The draft and its changelog text are removed. No reporter is messaged, and auto-release can draft the next build again."
            confirmLabel="Delete draft"
            cancelLabel="Keep draft"
            tone="danger"
            loading={deleting}
            onConfirm={() => void handleDelete()}
            onCancel={() => {
              if (!deleting) setConfirmDelete(false)
            }}
          />
        )}
      </div>
    </Drawer>
  )
}

function ReleasesList({
  status,
  releases,
  loading,
  error,
  projectName,
  onReload,
  canEdit,
}: {
  status: 'draft' | 'published'
  releases: Release[]
  loading: boolean
  error: string | null
  projectName: string | null
  onReload: () => void
  canEdit: boolean
}) {
  const [selected, setSelected] = useState<Release | null>(null)

  if (error) return <ErrorAlert message={error} />
  if (loading) return <TableSkeleton rows={5} />

  if (releases.length === 0) {
    return (
      <SetupNudge
        requires={['project']}
        emptyTitle={status === 'draft' ? 'No draft releases' : 'No published releases'}
        emptyDescription={
          status === 'draft'
            ? projectName
              ? `No drafts for ${projectName} yet. Generate one from the Draft tab.`
              : 'Generate a changelog draft from recent fixed reports.'
            : projectName
              ? `Nothing published for ${projectName} yet. Publish a draft to notify credited reporters.`
              : 'Publish a draft release to see it here.'
        }
        emptyHints={
          status === 'draft'
            ? ['Scans reports marked fixed in the selected window', 'Credits reporters by display name', 'Edit the Markdown before publishing']
            : ['Published releases queue in-app attribution toasts', 'Credits show who helped ship each fix']
        }
      />
    )
  }

  return (
    <>
      <Card className="overflow-hidden">
        <ResponsiveTable ariaLabel="Release notes">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge-subtle bg-surface-raised/50 text-xs text-fg-muted">
              <th className="px-3 py-2 text-left font-medium">Version</th>
              <th className="px-3 py-2 text-left font-medium">Title</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Fixes</th>
              <th className="hidden px-3 py-2 text-left font-medium md:table-cell">Contributors</th>
              <th className="px-3 py-2 text-left font-medium">Updated</th>
              <th className="px-3 py-2" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {releases.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-edge-subtle last:border-0 motion-safe:transition-opacity hover:bg-surface-raised"
                onClick={() => setSelected(r)}
              >
                <td className="px-3 py-2.5 font-mono text-xs font-semibold tabular-nums">v{r.version}</td>
                <td className="max-w-48 truncate px-3 py-2.5 text-fg-secondary">{r.title}</td>
                <td className="px-3 py-2.5">{statusBadge(r.status)}</td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <SignalChip tone={r.fixed_report_ids.length > 0 ? 'brand' : 'neutral'}>
                    {r.fixed_report_ids.length} fix{r.fixed_report_ids.length === 1 ? '' : 'es'}
                  </SignalChip>
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">
                  <div className="flex flex-wrap items-center gap-1">
                    <SignalChip tone={r.credited_reporter_ids.length > 0 ? 'ok' : 'neutral'}>
                      {r.credited_reporter_ids.length} credited
                    </SignalChip>
                    {(r.fulfilled_ticket_ids?.length ?? 0) > 0 && (
                      <span title="Admin feedback credited">
                        <SignalChip tone="ok">
                          +{r.fulfilled_ticket_ids!.length} feedback
                        </SignalChip>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-fg-muted">
                  {r.published_at ? (
                    <>Published <RelativeTime value={r.published_at} /></>
                  ) : (
                    <>Created <RelativeTime value={r.created_at} /></>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <IconChevronRight className="h-4 w-4 text-fg-faint" aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </ResponsiveTable>
      </Card>

      {selected && (
        <ReleaseDrawer release={selected} onClose={() => setSelected(null)} onPublished={onReload} canEdit={canEdit} />
      )}
    </>
  )
}

export function ReleasesPage() {
  const copy = usePageCopy('/releases')
  const ux = useReleasesUx()
  const { canEditProject } = useEntitlements()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ReleasesStats>('/v1/admin/releases/stats')
  usePublishPageHeroStats('/releases', statsData)
  const stats = { ...EMPTY_RELEASES_STATS, ...statsData }
  const activeTab = resolveModeAwareTab<ReleasesTabId>({
    explicit: explicitReleasesTab(searchParams.get('tab')),
    isQuickstart: ux.isQuickstart,
    quickTab: statsData ? resolveQuickReleasesTab(stats) : null,
    fallback: 'overview',
  })
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const listPath = activeProjectId && (activeTab === 'drafts' || activeTab === 'published')
    ? `/v1/admin/releases?limit=100`
    : null

  const {
    data,
    loading: listLoading,
    error: listError,
    reload: reloadList,
    isValidating: listValidating,
  } = usePageData<Release[]>(listPath, { deps: [activeProjectId, activeTab] })

  useRealtimeReload(['releases', 'release_credits'], () => {
    reloadStats()
    reloadList()
  })

  const allReleases = listRows(data)
  const drafts = allReleases.filter((r) => r.status === 'draft')
  const published = allReleases.filter((r) => r.status === 'published')
  const listReleases = activeTab === 'drafts' ? drafts : published

  const setActiveTab = useCallback(
    (tab: ReleasesTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        // Always explicit: with no ?tab= quick mode shows the posture tab,
        // so clearing it for Overview made Overview unreachable.
        next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadList()
  }, [reloadStats, reloadList])

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label:
          t.id === 'overview'
            ? copy?.tabLabels?.overview ?? t.label
            : t.id === 'drafts'
              ? copy?.tabLabels?.drafts ?? t.label
              : t.id === 'published'
                ? copy?.tabLabels?.published ?? t.label
                : copy?.tabLabels?.draft ?? t.label,
        count:
          t.id === 'drafts' && stats.draftCount > 0
            ? stats.draftCount
            : t.id === 'published' && stats.publishedCount > 0
              ? stats.publishedCount
              : undefined,
      })),
    [stats.draftCount, stats.publishedCount, copy?.tabLabels],
  )

  usePublishPageContext({
    route: '/releases',
    title: projectName ? `Releases · ${projectName}` : 'Releases',
    summary: statsLoading
      ? 'Loading releases…'
      : stats.draftCount > 0
        ? `${stats.draftCount} draft${stats.draftCount === 1 ? '' : 's'} pending publish`
        : `${stats.publishedCount} published`,
    criticalCount: stats.draftCount,
  })

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading releases">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <ErrorAlert message={`Failed to load release stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'drafts_pending'
        ? 'warn'
        : stats.topPriority === 'ready_to_draft' || stats.topPriority === 'no_releases'
          ? 'brand'
          : stats.topPriority === 'no_fixes'
            ? 'brand'
            : 'ok'

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-releases">
      <PageHeaderBar
        title={copy?.title ?? 'Releases'}
        projectScope={stats.projectName ?? projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About Releases'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Release drafts scan fixed bug reports from a time window, attribute them to reporters, and write a plain-English changelog using AI.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Auto-generate changelogs linked to the users who reported each fix',
          'Notify credited reporters in the feedback stamp when you publish',
          'Close the feedback loop: users see what their reports fixed',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Summary for posture. Drafts to review pending changelogs. Published for shipped releases. New draft to generate from fixed bugs.'}
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'warn'
                ? CHIP_TONE.warnSubtle
                : bannerSeverity === 'brand'
                  ? HEADER_BADGE_TONE.brand
                  : HEADER_BADGE_TONE.neutral
          }
        >
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : stats.draftCount > 0
              ? `${stats.draftCount} DRAFT`
              : stats.totalReleases === 0
                ? 'EMPTY'
                : `${stats.publishedCount} SHIPPED`}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || listValidating}>
          Refresh
        </Btn>
        <Btn size="sm" variant="primary" onClick={() => setActiveTab('draft')}>
          + Draft
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <ReleasesStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideReleasesSnapshot,
            children: (
              <ReleasesSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'RELEASES SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl<ReleasesTabId>
        size="sm"
        scrollable
        ariaLabel="Releases sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {activeTab === 'overview' && stats.projectId ? (
        <ReleasesProvenanceReadout stats={stats} fetchedAt={statsFetchedAt} validating={statsValidating} />
      ) : null}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <>
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Release pipeline healthy"
              description={stats.topPriorityLabel ?? `${stats.publishedCount} published releases with reporter credits.`}
            />
          )}
          {stats.topPriority === 'drafts_pending' && (
            <RecommendedAction
              tone="info"
              title="Drafts waiting to publish"
              description={stats.topPriorityLabel ?? 'Review changelog Markdown and publish to notify reporters.'}
              cta={{ label: 'Open Drafts', to: '/releases?tab=drafts' }}
            />
          )}
          {(stats.topPriority === 'ready_to_draft' || stats.topPriority === 'no_releases') && (
            <RecommendedAction
              tone="info"
              title="Generate a changelog draft"
              description={stats.topPriorityLabel ?? 'Fixed reports are ready — AI will credit reporters automatically.'}
              cta={{ label: 'Open Draft tab', to: '/releases?tab=draft' }}
            />
          )}
          {stats.topPriority === 'no_fixes' && (
            <RecommendedAction
              tone="info"
              title="No fixed reports yet"
              description="Mark bug reports as fixed in Reports before generating a release draft."
              cta={{ label: 'View fixed reports', to: '/reports?status=fixed' }}
            />
          )}
          </>
          )}
          {activeProjectId ? <AutoReleaseCard projectId={activeProjectId} /> : null}
        </>
      )}

      {activeTab === 'draft' && (
        !activeProjectId ? (
          <SetupNudge
            requires={['project']}
            emptyTitle="Select a project"
            emptyDescription="Releases are scoped to the active project. Pick one in the header to generate a draft."
          />
        ) : (
          <DraftForm onCreated={reloadAll} projectName={projectName} canEdit={canEditProject} />
        )
      )}

      {(activeTab === 'drafts' || activeTab === 'published') && (
        !activeProjectId ? (
          <SetupNudge
            requires={['project']}
            emptyTitle="Select a project"
            emptyDescription="Releases are scoped to the active project. Pick one in the header to view drafts and published changelogs."
          />
        ) : (
          <ReleasesList
            status={activeTab === 'drafts' ? 'draft' : 'published'}
            releases={listReleases}
            loading={listLoading}
            error={listError}
            projectName={projectName}
            onReload={reloadAll}
            canEdit={canEditProject}
          />
        )
      )}
    </div>
  )
}
