/**
 * FILE: apps/admin/src/pages/ReleasesPage.tsx
 * PURPOSE: Release management — draft changelogs with reporter attribution.
 *   Phase 2 of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Drafts    — edit + publish draft releases
 *     Published — history of published releases with credit count
 */

import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { useToast } from '../lib/toast'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { SetupNudge } from '../components/SetupNudge'
import { useSetupStatus } from '../lib/useSetupStatus'
import { pluralizeWithCount } from '../lib/format'
import {
  PageHeader,
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
} from '../components/ui'
import { IconSparkle, IconChevronRight } from '../components/icons'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { FulfilledTicketsPicker } from '../components/support/FulfilledTicketsPicker'

/** List routes return `{ ok, data: T[] }`; usePageData exposes `data` as `T[]`. */
function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

// ─── Types ────────────────────────────────────────────────────

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
  draft: 'bg-warn-muted text-warn',
  published: 'bg-ok-muted text-ok',
}

const STATUS_LABEL: Record<Release['status'], string> = {
  draft: 'Draft',
  published: 'Published',
}

function statusBadge(status: Release['status']) {
  return <Badge className={STATUS_CLS[status]}>{STATUS_LABEL[status]}</Badge>
}

// ─── Draft release form ───────────────────────────────────────

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Version"
            placeholder="1.2.3"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
          <Input
            label="Title (optional)"
            placeholder="Performance update"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
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
          <p className="text-2xs text-fg-muted text-pretty max-w-xs sm:text-right">
            Scans fixed reports in the last {windowDays} days
            {projectName ? ` for ${projectName}` : ''}, drafts a changelog, and credits reporters.
          </p>
        </div>
      </div>
    </Card>
  )
}

// ─── Release drawer ───────────────────────────────────────────

function ReleaseDrawer({ release, onClose, onPublished }: { release: Release; onClose: () => void; onPublished: () => void }) {
  const [body, setBody] = useState(release.body_md)
  const [fulfilledTicketIds, setFulfilledTicketIds] = useState<string[]>(
    release.fulfilled_ticket_ids ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const toast = useToast()

  const { data: detailData } = usePageData<Release>(
    `/v1/admin/releases/${release.id}`,
  )
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
                    {credit.notified_at && (
                      <span className="text-xs text-ok">notified</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {release.status === 'draft' && (
          <div className="flex gap-2 pt-2">
            <Btn loading={saving} variant="ghost" onClick={handleSave}>
              Save draft
            </Btn>
            <Btn loading={publishing} variant="primary" onClick={handlePublish}>
              Publish + notify
            </Btn>
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ─── Releases list ────────────────────────────────────────────

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
              ? `No drafts for ${projectName} yet. Generate one from recent fixed reports above.`
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
                <td className="hidden px-3 py-2.5 tabular-nums text-xs text-fg-muted sm:table-cell">
                  {r.fixed_report_ids.length}
                </td>
                <td className="hidden px-3 py-2.5 tabular-nums text-xs text-fg-muted md:table-cell">
                  {r.credited_reporter_ids.length}
                  {(r.fulfilled_ticket_ids?.length ?? 0) > 0 && (
                    <span className="text-ok ml-1" title="Admin feedback credited">
                      +{r.fulfilled_ticket_ids!.length}
                    </span>
                  )}
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
        <ReleaseDrawer
          release={selected}
          onClose={() => setSelected(null)}
          onPublished={onReload}
        />
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────

type TabId = 'drafts' | 'published'

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  { id: 'drafts', label: 'Drafts', description: 'Draft changelogs with AI — edit, attribute reporters, then publish.' },
  { id: 'published', label: 'Published', description: 'Published changelogs with reporter credits and in-app notification stamps.' },
]

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v)
}

export function ReleasesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: TabId = isTabId(param) ? param : 'drafts'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const listPath = activeProjectId ? `/v1/admin/releases?limit=100` : null

  const {
    data,
    loading,
    error,
    isValidating,
    lastFetchedAt,
    reload,
  } = usePageData<Release[]>(listPath, { deps: [activeProjectId] })

  useRealtimeReload(['releases', 'release_credits'], reload)

  const allReleases = listRows(data)
  const drafts = allReleases.filter((r) => r.status === 'draft')
  const published = allReleases.filter((r) => r.status === 'published')
  const releases = activeTab === 'drafts' ? drafts : published

  const setTab = useCallback((tab: TabId) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'drafts') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }, [searchParams, setSearchParams])

  usePublishPageContext({
    route: '/releases',
    title: `${activeMeta.label} · Releases`,
    summary: activeMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
  })

  const totalFixes = releases.reduce((sum, r) => sum + r.fixed_report_ids.length, 0)
  const totalCredits = releases.reduce((sum, r) => sum + r.credited_reporter_ids.length, 0)

  const tabOptions = [
    { id: 'drafts' as const, label: 'Drafts', count: drafts.length },
    { id: 'published' as const, label: 'Published', count: published.length },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Releases"
        description="Draft changelogs with AI, credit the users who helped, and close the feedback loop."
      />

      <PageHelp
        title="About Releases"
        whatIsIt="Release drafts scan fixed bug reports from a time window, attribute them to reporters, and write a plain-English changelog using AI."
        useCases={[
          'Auto-generate changelogs linked to the users who reported each fix',
          'Notify credited reporters in the feedback stamp when you publish',
          'Close the feedback loop: users see what their reports fixed',
        ]}
        howToUse="Select a date window and click Generate draft — AI writes the changelog. Review credited contributors, edit if needed, then publish to queue in-app toasts for each reporter."
      />

      <Section
        title="Release pipeline"
        freshness={{ at: lastFetchedAt, isValidating }}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="In this tab" value={releases.length} />
          <StatCard label="Fixes linked" value={totalFixes} />
          <StatCard label="Contributors" value={totalCredits} />
          <StatCard
            label="Project"
            value={activeProjectId ? 'Scoped' : '—'}
            hint={activeProjectId ? 'Lists are filtered to the active project in the header' : 'Select a project to load releases'}
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={(v) => setTab(v)}
          options={tabOptions}
          ariaLabel="Release sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {activeTab === 'drafts' && activeProjectId && (
          <div className="mb-4">
            <DraftForm onCreated={() => reload()} projectName={projectName} />
          </div>
        )}

        {!activeProjectId ? (
          <SetupNudge
            requires={['project']}
            emptyTitle="Select a project"
            emptyDescription="Releases are scoped to the active project. Pick one in the header to view drafts and publish changelogs."
          />
        ) : (
          <ReleasesList
            status={activeTab === 'drafts' ? 'draft' : 'published'}
            releases={releases}
            loading={loading}
            error={error}
            projectName={projectName}
            onReload={reload}
          />
        )}
      </Section>
    </div>
  )
}
