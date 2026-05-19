/**
 * FILE: apps/admin/src/pages/ReleasesPage.tsx
 * PURPOSE: Release management — draft changelogs with reporter attribution.
 *   Phase 2 of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Drafts    — edit + publish draft releases
 *     Published — history of published releases with credit count
 */

import { useState, useCallback, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { usePublishPageContext } from '../lib/pageContext'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  Input,
  EmptyState,
  ErrorAlert,
  RelativeTime,
} from '../components/ui'
import { IconSparkle, IconChevronRight } from '../components/icons'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useActiveProjectSignal } from '../lib/activeProject'

/** List routes return `{ ok, data: T[], meta }`; usePageData exposes `data` as `T[]`. */
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

// ─── Draft release form ───────────────────────────────────────

function DraftForm({ onCreated }: { onCreated: () => void }) {
  const [version, setVersion] = useState('')
  const [title, setTitle] = useState('')
  const [windowDays, setWindowDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const projectId = useActiveProjectSignal() || null

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
  }, [version, title, projectId, windowDays, onCreated])

  return (
    <Card className="mb-6">
      <h3 className="text-sm font-semibold mb-4">New release draft</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
            Report window (days)
          </label>
          <input
            type="number"
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(1, parseInt(e.target.value) || 30))}
            className="w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900"
          />
        </div>
      </div>
      <div className="mt-3">
        <Btn loading={loading} onClick={handleDraft}>
          Generate draft with AI
        </Btn>
        <p className="text-xs text-zinc-400 mt-2">
          Scans fixed reports in the last {windowDays} days, drafts a changelog, and credits reporters by name.
        </p>
      </div>
    </Card>
  )
}

// ─── Release drawer ───────────────────────────────────────────

