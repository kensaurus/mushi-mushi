/**
 * FILE: apps/admin/src/components/repo/ProjectReposCard.tsx
 * PURPOSE: Multi-repo management card for the Repo page.
 *          Lists all project_repos rows, lets users add/edit/remove repos,
 *          and displays repo role + path_globs + GitHub App status.
 *
 *          Data: GET /v1/admin/repo/repos?project_id=...
 *          Mutations: POST / PUT / DELETE /v1/admin/repo/repos
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Badge, Btn, Card, CodeValue, ErrorAlert, RelativeTime } from '../ui'
import { ContainedBlock, SignalChip, ActionPill, ActionPillRow } from '../report-detail/ReportSurface'
import { IconGit } from '../icons'
import { CHIP_TONE } from '../../lib/chipTone'

interface ProjectRepo {
  id: string
  repo_url: string
  default_branch: string | null
  github_app_installation_id: string | null
  indexing_enabled: boolean | null
  last_indexed_at: string | null
  role: string
  path_globs: string[] | null
  is_primary: boolean
  created_at: string
  updated_at: string | null
}

const ROLES = ['frontend', 'backend', 'monorepo', 'mobile', 'ai', 'infra', 'docs', 'other'] as const
type RepoRole = (typeof ROLES)[number]

const ROLE_BADGE_CLASS: Record<string, string> = {
  frontend: 'bg-brand/12 text-brand border border-brand/28',
  backend:  'bg-ok-muted/50 text-ok-foreground border border-ok/25',
  monorepo: 'bg-info-muted/50 text-info-foreground border border-info/25',
  mobile:   CHIP_TONE.accentSubtle,
}

interface Props {
  projectId: string
}

export function ProjectReposCard({ projectId }: Props) {
  const [repos, setRepos] = useState<ProjectRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const blankDraft = () => ({
    repoUrl: '',
    role: 'monorepo' as RepoRole,
    pathGlobs: '',
    defaultBranch: 'main',
    isPrimary: repos.length === 0,
  })

  const [draft, setDraft] = useState(blankDraft)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    const res = await apiFetch<ProjectRepo[]>(
      `/v1/admin/repo/repos?project_id=${projectId}`,
      { cache: 'no-store' },
    )
    setLoading(false)
    if (res.ok && res.data) {
      setRepos(res.data)
      setError(null)
    } else {
      setError(String(res.error?.message ?? 'Failed to load repos'))
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const openAdd = () => {
    setDraft(blankDraft())
    setAdding(true)
    setEditingId(null)
  }

  const openEdit = (repo: ProjectRepo) => {
    setDraft({
      repoUrl: repo.repo_url,
      role: repo.role as RepoRole,
      pathGlobs: (repo.path_globs ?? []).join(', '),
      defaultBranch: repo.default_branch ?? 'main',
      isPrimary: repo.is_primary,
    })
    setEditingId(repo.id)
    setAdding(false)
  }

  const cancelForm = () => { setAdding(false); setEditingId(null) }

  const buildPayload = () => ({
    projectId,
    repoUrl: draft.repoUrl,
    role: draft.role,
    pathGlobs: draft.pathGlobs
      ? draft.pathGlobs.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    defaultBranch: draft.defaultBranch || 'main',
    isPrimary: draft.isPrimary,
  })

  const saveAdd = async () => {
    setSaving(true)
    const res = await apiFetch('/v1/admin/repo/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    })
    setSaving(false)
    if (res.ok) { setAdding(false); void load() }
    else setError(String(res.error ?? 'Save failed'))
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    const res = await apiFetch(`/v1/admin/repo/repos/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    })
    setSaving(false)
    if (res.ok) { setEditingId(null); void load() }
    else setError(String(res.error ?? 'Save failed'))
  }

  const removeRepo = async (repoId: string) => {
    if (!window.confirm('Remove this repo? Fix PRs already opened on it will not be affected.')) return
    const res = await apiFetch(
      `/v1/admin/repo/repos/${repoId}?project_id=${projectId}`,
      { method: 'DELETE' },
    )
    if (res.ok) void load()
    else setError(String(res.error ?? 'Delete failed'))
  }

  if (loading) {
    return <Card className="p-3"><p className="text-2xs text-fg-faint">Loading repos…</p></Card>
  }
  if (error) {
    return <ErrorAlert message={error} onRetry={load} />
  }

  const showForm = adding || Boolean(editingId)

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
          <IconGit />
          Linked repos ({repos.length})
        </h3>
        {!showForm && (
          <Btn size="sm" variant="ghost" onClick={openAdd}>+ Add repo</Btn>
        )}
      </div>

      {repos.length === 0 && !showForm && (
        <p className="text-2xs text-fg-faint italic">
          No repos linked yet — add your primary repo to enable auto-fix PRs.
        </p>
      )}

      <div className="space-y-2">
        {repos.map((repo) => (
          <div key={repo.id} className="border border-edge-subtle rounded-md p-2.5 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {repo.is_primary && (
                  <Badge className="text-3xs bg-brand/12 text-brand border border-brand/28">primary</Badge>
                )}
                <Badge className={`text-3xs border ${ROLE_BADGE_CLASS[repo.role] ?? 'border-edge-subtle text-fg-muted'}`}>
                  {repo.role}
                </Badge>
                <div className="min-w-0 flex-1">
                  <CodeValue value={repo.repo_url} tone="url" />
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {repo.github_app_installation_id ? (
                  <SignalChip tone="ok">App installed</SignalChip>
                ) : (
                  <SignalChip tone="warn">No GitHub App</SignalChip>
                )}
                {editingId !== repo.id && (
                  <>
                    <Btn size="sm" variant="ghost" onClick={() => openEdit(repo)}>Edit</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => void removeRepo(repo.id)}>Remove</Btn>
                  </>
                )}
              </div>
            </div>
            {repo.path_globs && repo.path_globs.length > 0 && (
              <p className="text-2xs text-fg-faint font-mono">globs: {repo.path_globs.join(', ')}</p>
            )}
            {repo.last_indexed_at && (
              <p className="text-2xs text-fg-faint">
                Indexed <RelativeTime value={repo.last_indexed_at} />
              </p>
            )}

            {editingId === repo.id && (
              <RepoForm
                draft={draft}
                onChange={setDraft}
                onSave={() => void saveEdit()}
                onCancel={cancelForm}
                saving={saving}
                isEdit
              />
            )}
          </div>
        ))}
      </div>

      {adding && (
        <ContainedBlock tone="muted" label="Add repo">
          <RepoForm
            draft={draft}
            onChange={setDraft}
            onSave={() => void saveAdd()}
            onCancel={cancelForm}
            saving={saving}
          />
        </ContainedBlock>
      )}

      {repos.length > 0 && !showForm && (
        <p className="text-2xs text-fg-faint leading-relaxed">
          <strong>Multi-repo tip:</strong> add a backend repo to fan out fix PRs across all
          codebases in one dispatch. Set <code>path_globs</code> (e.g.{' '}
          <code>src/**,api/**</code>) so the fix worker targets the right files.
        </p>
      )}
    </Card>
  )
}

interface FormDraft {
  repoUrl: string
  role: RepoRole
  pathGlobs: string
  defaultBranch: string
  isPrimary: boolean
}

function RepoForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  isEdit = false,
}: {
  draft: FormDraft
  onChange: (d: FormDraft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isEdit?: boolean
}) {
  const set = <K extends keyof FormDraft>(k: K, v: FormDraft[K]) => onChange({ ...draft, [k]: v })

  return (
    <div className="space-y-2 pt-2">
      <div>
        <label className="block text-2xs font-medium text-fg-muted mb-0.5">Repo URL *</label>
        <input
          type="url"
          value={draft.repoUrl}
          onChange={(e) => set('repoUrl', e.target.value)}
          placeholder="https://github.com/org/repo"
          className="w-full rounded-sm border border-edge bg-surface-raised text-xs px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-2xs font-medium text-fg-muted mb-0.5">Role</label>
          <select
            value={draft.role}
            onChange={(e) => set('role', e.target.value as RepoRole)}
            className="w-full rounded-sm border border-edge bg-surface-raised text-xs px-2 py-1"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-2xs font-medium text-fg-muted mb-0.5">Default branch</label>
          <input
            type="text"
            value={draft.defaultBranch}
            onChange={(e) => set('defaultBranch', e.target.value)}
            placeholder="main"
            className="w-full rounded-sm border border-edge bg-surface-raised text-xs px-2 py-1"
          />
        </div>
      </div>
      <div>
        <label className="block text-2xs font-medium text-fg-muted mb-0.5">
          Path globs (comma-separated)
        </label>
        <input
          type="text"
          value={draft.pathGlobs}
          onChange={(e) => set('pathGlobs', e.target.value)}
          placeholder="src/**, api/**"
          className="w-full rounded-sm border border-edge bg-surface-raised text-xs px-2 py-1"
        />
        <p className="text-3xs text-fg-faint mt-0.5">Leave blank to match all files.</p>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.isPrimary}
          onChange={(e) => set('isPrimary', e.target.checked)}
          className="accent-brand"
        />
        <span className="text-2xs text-fg-secondary">Mark as primary repo (fix worker defaults here)</span>
      </label>
      <ActionPillRow>
        <Btn
          size="sm"
          variant="primary"
          onClick={onSave}
          loading={saving}
          disabled={!draft.repoUrl || saving}
        >
          {isEdit ? 'Save changes' : 'Add repo'}
        </Btn>
        <ActionPill tone="neutral" onClick={onCancel}>Cancel</ActionPill>
      </ActionPillRow>
    </div>
  )
}
