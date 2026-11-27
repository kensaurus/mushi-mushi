/**
 * FILE: apps/admin/src/pages/PersonasPage.tsx
 * PURPOSE: /personas — the persona studio (ADR 0073, Plan 025 P3). Who a
 *          first-time user test plays: a name, what they came to do, the
 *          language they read, the device they hold, how much they know, what
 *          they need to use an app, how patient they are and what one test may
 *          spend. Start from a preset, change it with a live preview of what the
 *          visitor model will read, and see each persona's tests as a sparkline.
 *          The app's test-account setting (may a test sign up?) lives here too.
 *
 * Data: GET /v1/admin/projects/:pid/personas
 * Writes: POST/PATCH/DELETE …/personas[/:id], PUT …/test-accounts
 * Live: Realtime on ux_runs, so a test that ends updates its persona's history.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { Btn, Callout, EmptyState, Loading } from '../components/ui'
import { formatRelative } from '../components/ui/metrics'
import { PageStatus, toMetrics } from '../components/ui/page-status'
import { PersonaCard } from '../components/personas/PersonaCard'
import { PersonaEditor } from '../components/personas/PersonaEditor'
import { PresetGallery } from '../components/personas/PresetGallery'
import { TestAccountsCard } from '../components/personas/TestAccountsCard'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { apiFetchMutate } from '../lib/supabase'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { budgetLine, type Persona, type PersonaFields, type PersonaPresetId, type PersonasData } from '../lib/personas'

export function PersonasPage() {
  const projectId = useActiveProjectId()
  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="Personas"
        helpTitle="What is a persona?"
        helpWhatIsIt="A persona is a kind of person your first-time user test plays: someone on a phone who reads Japanese, a screen-reader user, someone who leaves after a few taps. Each one sets the browser the visitor gets (screen size, zoom, language), how it moves (mouse, touch, keyboard only), how patient it is and the most one test may spend on AI. The short text the visitor model reads is shown as you edit."
        helpHowToUse="Add a preset, or make your own with New persona. Change anything; the preview on the right shows what the visitor will try and the exact words the model reads. Press Test with this persona to open the first-time user test with it picked. Each card shows how its tests went over time. Turn on test accounts at the bottom when a test should get past your sign-up page."
        helpFlowPath="/personas"
      />
      {projectId ? (
        <PersonaStudio key={projectId} projectId={projectId} />
      ) : (
        <EmptyState title="No project selected" description="Switch to a project at the top to see its personas." />
      )}
    </div>
  )
}

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null

/** A blank persona to start from: the first-time visitor preset's settings, without its name. */
function blankStart(data: PersonasData): PersonaFields {
  const base = data.presets.find((p) => p.id === 'first_time')
  return {
    name: '',
    preset: null,
    goal: null,
    locale: base?.locale ?? 'en-US',
    device: base?.device ?? 'desktop',
    expertise: base?.expertise ?? 'new',
    accessibility: [],
    patienceSteps: base?.patienceSteps ?? 30,
    costCapUsd: base?.costCapUsd ?? 1,
    notes: null,
  }
}

