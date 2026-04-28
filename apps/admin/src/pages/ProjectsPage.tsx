/**
 * FILE: apps/admin/src/pages/ProjectsPage.tsx
 * PURPOSE: List, create, and operate on every project the user owns. Includes
 *          per-project stats, member chips, deep links into project-scoped
 *          surfaces (settings, reports, integrations), and a "send test
 *          report" action so admins can verify the pipeline end-to-end without
 *          copy-pasting an API key.
 */

import { useEffect, useMemo, useState } from 'react'
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
import { ACTIVE_PROJECT_QUERY_PARAM, setActiveProjectIdSnapshot } from '../lib/activeProject'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { RevealedKeyCard } from '../components/RevealedKeyCard'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { ConfigHelp } from '../components/ConfigHelp'

interface ApiKey {
  id: string
  key_prefix: string
  created_at: string
  is_active: boolean
  revoked: boolean
  scopes?: string[]
  label?: string | null
}

/**
 * Scope presets surfaced in the "New key" picker. Each preset bundles one or
 * more raw scopes so users can pick a capability (what agents do with the
 * key) instead of reasoning about the underlying vocabulary.
 *
 * Mirror of the check constraint on `project_api_keys.scopes` — if you add
 * a preset here you must also add the raw scope to migration
 * `20260421003000_api_key_scopes.sql`.
 */
type ScopePresetId = 'sdk' | 'mcp-read' | 'mcp-write'

const SCOPE_PRESETS: Array<{ id: ScopePresetId; label: string; scopes: string[]; hint: string }> = [
  {
    id: 'sdk',
    label: 'SDK ingest',
    scopes: ['report:write'],
    hint: "For your app's Mushi SDK — submit reports, nothing else.",
  },
  {
    id: 'mcp-read',
    label: 'MCP read-only',
    scopes: ['mcp:read'],
    hint: 'Coding agent can browse reports, fixes, graph — but not act.',
  },
  {
    id: 'mcp-write',
    label: 'MCP read + write',
    scopes: ['mcp:write'],
    hint: 'Coding agent can dispatch fixes, run judge, transition status.',
  },
]

