import { useEffect, useMemo, useState } from 'react'
import { Btn, Badge, ErrorAlert } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'

/**
 * ProposalReviewModal — beautified, tabbed review surface for an
 * LLM-drafted inventory proposal.
 *
 * Why the rewrite (vs the previous YAML-textarea split-pane):
 *
 *   1. **Stories first, YAML last.** The user's mental model of an
 *      inventory is "what user stories does my app support?", not
 *      "what does the YAML look like?". The new modal opens on a
 *      Stories tab with rich story cards; YAML is a second tab for
 *      power-users who want to hand-edit before accept.
 *
 *   2. **Header strip with diff metrics.** Story count / page count
 *      / action count are surfaced in the header so the reviewer can
 *      decide "yes this looks like my app" at a glance, not by
 *      counting YAML stanzas.
 *
 *   3. **Per-story expand.** Each story card collapses by default
 *      and expands to show the goal, persona, pages it touches, the
 *      individual element actions (with element type), and Claude's
 *      one-line rationale.
 */

// ---------- types --------------------------------------------------

interface ProposalDetail {
  id: string
  status: 'draft' | 'accepted' | 'discarded'
  llm_model: string
  observation_count: number
  inventory_id: string | null
  created_at: string
  decided_at: string | null
  decided_by: string | null
  proposed_yaml: string
  proposed_parsed: ProposedInventory
  rationale_by_story: Record<string, string>
}

interface ProposedInventory {
  schema_version?: string
  app?: { id?: string; name?: string; base_url?: string }
  user_stories?: ProposedStory[]
  pages?: ProposedPage[]
}

interface ProposedStory {
  id: string
  title?: string
  persona?: string
  goal?: string
  description?: string
  pages?: string[]
  tags?: string[]
}

interface ProposedPage {
  id: string
  path: string
  title?: string
  user_story?: string
  elements?: ProposedElement[]
}

interface ProposedElement {
  id: string
  type?: string
  action?: string
  testid?: string
  user_story?: string
  backend?: Array<{ method?: string; path?: string }>
  verified_by?: Array<{ file?: string; name?: string }>
  crud?: string
}

interface Props {
  projectId: string
  proposalId: string
  onClose: () => void
  onAccepted: () => void
  onDiscarded: () => void
}

type ModalTab = 'stories' | 'yaml' | 'rationale'

// ---------- main component -----------------------------------------

