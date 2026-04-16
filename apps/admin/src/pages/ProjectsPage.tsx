import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, Card, Btn, Loading, ErrorAlert, Input } from '../components/ui'

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
    await apiFetch('/v1/admin/projects', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim() }),
    })
    setNewName('')
    setCreating(false)
    await loadProjects()
  }

  async function generateKey(projectId: string) {
    await apiFetch(`/v1/admin/projects/${projectId}/keys`, { method: 'POST' })
    await loadProjects()
  }

  async function revokeKey(projectId: string, keyId: string) {
    await apiFetch(`/v1/admin/projects/${projectId}/keys/${keyId}`, { method: 'DELETE' })
    await loadProjects()
  }

  if (loading) return <Loading text="Loading projects..." />
  if (error) return <ErrorAlert message="Failed to load projects." onRetry={loadProjects} />

  return (
    <div className="space-y-4">
      <PageHeader title="Projects" />

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
    </div>
  )
}
