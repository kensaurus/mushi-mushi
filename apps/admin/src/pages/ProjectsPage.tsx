/**
 * FILE: apps/admin/src/pages/ProjectsPage.tsx
 * PURPOSE: List, create, and operate on every project the user owns. Includes
 *          per-project stats, member chips, deep links into project-scoped
 *          surfaces (settings, reports, integrations), and a "send test
 *          report" action so admins can verify the pipeline end-to-end without
 *          copy-pasting an API key.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { pluralize, pluralizeWithCount } from '../lib/format'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  ErrorAlert,
  Input,
  EmptyState,
  Badge,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { useCreateProject } from '../lib/useCreateProject'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'

interface ApiKey {
  id: string
  key_prefix: string
  created_at: string
  is_active: boolean
  revoked: boolean
}

interface Member {
  user_id: string
  role: string
}

type PdcaStageId = 'plan' | 'do' | 'check' | 'act'

interface Project {
  id: string
  name: string
  slug: string
  created_at: string
  api_keys: ApiKey[]
  active_key_count: number
  member_count: number
  members: Member[]
  report_count: number
  last_report_at: string | null
  pdca_bottleneck: PdcaStageId | null
  pdca_bottleneck_label: string | null
}

const PDCA_BOTTLENECK_TONE: Record<PdcaStageId, string> = {
  plan: 'bg-info-muted text-info border border-info/30',
  do: 'bg-warn-muted text-warn border border-warn/30',
  check: 'bg-warn-muted text-warn border border-warn/30',
  act: 'bg-danger-muted text-danger border border-danger/30',
}

const PDCA_BOTTLENECK_DEEP_LINK: Record<PdcaStageId, string> = {
  plan: '/reports?status=new',
  do: '/fixes',
  check: '/judge',
  act: '/integrations',
}

const STORAGE_KEY = 'mushi:active_project_id'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ProjectsPage() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()

  const [newName, setNewName] = useState('')
  const [busyProject, setBusyProject] = useState<string | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({})

  const { data, loading, error, reload } = usePageData<{ projects: Project[] }>('/v1/admin/projects')
  const projects = useMemo(() => data?.projects ?? [], [data])

  const { create: createProjectRaw, creating } = useCreateProject({
    onCreated: () => {
      setNewName('')
      reload()
    },
  })

  async function createProject() {
    await createProjectRaw(newName)
  }

  async function generateKey(projectId: string) {
    setBusyProject(projectId)
    try {
      const res = await apiFetch<{ key: string; prefix: string }>(`/v1/admin/projects/${projectId}/keys`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Mint failed')
      const key = res.data?.key
      if (key) {
        setRevealedKeys((prev) => ({ ...prev, [projectId]: key }))
        try {
          await navigator.clipboard.writeText(key)
          toast.success('API key copied to clipboard', 'It will not be shown again — store it in your secrets manager.',)
        } catch {
          toast.success('API key minted', 'Copy it now — it will not be shown again.')
        }
      }
      reload()
    } catch (err) {
      toast.error('Failed to generate key', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyProject(null)
    }
  }

  async function revokeKey(projectId: string, keyId: string) {
    if (!confirm('Revoke this API key? Any client using it will start failing immediately.')) return
    try {
      const res = await apiFetch(`/v1/admin/projects/${projectId}/keys/${keyId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Revoke failed')
      toast.success('API key revoked')
      reload()
    } catch (err) {
      toast.error('Failed to revoke key', err instanceof Error ? err.message : String(err))
    }
  }

  async function sendTestReport(projectId: string, name: string) {
    setBusyProject(projectId)
    try {
      const res = await apiFetch(`/v1/admin/projects/${projectId}/test-report`, { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Test report failed')
      toast.success(`Test report queued for ${name}`, 'Watch /reports for it to land in the next ~10s.',)
    } catch (err) {
      toast.error('Could not send test report', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyProject(null)
    }
  }

  function setActive(projectId: string, name: string) {
    try {
      localStorage.setItem(STORAGE_KEY, projectId)
    } catch {
      /* private mode */
    }
    const next = new URLSearchParams(searchParams)
    next.set('project', projectId)
    setSearchParams(next, { replace: true })
    toast.success(`Switched active project to ${name}`)
  }

  if (loading) return <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading projects" />
  if (error) return <ErrorAlert message={`Failed to load projects: ${error}`} onRetry={reload} />

  return (
    <div className="space-y-4">
      <PageHeader title="Projects" description={`${pluralizeWithCount(projects.length, 'project')} owned by you`} />

      <PageHelp
        title="About Projects"
        whatIsIt="A project is a logical grouping of bug reports — usually one per app, game, or service. Each project gets its own API keys, settings, integrations, and reports inbox so multiple sources can submit reports without mixing them."
        useCases={[
          'Separate reports from your iOS app, Android app, and backend API',
          'Rotate credentials by revoking and re-issuing API keys without downtime',
          'Scope per-project routing rules and SLAs in Settings, then share read access via members',
        ]}
        howToUse="Create a project, mint an API key, then drop it into the SDK or send it as the X-API-Key header. Use the Test report action to verify ingest before wiring up production traffic."
      />

      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="New project name (e.g. Acme iOS app)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
          />
        </div>
        <Btn onClick={createProject} disabled={creating || !newName.trim()}>
          {creating ? 'Creating...' : 'Create project'}
        </Btn>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<HeroPlugIntegration />}
          title="No projects yet"
          description="Create your first project above to start receiving bug reports. You'll get an API key to use with the SDK or REST endpoint."
        />
      ) : (
        <div className="space-y-2">
          {projects.map((project) => {
            const isActive = activeProjectId === project.id
            const isBusy = busyProject === project.id
            const revealed = revealedKeys[project.id]
            return (
              <Card key={project.id} className={`p-3 ${isActive ? 'ring-1 ring-brand/40' : ''}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium text-fg">{project.name}</h3>
                      {isActive && <Badge className="bg-brand/15 text-brand">Active</Badge>}
                      <code className="text-2xs font-mono text-fg-faint">{project.slug}</code>
                    </div>
                    <p className="text-2xs text-fg-faint mt-0.5">
                      Created {new Date(project.created_at).toLocaleDateString()} · last report {relativeTime(project.last_report_at)}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-2xs text-fg-secondary flex-wrap">
                      <span><span className="font-mono text-fg">{project.report_count}</span> {pluralize(project.report_count, 'report')}</span>
                      <span><span className="font-mono text-fg">{project.active_key_count}</span> active {pluralize(project.active_key_count, 'key')}</span>
                      <span><span className="font-mono text-fg">{project.member_count}</span> {pluralize(project.member_count, 'member')}</span>
                      {project.pdca_bottleneck && project.pdca_bottleneck_label && (
                        <Link
                          to={`${PDCA_BOTTLENECK_DEEP_LINK[project.pdca_bottleneck]}&project=${project.id}`}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-2xs font-medium hover:opacity-90 motion-safe:transition-opacity ${PDCA_BOTTLENECK_TONE[project.pdca_bottleneck]}`}
                          title="Where this project is stuck — click to jump to that stage"
                        >
                          <span className="font-mono uppercase">{project.pdca_bottleneck}</span>
                          <span>{project.pdca_bottleneck_label}</span>
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {!isActive && (
                      <Btn variant="ghost" size="sm" onClick={() => setActive(project.id, project.name)}>
                        Set active
                      </Btn>
                    )}
                    <Link
                      to={`/reports?project=${project.id}`}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg rounded-sm motion-safe:transition-colors"
                    >
                      Reports
                    </Link>
                    <Link
                      to={`/integrations?project=${project.id}`}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg rounded-sm motion-safe:transition-colors"
                    >
                      Integrations
                    </Link>
                    <Link
                      to={`/settings?project=${project.id}`}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg rounded-sm motion-safe:transition-colors"
                    >
                      Settings
                    </Link>
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => sendTestReport(project.id, project.name)}
                      disabled={isBusy}
                      title="Sends a synthetic report through the live ingest pipeline"
                    >
                      Send test report
                    </Btn>
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => generateKey(project.id)}
                      disabled={isBusy}
                      loading={isBusy}
                    >
                      Generate API key
                    </Btn>
                  </div>
                </div>

                {revealed && (
                  <div className="mt-3 pt-2 border-t border-edge-subtle bg-warn-muted/20 -mx-3 px-3 py-2">
                    <div className="text-2xs text-warn font-medium uppercase tracking-wider mb-1">
                      ⚠️ One-time key — copy now, will not be shown again
                    </div>
                    <code className="font-mono text-xs text-fg break-all select-all bg-surface-raised px-2 py-1 rounded-sm block">
                      {revealed}
                    </code>
                    <Btn
                      variant="ghost"
                      size="sm"
                      className="mt-1"
                      onClick={() => setRevealedKeys((prev) => {
                        const { [project.id]: _, ...rest } = prev
                        return rest
                      })}
                    >
                      I've stored it — hide
                    </Btn>
                  </div>
                )}

                {project.api_keys.length > 0 && (
                  <details className="mt-3 pt-2 border-t border-edge-subtle">
                    <summary className="text-2xs text-fg-muted cursor-pointer select-none hover:text-fg">
                      {pluralizeWithCount(project.api_keys.length, 'key')} ({project.active_key_count} active)
                    </summary>
                    <div className="mt-2 space-y-1">
                      {project.api_keys.map((key) => (
                        <div key={key.id} className="flex items-center justify-between text-2xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <code className={`font-mono ${key.revoked ? 'text-fg-faint line-through' : 'text-fg-secondary'}`}>
                              {key.key_prefix}…
                            </code>
                            <span className="text-fg-faint">created {relativeTime(key.created_at)}</span>
                            {key.revoked && <Badge className="bg-surface-overlay text-fg-faint">revoked</Badge>}
                          </div>
                          {!key.revoked && (
                            <Btn variant="danger" size="sm" onClick={() => revokeKey(project.id, key.id)}>
                              Revoke
                            </Btn>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