export function ProposalReviewModal({
  projectId,
  proposalId,
  onClose,
  onAccepted,
  onDiscarded,
}: Props) {
  const toast = useToast()
  const path = `/v1/admin/inventory/${projectId}/proposals/${proposalId}`
  const q = usePageData<ProposalDetail>(path, { deps: [projectId, proposalId] })

  const [tab, setTab] = useState<ModalTab>('stories')
  const [editedYaml, setEditedYaml] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'accept' | 'discard' | null>(null)
  const [validationIssues, setValidationIssues] = useState<unknown[] | null>(null)

  // Lock body scroll while open + escape-to-close.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const yaml = editedYaml ?? q.data?.proposed_yaml ?? ''
  const isDraft = q.data?.status === 'draft'
  const parsed = q.data?.proposed_parsed
  const stories: ProposedStory[] = parsed?.user_stories ?? []
  const pages: ProposedPage[] = parsed?.pages ?? []

  const summary = useMemo(() => summarise(stories, pages), [stories, pages])

  const save = async () => {
    if (!editedYaml) return
    setBusy('save')
    setValidationIssues(null)
    const res = await apiFetch(path, { method: 'PATCH', body: JSON.stringify({ yaml: editedYaml }) })
    setBusy(null)
    if (res.ok) {
      toast.success('Saved')
      setEditedYaml(null)
      q.reload()
    } else if (res.error?.code === 'VALIDATION_FAILED') {
      const issues = (res.error as { issues?: unknown[] }).issues ?? []
      setValidationIssues(issues)
    } else {
      toast.push({ tone: 'error', message: 'Save failed', description: res.error?.message ?? '' })
    }
  }

  const accept = async () => {
    setBusy('accept')
    setValidationIssues(null)
    const res = await apiFetch(`${path}/accept`, { method: 'POST', body: '{}' })
    setBusy(null)
    if (res.ok) {
      toast.success('Inventory accepted', 'It is now your active inventory.')
      onAccepted()
    } else if (res.error?.code === 'VALIDATION_FAILED') {
      const issues = (res.error as { issues?: unknown[] }).issues ?? []
      setValidationIssues(issues)
    } else {
      toast.push({ tone: 'error', message: 'Accept failed', description: res.error?.message ?? '' })
    }
  }

  const discard = async () => {
    setBusy('discard')
    const res = await apiFetch(`${path}/discard`, { method: 'POST', body: '{}' })
    setBusy(null)
    if (res.ok) {
      toast.success('Discarded')
      onDiscarded()
    } else {
      toast.push({ tone: 'error', message: 'Discard failed', description: res.error?.message ?? '' })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 sm:p-6 motion-safe:animate-mushi-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-review-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-6xl max-h-[min(92dvh,52rem)] flex flex-col rounded-xl bg-surface-raised shadow-raised border border-edge overflow-hidden motion-safe:animate-mushi-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-edge-subtle bg-surface-overlay/30">
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wider text-fg-faint">
              Inventory proposal · {q.data?.status ?? '—'}
            </p>
            <h2
              id="proposal-review-title"
              className="text-base font-semibold text-fg truncate"
            >
              {parsed?.app?.name ?? 'Draft inventory'}
            </h2>
            <p className="text-2xs text-fg-faint mt-0.5">
              {q.data?.llm_model ?? '—'} · {q.data?.observation_count ?? 0} observation{q.data?.observation_count === 1 ? '' : 's'} ·{' '}
              {q.data ? new Date(q.data.created_at).toLocaleString() : '—'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isDraft && (
              <>
                <Btn type="button" size="sm" variant="ghost" onClick={discard} disabled={busy != null}>
                  Discard
                </Btn>
                <Btn type="button" size="sm" variant="ghost" onClick={save} disabled={!editedYaml || busy != null}>
                  {busy === 'save' ? 'Saving…' : 'Save edits'}
                </Btn>
                <Btn
                  type="button"
                  size="sm"
                  onClick={accept}
                  disabled={busy != null}
                  data-testid="mushi-proposal-accept"
                >
                  {busy === 'accept' ? 'Accepting…' : 'Accept & ingest'}
                </Btn>
              </>
            )}
            <Btn type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close proposal">
              ×
            </Btn>
          </div>
        </header>

        {/* Summary strip — three big numbers so the reviewer can decide
            "this looks like my app" at a squint */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4 py-3 border-b border-edge-subtle bg-surface-raised">
          <SummaryStat label="Stories" value={summary.storyCount} tone="brand" />
          <SummaryStat label="Pages" value={summary.pageCount} tone="info" />
          <SummaryStat label="Actions" value={summary.actionCount} tone="info" />
          <SummaryStat
            label="Untested"
            value={summary.untestedActionCount}
            tone={summary.untestedActionCount === 0 ? 'ok' : 'warn'}
            detail={
              summary.actionCount > 0
                ? `${Math.round((summary.untestedActionCount / summary.actionCount) * 100)}%`
                : undefined
            }
          />
          <SummaryStat
            label="Backend ops"
            value={summary.backendCallCount}
            tone="neutral"
          />
        </div>

        {/* Tabs */}
        <div className="px-4 border-b border-edge-subtle bg-surface-raised flex gap-0">
          <TabButton active={tab === 'stories'} onClick={() => setTab('stories')}>
            Stories <span className="ml-1.5 text-fg-faint tabular-nums">{summary.storyCount}</span>
          </TabButton>
          <TabButton active={tab === 'rationale'} onClick={() => setTab('rationale')}>
            Why these stories
          </TabButton>
          <TabButton active={tab === 'yaml'} onClick={() => setTab('yaml')}>
            YAML <span className="ml-1.5 text-fg-faint">{isDraft ? 'editable' : 'read-only'}</span>
          </TabButton>
        </div>

        {/* Validation banner */}
        {validationIssues && (
          <div className="px-4 py-2 border-b border-edge-subtle bg-danger-muted/40">
            <p className="text-xs font-semibold text-danger">YAML rejected by validator</p>
            <ul className="mt-1 text-2xs text-danger space-y-0.5 max-h-32 overflow-auto">
              {(validationIssues as Array<{ path?: string; message?: string }>).slice(0, 12).map((i, idx) => (
                <li key={idx}>
                  <span className="font-mono">{i.path ?? ''}</span> · {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Body */}
        <div className="grow overflow-hidden">
          {q.error && <ErrorAlert message={q.error} onRetry={q.reload} />}
          {tab === 'stories' && (
            <StoriesTab
              stories={stories}
              pages={pages}
              rationale={q.data?.rationale_by_story ?? {}}
            />
          )}
          {tab === 'rationale' && <RationaleTab stories={stories} rationale={q.data?.rationale_by_story ?? {}} />}
          {tab === 'yaml' && (
            <YamlEditorTab
              yaml={yaml}
              editable={isDraft}
              onChange={(next) => isDraft && setEditedYaml(next)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- summary helpers -----------------------------------------

function summarise(stories: ProposedStory[], pages: ProposedPage[]) {
  let actionCount = 0
  let untestedActionCount = 0
  let backendCallCount = 0
  for (const p of pages) {
    for (const el of p.elements ?? []) {
      actionCount++
      if (!el.verified_by || el.verified_by.length === 0) untestedActionCount++
      backendCallCount += el.backend?.length ?? 0
    }
  }
  return {
    storyCount: stories.length,
    pageCount: pages.length,
    actionCount,
    untestedActionCount,
    backendCallCount,
  }
}

// ---------- header + tabs primitives --------------------------------

function SummaryStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: number
  detail?: string
  tone: 'brand' | 'info' | 'ok' | 'warn' | 'neutral'
}) {
  const colors: Record<typeof tone, { value: string; label: string }> = {
    brand: { value: 'text-brand', label: 'text-fg-faint' },
    info: { value: 'text-info', label: 'text-fg-faint' },
    ok: { value: 'text-ok', label: 'text-fg-faint' },
    warn: { value: 'text-warn', label: 'text-fg-faint' },
    neutral: { value: 'text-fg', label: 'text-fg-faint' },
  }
  const c = colors[tone]
  return (
    <div className="flex flex-col items-start">
      <p className={`text-2xs uppercase tracking-wider ${c.label}`}>{label}</p>
      <p className={`text-xl font-semibold tabular-nums leading-none ${c.value}`}>{value}</p>
      {detail && <p className={`text-2xs mt-0.5 ${c.label}`}>{detail}</p>}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  // Active state uses underline + color shift, not a full pill background,
  // to avoid the H1 active-state mass mismatch.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative px-3 py-2 text-xs font-medium transition-colors ${
        active ? 'text-fg' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {children}
      <span
        aria-hidden
        className={`absolute left-2 right-2 -bottom-px h-0.5 rounded-full transition-colors ${
          active ? 'bg-brand' : 'bg-transparent'
        }`}
      />
    </button>
  )
}

// ---------- Stories tab ---------------------------------------------

function StoriesTab({
  stories,
  pages,
  rationale,
}: {
  stories: ProposedStory[]
  pages: ProposedPage[]
  rationale: Record<string, string>
}) {
  if (stories.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-fg-muted">No stories in this proposal.</p>
        <p className="text-2xs text-fg-faint mt-1">
          Switch to the YAML tab to see the raw output.
        </p>
      </div>
    )
  }
  // Map page id → page so each story card can render its pages inline.
  const pageMap = new Map<string, ProposedPage>()
  for (const p of pages) pageMap.set(p.id, p)

  // Find pages NOT linked to any story so we can surface them.
  const linkedPageIds = new Set<string>()
  for (const s of stories) for (const pid of s.pages ?? []) linkedPageIds.add(pid)
  const orphanPages = pages.filter((p) => !linkedPageIds.has(p.id))

  return (
    <div className="overflow-auto h-full">
      <div className="p-4 space-y-3">
        {stories.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            pages={(story.pages ?? []).map((id) => pageMap.get(id)).filter(Boolean) as ProposedPage[]}
            rationale={rationale[story.id]}
          />
        ))}
        {orphanPages.length > 0 && (
          <details className="rounded-md border border-edge-subtle bg-warn-muted/10 p-3">
            <summary className="cursor-pointer text-xs font-medium text-warn select-none">
              {orphanPages.length} page{orphanPages.length === 1 ? '' : 's'} not linked to any story
              <span className="ml-2 text-fg-faint font-normal">
                (Claude saw these but didn't assign them)
              </span>
            </summary>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {orphanPages.map((p) => (
                <li
                  key={p.id}
                  className="text-2xs px-2 py-1 rounded bg-surface-overlay/60 border border-edge-subtle"
                >
                  <code className="font-mono text-fg">{p.path}</code>
                  {p.title && <span className="ml-2 text-fg-muted">{p.title}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function StoryCard({
  story,
  pages,
  rationale,
}: {
  story: ProposedStory
  pages: ProposedPage[]
  rationale?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const totalActions = pages.reduce((sum, p) => sum + (p.elements?.length ?? 0), 0)
  const untested = pages.reduce(
    (sum, p) => sum + (p.elements ?? []).filter((e) => !e.verified_by?.length).length,
    0,
  )
  const personaInitial = (story.persona ?? story.id).trim().charAt(0).toUpperCase()

  return (
    <article className="rounded-lg border border-edge-subtle bg-surface-overlay/40 hover:bg-surface-overlay transition-colors">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-3 flex items-start gap-3"
        aria-expanded={expanded}
      >
        <div
          aria-hidden
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-brand/15 text-brand text-sm font-semibold ring-1 ring-brand/30"
        >
          {personaInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-fg truncate">{story.title ?? story.id}</h3>
            {story.persona && (
              <span className="text-2xs text-fg-muted">as a {story.persona}</span>
            )}
          </div>
          {story.goal && <p className="text-2xs text-fg-muted mt-0.5">{story.goal}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-2xs text-fg-faint tabular-nums">
            <span>
              <span className="text-fg font-medium">{pages.length}</span>
              {pages.length === 1 ? ' page' : ' pages'}
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="text-fg font-medium">{totalActions}</span>
              {totalActions === 1 ? ' action' : ' actions'}
            </span>
            {totalActions > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className={untested === 0 ? 'text-ok' : 'text-warn'}>
                  {untested === 0 ? 'all tested' : `${untested} untested`}
                </span>
              </>
            )}
          </div>
        </div>
        <Chevron expanded={expanded} />
      </button>
      {expanded && (
        <div className="border-t border-edge-subtle p-3 space-y-3">
          {story.description && (
            <p className="text-2xs text-fg-muted">{story.description}</p>
          )}
          {story.tags && story.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {story.tags.map((t) => (
                <Badge key={t} className="bg-surface-overlay/70 text-fg-secondary border border-edge-subtle">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {pages.length > 0 && (
            <div className="space-y-2">
              <p className="text-2xs uppercase tracking-wider text-fg-faint">Pages & actions</p>
              {pages.map((p) => (
                <PageBlock key={p.id} page={p} />
              ))}
            </div>
          )}
          {rationale && (
            <div className="rounded-md bg-info-muted/15 ring-1 ring-info/20 p-2">
              <p className="text-2xs uppercase tracking-wider text-info mb-0.5">Why this story</p>
              <p className="text-2xs text-fg italic">{rationale}</p>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function PageBlock({ page }: { page: ProposedPage }) {
  const elements = page.elements ?? []
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised">
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b border-edge-subtle">
        <code className="text-2xs font-mono text-fg">{page.path}</code>
        {page.title && <span className="text-2xs text-fg-muted truncate">{page.title}</span>}
        <span className="ml-auto text-2xs text-fg-faint tabular-nums">
          {elements.length} {elements.length === 1 ? 'action' : 'actions'}
        </span>
      </div>
      {elements.length > 0 ? (
        <ul className="divide-y divide-edge-subtle">
          {elements.map((el) => (
            <li key={el.id} className="px-2.5 py-1.5 flex items-center gap-2 text-2xs">
              <span className="px-1.5 py-0.5 rounded bg-surface-overlay text-fg-faint font-mono uppercase tracking-wider">
                {(el.type ?? 'el').slice(0, 3)}
              </span>
              <span className="text-fg truncate min-w-0 flex-1">{el.action ?? el.id}</span>
              {el.testid && (
                <code className="hidden sm:inline px-1 py-0.5 rounded bg-info-muted/15 text-info text-[10px] font-mono">
                  {el.testid}
                </code>
              )}
              {el.backend && el.backend.length > 0 && (
                <span className="hidden sm:inline text-ok text-[10px]" title={el.backend.map((b) => `${b.method} ${b.path}`).join('\n')}>
                  {el.backend.length} API
                </span>
              )}
              {(!el.verified_by || el.verified_by.length === 0) ? (
                <span className="text-warn text-[10px]" title="No verified_by tests linked">untested</span>
              ) : (
                <span className="text-ok text-[10px]" title={el.verified_by.map((t) => `${t.file}::${t.name}`).join('\n')}>
                  {el.verified_by.length}✓
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2.5 py-1.5 text-2xs text-fg-faint italic">No interactive elements drafted yet.</p>
      )}
    </div>
  )
}

// ---------- Rationale tab -------------------------------------------

function RationaleTab({
  stories,
  rationale,
}: {
  stories: ProposedStory[]
  rationale: Record<string, string>
}) {
  if (stories.length === 0) {
    return <div className="p-8 text-center text-sm text-fg-muted">No stories in this proposal.</div>
  }
  return (
    <div className="overflow-auto h-full">
      <div className="p-4 space-y-2">
        <p className="text-2xs text-fg-muted">
          For each user story Claude drafted, here's the one-line reasoning grounded in what the SDK observed.
        </p>
        {stories.map((s) => (
          <div
            key={s.id}
            className="rounded-md border border-edge-subtle bg-surface-overlay/40 p-3 space-y-1"
          >
            <p className="text-xs font-medium text-fg">{s.title ?? s.id}</p>
            <p className="text-2xs text-fg-muted italic">
              {rationale[s.id] ?? <span className="text-fg-faint">No rationale provided.</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- YAML tab ------------------------------------------------

function YamlEditorTab({
  yaml,
  editable,
  onChange,
}: {
  yaml: string
  editable: boolean
  onChange: (next: string) => void
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-1.5 text-2xs text-fg-muted bg-surface-overlay/40 border-b border-edge-subtle flex items-center gap-2">
        <span className="text-fg-faint">{editable ? '✎ editable' : '◉ read-only'}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{yaml.split('\n').length} lines</span>
      </div>
      <textarea
        className="grow w-full p-3 font-mono text-2xs bg-surface-raised text-fg outline-none resize-none focus:ring-0"
        value={yaml}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!editable}
        spellCheck={false}
        data-testid="mushi-proposal-yaml"
      />
    </div>
  )
}

// ---------- chevron -------------------------------------------------

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      className={`shrink-0 mt-2 text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
    >
      <path
        d="M3.5 5.5L7 9L10.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
