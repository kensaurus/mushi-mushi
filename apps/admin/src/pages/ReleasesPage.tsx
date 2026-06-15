/**
 * FILE: apps/admin/src/pages/ReleasesPage.tsx
 * PURPOSE: Release management — banner + RELEASES SNAPSHOT + tabs:
 *          Overview | Drafts | Published | Draft.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
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
  contributorsDetail,
  contributorsTooltip,
  draftsDetail,
  draftsTooltip,
  feedbackDetail,
  feedbackTooltip,
  fixedReportsDetail,
  fixedReportsTooltip,
  fixesLinkedDetail,
  fixesLinkedTooltip,
  publishedDetail,
  publishedTooltip,
} from '../lib/statTooltips/releases'
import { releasesLinks } from '../lib/statCardLinks'
import { PageScopeHint,SnapshotSectionHint,PageHeader,
  PageHelp,
  Card,
  Section,
  Badge,
  Btn,
  Input,
  ErrorAlert,
  RelativeTime,
  StatCard,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction, } from '../components/ui'
import { ReleasesStatusBanner } from '../components/releases/ReleasesStatusBanner'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import {
  EMPTY_RELEASES_STATS,
  type ReleasesStats,
  type ReleasesTabId,
} from '../components/releases/ReleasesStatsTypes'
import { IconSparkle, IconChevronRight } from '../components/icons'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { FulfilledTicketsPicker } from '../components/support/FulfilledTicketsPicker'

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
  draft: 'bg-warn-muted/50 text-warning-foreground border border-warn/20',
  published: 'bg-ok-muted/50 text-ok-foreground border border-ok/20',
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

function resolveReleasesTab(value: string | null): ReleasesTabId {
  if (value === 'drafts' || value === 'published' || value === 'draft') return value
  return 'overview'
}

function DraftForm({ onCreated, projectName }: { onCreated: () => void; projectName: string | null }) {
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
      }) as { ok: boolean; error?: string }
      if (!res.ok) throw new Error(res.error ?? 'Draft failed')
      toast.success('Release draft created')
      setVersion('')
      setTitle('')
      onCreated()
    } catch (err) {
      toast.error((err as Error).message)
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
            leadingIcon={<IconSparkle className="h-3.5 w-3.5" aria-hidden="true" />}
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

function ReleaseDrawer({ release, onClose, onPublished }: { release: Release; onClose: () => void; onPublished: () => void }) {
  const [body, setBody] = useState(release.body_md)
  const [fulfilledTicketIds, setFulfilledTicketIds] = useState<string[]>(release.fulfilled_ticket_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const toast = useToast()

  const { data: detailData } = usePageData<Release>(`/v1/admin/releases/${release.id}`)
  const credits = detailData?.credits ?? []
  const detailRelease = detailData ?? release
  const ticketCount = fulfilledTicketIds.length

  const persistDraft = useCallback(async (patch: { body_md?: string; fulfilled_ticket_ids?: string[] }) => {
    const res = await apiFetch(`/v1/admin/releases/${release.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }) as { ok: boolean; error?: string }
    if (!res.ok) throw new Error(res.error ?? 'Save failed')
  }, [release.id])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await persistDraft({ body_md: body, fulfilled_ticket_ids: fulfilledTicketIds })
      toast.success('Draft saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [body, fulfilledTicketIds, persistDraft, toast])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      await persistDraft({ body_md: body, fulfilled_ticket_ids: fulfilledTicketIds })
      const res = await apiFetch(`/v1/admin/releases/${release.id}/publish`, { method: 'POST' }) as {
        ok: boolean
        data?: Release
        notified?: number
        error?: string
      }
      if (!res.ok) throw new Error(res.error ?? 'Publish failed')
      const credited = res.notified ?? 0
      const ticketMsg = ticketCount > 0 ? ` · ${ticketCount} feedback ticket${ticketCount === 1 ? '' : 's'} marked shipped` : ''
      toast.success(`Published! ${credited} reporter${credited === 1 ? '' : 's'} credited${ticketMsg}.`)
      onPublished()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
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
              className="h-56 w-full resize-y rounded-lg border border-edge-subtle bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/50"
            />
          </div>
        )}

        {release.status === 'published' && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-secondary">Changelog</h3>
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-edge-subtle bg-surface-raised p-3 text-sm">
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
          <div className="flex gap-2 pt-2">
            <Btn loading={saving} variant="ghost" onClick={handleSave}>Save draft</Btn>
            <Btn loading={publishing} variant="primary" onClick={handlePublish}>Publish + notify</Btn>
          </div>
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
}: {
  status: 'draft' | 'published'
  releases: Release[]
  loading: boolean
  error: string | null
  projectName: string | null
  onReload: () => void
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
                className="cursor-pointer border-b border-edge-subtle last:border-0 motion-safe:transition-colors hover:bg-surface-raised/40"
                onClick={() => setSelected(r)}
              >
                <td className="px-3 py-2.5 font-mono text-xs font-semibold tabular-nums">v{r.version}</td>
                <td className="max-w-[12rem] truncate px-3 py-2.5 text-fg-secondary">{r.title}</td>
                <td className="px-3 py-2.5">{statusBadge(r.status)}</td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <SignalChip tone={r.fixed_report_ids.length > 0 ? 'brand' : 'neutral'}>
                    {r.fixed_report_ids.length} fixes
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
      </Card>

      {selected && (
        <ReleaseDrawer release={selected} onClose={() => setSelected(null)} onPublished={onReload} />
      )}
    </>
  )
}

export function ReleasesPage() {
  const copy = usePageCopy('/releases')
  const ux = useReleasesUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveReleasesTab(searchParams.get('tab'))
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

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
  const stats = { ...EMPTY_RELEASES_STATS, ...statsData }

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
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickReleasesTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

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
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
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
    <div className="space-y-4" data-testid="mushi-page-releases">
      <PageHelp
        title={copy?.help?.title ?? 'About Releases'}
        whatIsIt={copy?.help?.whatIsIt ?? 'Release drafts scan fixed bug reports from a time window, attribute them to reporters, and write a plain-English changelog using AI.'}
        useCases={copy?.help?.useCases ?? [
          'Auto-generate changelogs linked to the users who reported each fix',
          'Notify credited reporters in the feedback stamp when you publish',
          'Close the feedback loop: users see what their reports fixed',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Summary for posture. Drafts to review pending changelogs. Published for shipped releases. New draft to generate from fixed bugs.'}
      />

      <PageHeader
        title={copy?.title ?? 'Releases'}
        projectScope={stats.projectName ?? projectName ?? undefined}
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'warn'
                ? 'bg-warn-muted/50 text-warning-foreground'
                : bannerSeverity === 'brand'
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-overlay text-fg-muted'
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
      </PageHeader>
      <PageScopeHint text={copy?.description ?? "Banner + RELEASES SNAPSHOT — Overview for posture, Drafts/Published to manage, Draft to generate with AI."} />

      <ReleasesStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<ReleasesTabId>
        size="sm"
        ariaLabel="Releases sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideReleasesSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'RELEASES SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <SnapshotSectionHint text={activeTabMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={copy?.statLabels?.drafts ?? 'Drafts'} value={stats.draftCount} accent={stats.draftCount > 0 ? 'text-warn' : undefined} tooltip={draftsTooltip(stats)} detail={draftsDetail()} to={releasesLinks.drafts} />
          <StatCard label={copy?.statLabels?.published ?? 'Published'} value={stats.publishedCount} accent={stats.publishedCount > 0 ? 'text-ok' : undefined} tooltip={publishedTooltip(stats)} detail={publishedDetail()} to={releasesLinks.published} />
          <StatCard label={copy?.statLabels?.fixesLinked ?? 'Fixes linked'} value={stats.totalFixesLinked} accent={stats.totalFixesLinked > 0 ? 'text-brand' : undefined} tooltip={fixesLinkedTooltip(stats)} detail={fixesLinkedDetail()} to={releasesLinks.fixesLinked} />
          <StatCard label={copy?.statLabels?.contributors ?? 'Contributors'} value={stats.totalContributors} accent={stats.totalContributors > 0 ? 'text-brand' : undefined} tooltip={contributorsTooltip(stats)} detail={contributorsDetail(stats)} to={releasesLinks.contributors} />
          <StatCard label={copy?.statLabels?.fixedReports ?? 'Fixed reports'} value={stats.fixedReportsCount} accent={stats.fixedReportsCount > 0 ? 'text-brand' : undefined} tooltip={fixedReportsTooltip(stats)} detail={fixedReportsDetail()} to={releasesLinks.fixedReports} />
          <StatCard label={copy?.statLabels?.feedback ?? 'Feedback shipped'} value={stats.fulfilledTicketsShipped} accent={stats.fulfilledTicketsShipped > 0 ? 'text-ok' : undefined} tooltip={feedbackTooltip(stats)} detail={feedbackDetail(stats)} to={releasesLinks.feedback} />
        </div>
      </Section>
      )}

      {stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'drafts_pending'
              ? 'border-warn/30 bg-warn/5'
              : 'border-brand/30 bg-brand/5'
          }`}
        >
          <SignalChip tone={stats.topPriority === 'drafts_pending' ? 'warn' : 'brand'}>
            Top priority
          </SignalChip>
          <ContainedBlock tone={stats.topPriority === 'drafts_pending' ? 'warn' : 'info'}>
            <p className="text-xs font-medium leading-snug text-fg-primary">{stats.topPriorityLabel}</p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo} tone="brand">
              Take action →
            </ActionPill>
          </ActionPillRow>
        </Card>
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
          <DraftForm onCreated={reloadAll} projectName={projectName} />
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
          />
        )
      )}
    </div>
  )
}