function scopeBadgeTone(scope: string): string {
  if (scope === 'mcp:write') return 'bg-danger-muted text-danger border border-danger/30'
  if (scope === 'mcp:read') return 'bg-info-muted text-info border border-info/30'
  return 'bg-surface-overlay text-fg-muted border border-edge-subtle'
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

const LINK_CHIP_CLASS =
  'inline-flex items-center justify-center px-2 py-1 text-xs font-medium rounded-sm gap-1.5 ' +
  'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'motion-safe:transition-colors motion-safe:duration-150'

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
  const [revealedKeys, setRevealedKeys] = useState<
    Record<string, { key: string; scopes: string[] }>
  >({})
  /* SDK configurator open/closed state per project. The default is "open iff
     this row is the project we're currently viewing", but the user can
     manually toggle a row open or closed and that override should stick
     until they Switch to a different project (at which point the override
     map clears so the new active row auto-opens and the previously-active
     row auto-collapses). Tracking overrides explicitly — instead of letting
     <details> own its own state — is what lets us collapse the prior row
     on Switch without fighting the user's manual toggles in steady state. */
  const [sdkOpenOverride, setSdkOpenOverride] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setSdkOpenOverride({})
  }, [activeProjectId])
  // Per-project preset selection so multiple keys can be minted without
  // losing the user's last choice on rerender.
  const [keyScopePreset, setKeyScopePreset] = useState<Record<string, ScopePresetId>>({})

  const { data, loading, error, reload } = usePageData<{ projects: Project[] }>(
    '/v1/admin/projects',
  )
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
    const presetId = keyScopePreset[projectId] ?? 'sdk'
    const preset = SCOPE_PRESETS.find((p) => p.id === presetId) ?? SCOPE_PRESETS[0]
    setBusyProject(projectId)
    try {
      const res = await apiFetch<{ key: string; prefix: string; scopes: string[] }>(
        `/v1/admin/projects/${projectId}/keys`,
        {
          method: 'POST',
          body: JSON.stringify({ scopes: preset.scopes }),
        },
      )
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to generate key')
      const key = res.data?.key
      const scopes = res.data?.scopes ?? preset.scopes
      if (key) {
        setRevealedKeys((prev) => ({ ...prev, [projectId]: { key, scopes } }))
        try {
          await navigator.clipboard.writeText(key)
          toast.success(
            `${preset.label} key copied to clipboard`,
            'It will not be shown again — store it in your secrets manager.',
          )
        } catch {
          toast.success(
            `${preset.label} key generated`,
            'Copy it now — it will not be shown again.',
          )
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
      const res = await apiFetch(`/v1/admin/projects/${projectId}/keys/${keyId}`, {
        method: 'DELETE',
      })
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
      toast.success(
        `Test report queued for ${name}`,
        'Watch /reports for it to land in the next ~10s.',
      )
    } catch (err) {
      toast.error('Could not send test report', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyProject(null)
    }
  }

  function setActive(projectId: string, name: string) {
    setActiveProjectIdSnapshot(projectId)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, projectId)
    setSearchParams(next, { replace: true })
    toast.success(`Now viewing ${name}`)
  }

  if (loading)
    return <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading projects" />
  if (error) return <ErrorAlert message={`Failed to load projects: ${error}`} onRetry={reload} />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description={`${pluralizeWithCount(projects.length, 'project')} owned by you`}
      />

      <PageHelp
        title="About Projects"
        whatIsIt="A project is a logical grouping of bug reports — usually one per app, game, or service. Each project gets its own API keys, settings, integrations, and reports inbox so multiple sources can submit reports without mixing them."
        useCases={[
          'Separate reports from your iOS app, Android app, and backend API',
          'Rotate credentials by revoking and re-issuing API keys without downtime',
          'Scope per-project routing rules and SLAs in Settings, then share read access via members',
          'The "Viewing" badge marks which project the rest of the admin console is focused on — Reports, Fixes, Dashboard, Billing, and Health all filter to that one. Every project keeps ingesting reports in the background regardless; this is just a UI lens.',
        ]}
        howToUse="Create a project, generate an API key, then drop it into the SDK or send it as the X-API-Key header. Use Switch to to change which project the admin console is showing, or use the project picker in the top-right header. Use the Test report action to verify ingest before wiring up production traffic."
      />

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            label="Project name"
            helpId="projects.create_project"
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
                      {isActive && (
                        <Badge
                          className="bg-brand/15 text-brand"
                          title="The admin console pages (Reports, Fixes, Dashboard, etc.) are currently filtered to this project. All your other projects are still live and ingesting reports — this is just which one the UI is focused on."
                        >
                          Viewing
                        </Badge>
                      )}
                      <code className="text-2xs font-mono text-fg-faint">{project.slug}</code>
                    </div>
                    <p className="text-2xs text-fg-faint mt-0.5">
                      Created {new Date(project.created_at).toLocaleDateString()} · last report{' '}
                      {relativeTime(project.last_report_at)}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-2xs text-fg-secondary flex-wrap">
                      <span>
                        <span className="font-mono text-fg">{project.report_count}</span>{' '}
                        {pluralize(project.report_count, 'report')}
                      </span>
                      <span>
                        <span className="font-mono text-fg">{project.active_key_count}</span> active{' '}
                        {pluralize(project.active_key_count, 'key')}
                      </span>
                      <span>
                        <span className="font-mono text-fg">{project.member_count}</span>{' '}
                        {pluralize(project.member_count, 'member')}
                      </span>
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
                      <span className="inline-flex items-center gap-1">
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={() => setActive(project.id, project.name)}
                          title="Switch the admin console UI to focus on this project. Your other projects keep ingesting reports either way — this is just which one Reports / Fixes / Dashboard etc. show by default."
                        >
                          Switch to
                        </Btn>
                        <ConfigHelp helpId="projects.active_project" />
                      </span>
                    )}
                    <Link to={`/reports?project=${project.id}`} className={LINK_CHIP_CLASS}>
                      Reports
                    </Link>
                    <Link to={`/integrations?project=${project.id}`} className={LINK_CHIP_CLASS}>
                      Integrations
                    </Link>
                    <Link to={`/settings?project=${project.id}`} className={LINK_CHIP_CLASS}>
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
                    <div className="flex items-center gap-1" data-testid={`mint-key-${project.id}`}>
                      <label htmlFor={`key-scope-${project.id}`} className="sr-only">
                        API key scope for {project.name}
                      </label>
                      <ConfigHelp helpId="projects.api_key_scope" />
                      <select
                        id={`key-scope-${project.id}`}
                        data-testid={`key-scope-${project.id}`}
                        className="text-2xs bg-surface-raised border border-edge rounded-sm px-2 py-1 text-fg-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                        value={keyScopePreset[project.id] ?? 'sdk'}
                        onChange={(e) =>
                          setKeyScopePreset((prev) => ({
                            ...prev,
                            [project.id]: e.target.value as ScopePresetId,
                          }))
                        }
                        disabled={isBusy}
                        title={
                          SCOPE_PRESETS.find((p) => p.id === (keyScopePreset[project.id] ?? 'sdk'))
                            ?.hint
                        }
                      >
                        {SCOPE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => generateKey(project.id)}
                        disabled={isBusy}
                        loading={isBusy}
                        data-testid={`generate-key-${project.id}`}
                      >
                        Generate key
                      </Btn>
                    </div>
                  </div>
                </div>

                {revealed && (
                  <RevealedKeyCard
                    projectId={project.id}
                    projectName={project.name}
                    apiKey={revealed.key}
                    scopes={revealed.scopes}
                    onDismiss={() =>
                      setRevealedKeys((prev) => {
                        const { [project.id]: _, ...rest } = prev
                        return rest
                      })
                    }
                  />
                )}

                {project.api_keys.length > 0 && (
                  <details className="mt-3 pt-2 border-t border-edge-subtle">
                    <summary className="text-2xs text-fg-muted cursor-pointer select-none hover:text-fg">
                      {pluralizeWithCount(project.api_keys.length, 'key')} (
                      {project.active_key_count} active)
                    </summary>
                    <div className="mt-2 space-y-1">
                      {project.api_keys.map((key) => (
                        <div
                          key={key.id}
                          className="flex items-center justify-between text-2xs gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <code
                              className={`font-mono ${key.revoked ? 'text-fg-faint line-through' : 'text-fg-secondary'}`}
                            >
                              {key.key_prefix}…
                            </code>
                            {(key.scopes ?? []).map((s) => (
                              <Badge key={s} className={scopeBadgeTone(s)}>
                                {s}
                              </Badge>
                            ))}
                            <span className="text-fg-faint">
                              created {relativeTime(key.created_at)}
                            </span>
                            {key.revoked && (
                              <Badge className="bg-surface-overlay text-fg-faint">revoked</Badge>
                            )}
                          </div>
                          {!key.revoked && (
                            <Btn
                              variant="danger"
                              size="sm"
                              onClick={() => revokeKey(project.id, key.id)}
                            >
                              Revoke
                            </Btn>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Per-project SDK CONFIGURATOR + install snippet. Stays
                    collapsed by default so the row remains scannable when
                    the user is just managing keys, but the disclosure
                    header is now full-width with an icon + descriptive
                    sub-line so the eye actually catches it (the previous
                    tiny "SDK install snippet" link looked identical to
                    the keys row above and was getting missed). */}
                {/* Open the configurator for whichever project the user is
                    currently viewing; collapse it for the others so the rows
                    stay scannable. Open state is `override ?? isActive`, so
                    a user-toggled value wins on re-renders (project data
                    refetches won't snap it back), but the override map is
                    cleared whenever `activeProjectId` changes (see the
                    `useEffect` above) — that way clicking Switch to on
                    another row collapses the previous one and opens the new
                    one with no leftover override fighting the new default. */}
                <details
                  className="mt-3 pt-3 border-t border-edge-subtle group"
                  data-testid={`sdk-configurator-${project.id}`}
                  open={sdkOpenOverride[project.id] ?? isActive}
                  onToggle={(e) => {
                    const nextOpen = (e.currentTarget as HTMLDetailsElement).open
                    setSdkOpenOverride((prev) => {
                      // No-op: matches what the default would be anyway, so
                      // don't grow the override map unnecessarily.
                      if (nextOpen === isActive && !(project.id in prev)) return prev
                      return { ...prev, [project.id]: nextOpen }
                    })
                  }}
                >
                  <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-2 py-1.5 -mx-2 rounded-sm hover:bg-surface-overlay transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className="text-fg-muted text-xs">
                        {'\u{1F41B}'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-fg">
                          Preview, configure & install the SDK widget
                        </div>
                        <div className="text-2xs text-fg-faint">
                          Live mock preview · 4-corner position picker · theme · capture flags ·
                          auto-updating snippet
                        </div>
                      </div>
                    </div>
                    <span
                      aria-hidden="true"
                      className="text-2xs text-fg-faint group-open:rotate-90 motion-safe:transition-transform"
                    >
                      ›
                    </span>
                  </summary>
                  <div className="mt-3">
                    {/* Pass `revealed?.key` so the snippet shows the real,
                        just-minted plaintext key instead of the `mushi_xxx`
                        placeholder. `revealed` is the same value the
                        RevealedKeyCard above uses, so the user can copy the
                        snippet without manually replacing a placeholder
                        whose actual value is sitting on screen literally
                        inches above. Once the user dismisses the reveal
                        (or reloads), `revealed` becomes undefined and the
                        card cleanly falls back to the placeholder — which
                        is what we want, since we don't persist plaintext. */}
                    <SdkInstallCard projectId={project.id} apiKey={revealed?.key} compact />
                  </div>
                </details>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
