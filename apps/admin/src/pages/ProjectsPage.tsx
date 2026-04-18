import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Btn, Loading, ErrorAlert, Input, EmptyState } from '../components/ui'
import { useToast } from '../lib/toast'

interface Project {
  id: string
  name: string
  created_at: string
  api_keys?: Array<{ id: string; key_prefix: string; created_at: string; revoked: boolean }>
  report_count?: number
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const toast = useToast()

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    setLoading(true)
    setError(false)
    const res = await apiFetch<{ projects: Project[] }>('/v1/admin/projects')
    if (res.ok && res.data) setProjects(res.data.projects)
    else setError(true)
    setLoading(false)
  }

  async function createProject() {
    if (!newName.trim()) return
    setCreating(true)
    const res = await apiFetch('/v1/admin/projects', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim() }),
    })
    setCreating(false)
    if (res.ok) {
      toast.success('Project created', newName.trim())
      setNewName('')
      await loadProjects()
    } else {
      toast.error('Failed to create project', res.error?.message)
    }
  }

  async function generateKey(projectId: string) {
    const res = await apiFetch(`/v1/admin/projects/${projectId}/keys`, { method: 'POST' })
    if (res.ok) {
      toast.success('API key generated', 'Copy it now — it will not be shown again.')
      await loadProjects()
    } else {
      toast.error('Failed to generate key', res.error?.message)
    }
  }

  async function revokeKey(projectId: string, keyId: string) {
    if (!confirm('Revoke this API key? Any client using it will start failing immediately.')) return
    const res = await apiFetch(`/v1/admin/projects/${projectId}/keys/${keyId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('API key revoked')
      await loadProjects()
    } else {
      toast.error('Failed to revoke key', res.error?.message)
    }
  }

  if (loading) return <Loading text="Loading projects..." />
  if (error) return <ErrorAlert message="Failed to load projects." onRetry={loadProjects} />

  return (
    <div className="space-y-4">
      <PageHeader title="Projects" />

      <PageHelp
        title="About Projects"
        whatIsIt="A project is a logical grouping of bug reports — usually one per app, game, or service. Each project gets its own API keys so you can submit reports from multiple sources without mixing them."
        useCases={[
          'Separate reports from your iOS app, Android app, and backend API',
          'Rotate credentials by revoking and re-issuing API keys without downtime',
          'Scope per-project routing rules and SLAs in Settings',
        ]}
        howToUse="Create a project, then click Generate API Key to mint a key. Use the key in the X-API-Key header (or pass it to the SDK) when submitting reports to /v1/reports."
      />

      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="New project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
          />
        </div>
        <Btn onClick={createProject} disabled={creating || !newName.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </Btn>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project above to start receiving bug reports. You'll get an API key to use with the SDK or REST endpoint."
        />
      ) : (
      <div className="space-y-2">
        {projects.map((project) => (
          <Card key={project.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-fg">{project.name}</h3>
                <p className="text-2xs text-fg-faint mt-0.5">
                  Created {new Date(project.created_at).toLocaleDateString()} · <span className="font-mono">{project.report_count ?? 0}</span> reports
                </p>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => generateKey(project.id)}>
                Generate API Key
              </Btn>
            </div>

            {project.api_keys && project.api_keys.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-edge-subtle pt-2">
                {project.api_keys.map((key) => (
                  <div key={key.id} className="flex items-center justify-between text-2xs">
                    <code className={`font-mono ${key.revoked ? 'text-fg-faint line-through' : 'text-fg-secondary'}`}>
                      {key.key_prefix}...
                    </code>
                    {!key.revoked && (
                      <Btn variant="danger" size="sm" onClick={() => revokeKey(project.id, key.id)}>
                        Revoke
                      </Btn>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
      )}
    </div>
  )
}