function ReleaseDrawer({ release, onClose, onPublished }: { release: Release; onClose: () => void; onPublished: () => void }) {
  const [body, setBody] = useState(release.body_md)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const toast = useToast()

  const { data: detailData } = usePageData<{ data: Release }>(
    `/v1/admin/releases/${release.id}`,
  )
  const credits = detailData?.data?.credits ?? []

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/releases/${release.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body_md: body }),
      }) as { ok: boolean; error?: string }
      if (!res.ok) throw new Error(res.error ?? 'Save failed')
      toast.success('Draft saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [release.id, body])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      const res = await apiFetch(`/v1/admin/releases/${release.id}/publish`, { method: 'POST' }) as { ok: boolean; data?: Release; notified?: number; error?: string }
      if (!res.ok) throw new Error(res.error ?? 'Publish failed')
      toast.success(`Published! ${res.notified ?? 0} users will see the attribution toast.`)
      onPublished()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPublishing(false)
    }
  }, [release.id, onPublished, onClose])

  return (
    <Drawer open title={`v${release.version} — ${release.title}`} onClose={onClose} width="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge className={release.status === 'published' ? 'bg-ok-muted/20 text-ok' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'}>
            {release.status}
          </Badge>
          <span className="text-xs text-zinc-400">
            {release.fixed_report_ids.length} reports · {release.credited_reporter_ids.length} contributors
          </span>
        </div>

        {release.status === 'draft' && (
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Changelog (Markdown)
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full h-56 px-3 py-2 text-sm font-mono border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {release.status === 'published' && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase mb-2">Changelog</h3>
            <pre className="text-sm bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg whitespace-pre-wrap border border-zinc-200 dark:border-zinc-700 max-h-56 overflow-y-auto">
              {release.body_md}
            </pre>
          </div>
        )}

        {credits.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase mb-2">
              Reporter credits ({credits.length})
            </h3>
            <div className="space-y-1">
              {credits.map((credit) => (
                <div key={credit.id} className="flex items-center justify-between text-sm p-2 rounded border border-zinc-100 dark:border-zinc-700">
                  <span className="font-medium">
                    {credit.display_name_at_time ?? `User-${credit.end_user_id?.slice(-4) ?? 'anon'}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{credit.contribution_type}</Badge>
                    {credit.notified_at && (
                      <span className="text-xs text-green-600 dark:text-green-400">notified</span>
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
            <Btn loading={publishing} onClick={handlePublish}>
              Publish + notify
            </Btn>
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ─── Releases list ────────────────────────────────────────────

function ReleasesList({ status }: { status: 'draft' | 'published' }) {
  const { data, loading, error, reload } = usePageData<{ data: Release[]; meta: { total: number } }>(
    `/v1/admin/releases?status=${status}&limit=50`,
  )
  const [selected, setSelected] = useState<Release | null>(null)

  const releases = listRows(data)

  if (error) return <ErrorAlert message={error} />
  if (loading) return <TableSkeleton rows={5} />

  if (releases.length === 0) return (
    <EmptyState
      icon={<IconSparkle className="w-8 h-8" />}
      title={status === 'draft' ? 'No draft releases' : 'No published releases'}
      description={
        status === 'draft'
          ? 'Use "Generate draft with AI" above to draft a changelog from recent bug fixes.'
          : 'Publish a draft release to see it here.'
      }
    />
  )

  return (
    <div className="space-y-2">
      {releases.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
          onClick={() => setSelected(r)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold">v{r.version}</span>
              <span className="text-sm text-zinc-500">{r.title}</span>
              <Badge className={r.status === 'published' ? 'bg-ok-muted/20 text-ok' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'}>{r.status}</Badge>
            </div>
            <p className="text-xs text-zinc-400">
              {r.fixed_report_ids.length} fixes · {r.credited_reporter_ids.length} contributors ·
              {r.published_at ? <> published <RelativeTime value={r.published_at} /></> : <> created <RelativeTime value={r.created_at} /></>}
            </p>
          </div>
          <IconChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
        </div>
      ))}

      {selected && (
        <ReleaseDrawer
          release={selected}
          onClose={() => setSelected(null)}
          onPublished={() => reload?.()}
        />
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────

const TABS: Array<{ id: string; label: string; description: string }> = [
  { id: 'drafts',    label: 'Drafts',    description: 'Draft changelogs with AI — edit, attribute reporters, then publish.' },
  { id: 'published', label: 'Published', description: 'Published changelogs with reporter credits and in-app notification stamps.' },
]
type TabId = 'drafts' | 'published'

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v)
}

export function ReleasesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: TabId = isTabId(param) ? param : 'drafts'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]
  const [refreshKey, setRefreshKey] = useState(0)

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
    filters: { tab: activeTab },
  })

  // Animated tab indicator
  const tablistRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabRefs.current.get(activeTab)
      if (!tab) return
      setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth })
    }
    measure()
    const list = tablistRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
  }, [activeTab])

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
        howToUse="Select a date window and click Draft — AI generates the changelog. Review credited contributors, edit if needed, then publish to queue in-app toasts for each reporter."
      />

      {activeTab === 'drafts' && (
        <DraftForm onCreated={() => setRefreshKey((k) => k + 1)} />
      )}

      {/* Animated tab nav */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Releases sections"
        className="relative flex flex-wrap gap-1 border-b border-edge-subtle"
      >
        {TABS.map((t) => {
          const selected = t.id === activeTab
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el)
                else tabRefs.current.delete(t.id)
              }}
              role="tab"
              aria-selected={selected}
              aria-controls={`releases-panel-${t.id}`}
              id={`releases-tab-${t.id}`}
              onClick={() => setTab(t.id as TabId)}
              className={
                'px-3 py-1.5 text-xs font-medium rounded-t-sm motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ' +
                (selected ? 'text-fg' : 'text-fg-muted hover:text-fg')
              }
            >
              {t.label}
            </button>
          )
        })}
        {indicator.width > 0 && (
          <span
            aria-hidden="true"
            className="absolute -bottom-px h-0.5 bg-brand rounded-full motion-safe:transition-[transform,width] motion-safe:duration-200 motion-safe:ease-out"
            style={{ width: `${indicator.width}px`, transform: `translateX(${indicator.left}px)`, left: 0 }}
          />
        )}
      </div>

      <p className="text-2xs text-fg-muted">{activeMeta.description}</p>

      <div
        role="tabpanel"
        id={`releases-panel-${activeTab}`}
        aria-labelledby={`releases-tab-${activeTab}`}
      >
        <ReleasesList key={refreshKey} status={activeTab === 'drafts' ? 'draft' : 'published'} />
      </div>
    </div>
  )
}