function PersonaStudio({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/personas`
  const q = usePageData<PersonasData>(path)
  useRealtimeReload([{ table: 'ux_runs', filter: `project_id=eq.${projectId}` }], () => q.reload())

  const [editing, setEditing] = useState<Editing>(null)
  const [adding, setAdding] = useState<PersonaPresetId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Persona | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Bring the editor into view when it opens (it sits above the cards).
  useEffect(() => {
    if (!editing) return
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    editorRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [editing])

  // A failed refresh keeps what is on screen (a signing secret shown once must not vanish with it).
  if (q.error && !q.data) return <PageLoadError error={q.error} code={q.errorCode} resource="personas" endpoint={path} requestId={q.requestId} onRetry={q.reload} />
  if (q.loading && !q.data) return <Loading text="Loading personas…" />
  const data = q.data
  if (!data) return null

  const personas = data.personas
  const atLimit = personas.length >= data.limit
  const canAdd = data.canEdit && !atLimit
  const usedPresets = new Set(personas.map((p) => p.preset).filter(Boolean))
  const unusedPresets = data.presets.filter((p) => !usedPresets.has(p.id))
  const lastRunAt = personas
    .flatMap((p) => (p.runs ?? []).map((r) => r.started_at))
    .sort()
    .at(-1)
  const editingPersona = editing?.kind === 'edit' ? personas.find((p) => p.id === editing.id) : undefined
  // A persona deleted elsewhere while open closes its editor instead of turning it into a new one.
  const showEditor = editing != null && (editing.kind === 'new' || editingPersona != null)

  async function addPreset(id: PersonaPresetId) {
    setAdding(id)
    setActionError(null)
    setNotice(null)
    const res = await apiFetchMutate<{ persona: Persona }>(path, { method: 'POST', body: JSON.stringify({ preset: id }) })
    setAdding(null)
    if (!res.ok) {
      setActionError(res.error?.message ?? 'The persona was not added. Try again in a minute.')
      return
    }
    setNotice(`Added ${res.data?.persona.name ?? 'the persona'}. Change it with Edit, or test with it now.`)
    q.reload()
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setActionError(null)
    const res = await apiFetchMutate<{ id: string; archived: boolean }>(`${path}/${deleting.id}`, { method: 'DELETE' })
    setDeleteBusy(false)
    if (!res.ok) {
      setActionError(res.error?.message ?? 'It was not deleted. Try again in a minute.')
      setDeleting(null)
      return
    }
    setNotice(`Deleted ${deleting.name}. Its past tests keep it.`)
    if (editing?.kind === 'edit' && editing.id === deleting.id) setEditing(null)
    setDeleting(null)
    q.reload()
  }

  const n = personas.length
  const sentence =
    n === 0
      ? 'No personas yet. Every test plays a plain first-time visitor until you add one.'
      : `${n} persona${n === 1 ? '' : 's'}. ${lastRunAt ? `Last test ${formatRelative(lastRunAt)}.` : 'None has been tested yet.'}`

  return (
    <>
      <PagePosture
        slots={[
          {
            id: 'status',
            priority: POSTURE_PRIORITY.status,
            children: (
              <PageStatus
                ariaLabel="Personas status"
                tone={n === 0 ? 'neutral' : 'info'}
                data-testid="personas-status"
                sentence={
                  <span className="flex flex-col gap-0.5">
                    <span>{sentence}</span>
                    <span className="text-xs text-fg-secondary" data-testid="personas-budget">
                      {budgetLine(data.budget)}
                    </span>
                  </span>
                }
                metrics={toMetrics([
                  { label: 'Personas', value: `${n} of ${data.limit}`, tone: atLimit ? 'warn' : 'neutral' },
                  { label: 'Last test', value: lastRunAt ? formatRelative(lastRunAt) : 'None yet' },
                ])}
                action={
                  data.canEdit && n > 0 ? (
                    <Btn size="sm" onClick={() => setEditing({ kind: 'new' })} disabled={atLimit || editing?.kind === 'new'}>
                      New persona
                    </Btn>
                  ) : undefined
                }
              />
            ),
          },
        ]}
      />

      {q.error && <PageLoadError error={q.error} code={q.errorCode} resource="personas" endpoint={path} requestId={q.requestId} onRetry={q.reload} />}

      <p className="text-2xs text-fg-muted">
        Pick one when you start a{' '}
        <Link className="text-brand underline underline-offset-2" to="/first-user-test">
          first-time user test
        </Link>
        ; the test plays that visitor.
      </p>

      {!data.canEdit && (
        <Callout tone="neutral">
          <p className="text-xs text-fg-secondary">You can see this app’s personas. Viewers cannot add, change or delete them.</p>
        </Callout>
      )}
      {atLimit && data.canEdit && <p className="text-2xs text-fg-secondary">This app keeps at most {data.limit} personas. Delete one to add another.</p>}
      {notice && !actionError && (
        <p role="status" className="text-xs text-fg-secondary">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-xs text-danger">
          {actionError}
        </p>
      )}

      {editing && showEditor && (
        <div ref={editorRef} className="scroll-mt-4">
          <PersonaEditor
            key={editing.kind === 'edit' ? editing.id : 'new'}
            projectId={projectId}
            start={editingPersona ?? blankStart(data)}
            persona={editingPersona}
            onCancel={() => setEditing(null)}
            onSaved={(name) => {
              setEditing(null)
              setActionError(null)
              setNotice(`Saved ${name}.`)
              q.reload()
            }}
          />
        </div>
      )}

      {n === 0 ? (
        <section aria-labelledby="persona-presets" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="persona-presets" className="text-sm font-semibold text-fg">
              Start from a preset
            </h2>
            {data.canEdit && (
              <Btn size="sm" variant="ghost" onClick={() => setEditing({ kind: 'new' })} disabled={editing?.kind === 'new'}>
                Or make your own
              </Btn>
            )}
          </div>
          <p className="max-w-prose text-xs text-fg-secondary">
            {data.canEdit ? 'Each is a person your app should work for. Add one, then change anything about it.' : 'Each is a person your app should work for. Anyone on the team who is not a viewer can add them.'}
          </p>
          <PresetGallery presets={data.presets} canAdd={canAdd} adding={adding} onAdd={(id) => void addPreset(id)} />
        </section>
      ) : (
        <section aria-labelledby="persona-list" className="flex flex-col gap-2">
          <h2 id="persona-list" className="text-sm font-semibold text-fg">
            Your personas
          </h2>
          <div className="@container/personas">
            <ul className="grid gap-3 @2xl/personas:grid-cols-2 @5xl/personas:grid-cols-3" data-testid="persona-grid">
              {personas.map((p) => (
                <li key={p.id} className="min-w-0">
                  <PersonaCard
                    persona={p}
                    canEdit={data.canEdit}
                    editing={editing?.kind === 'edit' && editing.id === p.id}
                    onEdit={() => {
                      setNotice(null)
                      setEditing({ kind: 'edit', id: p.id })
                    }}
                    onDelete={() => setDeleting(p)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {n > 0 && canAdd && unusedPresets.length > 0 && (
        <section aria-labelledby="persona-more-presets" className="flex flex-col gap-2">
          <h2 id="persona-more-presets" className="text-sm font-semibold text-fg">
            Add from a preset
          </h2>
          <PresetGallery presets={unusedPresets} canAdd={canAdd} adding={adding} onAdd={(id) => void addPreset(id)} />
        </section>
      )}

      <TestAccountsCard projectId={projectId} setting={data.testAccounts} onSaved={q.reload} />

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="Past tests keep it and still show who they played. It leaves this page and the persona picker of the first-time user test."
          confirmLabel="Delete"
          tone="danger"
          loading={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
