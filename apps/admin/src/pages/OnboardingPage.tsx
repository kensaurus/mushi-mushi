/**
 * FILE: apps/admin/src/pages/OnboardingPage.tsx
 * PURPOSE: Wizard-mode setup view. Renders the shared SetupChecklist primitive
 *          and adds the contextual UX needed for the very first project (create
 *          form + API key reveal + test report + SDK snippet).
 *
 *          State source-of-truth is `useSetupStatus()` (DB-backed). The wizard
 *          drives next-step focus off `activeProject.steps`, so progress survives
 *          across browsers/devices and stays in sync with what the rest of the
 *          admin sees.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { Btn, Card, Input, PageHelp, ErrorAlert, ResultChip, type ResultChipTone } from '../components/ui'
import { OnboardingSkeleton } from '../components/skeletons/OnboardingSkeleton'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { SetupChecklist } from '../components/SetupChecklist'
import { ProjectNarrativeStrip } from '../components/dashboard/ProjectNarrativeStrip'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { restartFirstRunTour } from '../components/FirstRunTour'

interface ApiKey {
  key: string
  prefix: string
}

const SDK_SNIPPETS = {
  react: (projectId: string, apiKey: string) => `import { MushiProvider } from '@mushi-mushi/react'

function App() {
  return (
    <MushiProvider config={{
      projectId: '${projectId}',
      apiKey: '${apiKey}',
    }}>
      <YourApp />
    </MushiProvider>
  )
}`,

  vue: (projectId: string, apiKey: string) => `import { MushiPlugin } from '@mushi-mushi/vue'
import { Mushi } from '@mushi-mushi/web'

app.use(MushiPlugin, { projectId: '${projectId}', apiKey: '${apiKey}' })
Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,

  svelte: (projectId: string, apiKey: string) => `import { initMushi } from '@mushi-mushi/svelte'
import { Mushi } from '@mushi-mushi/web'

initMushi({ projectId: '${projectId}', apiKey: '${apiKey}' })
Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,

  vanilla: (projectId: string, apiKey: string) => `import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: '${projectId}',
  apiKey: '${apiKey}',
  widget: { position: 'bottom-right', theme: 'auto' },
  capture: { console: true, network: true, screenshot: 'on-report' },
})`,
}

type Framework = keyof typeof SDK_SNIPPETS

export function OnboardingPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const copy = usePageCopy('/onboarding')

  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [apiKey, setApiKey] = useState<ApiKey | null>(null)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [testRanAt, setTestRanAt] = useState<string | null>(null)
  const [framework, setFramework] = useState<Framework>('react')
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [error, setError] = useState('')

  const project = setup.activeProject

  // What's the next required step? We use it to highlight the right card.
  const nextRequired = useMemo(
    () => project?.steps.find(s => s.required && !s.complete) ?? null,
    [project],
  )

  // When the user completes the basics + lands here from the dashboard banner,
  // they shouldn't be stuck on a wizard with nothing to do — redirect home.
  useEffect(() => {
    if (!setup.loading && project?.done && !apiKey && testStatus !== 'pass') {
      // Only auto-bounce when there's truly nothing left to do AND the user
      // didn't just generate a one-time-revealable API key (so they can copy it).
      const allOptionalDoneToo = project.complete >= project.total
      if (allOptionalDoneToo) navigate('/', { replace: true })
    }
  }, [setup.loading, project, apiKey, testStatus, navigate])

  if (setup.loading) return <OnboardingSkeleton />
  if (setup.error) return <ErrorAlert message={setup.error} onRetry={setup.reload} />

  async function createProject() {
    if (!projectName.trim()) return
    setCreating(true)
    setError('')
    // Backend returns `data: { id, slug }` — not `data: { project: { ... } }`.
    // The previous code keyed off `res.data?.project` and silently fell back to
    // a GET on every success, masking the actual happy path.
    const res = await apiFetch<{ id: string; slug: string }>('/v1/admin/projects', {
      method: 'POST',
      body: JSON.stringify({ name: projectName.trim() }),
    })
    setCreating(false)
    if (res.ok && res.data?.id) {
      toast.success('Project created', projectName.trim())
      setProjectName('')
      setup.reload()
    } else {
      const msg = res.error?.message ?? 'Failed to create project'
      setError(msg)
      toast.error('Could not create project', msg)
    }
  }

  async function generateKey() {
    if (!project) return
    setGeneratingKey(true)
    setError('')
    const res = await apiFetch<ApiKey>(`/v1/admin/projects/${project.project_id}/keys`, { method: 'POST' })
    setGeneratingKey(false)
    if (res.ok && res.data) {
      setApiKey(res.data)
      toast.success('API key generated', 'Copy it now \u2014 it will not be shown again.')
      setup.reload()
    } else {
      const msg = res.error?.message ?? 'Failed to generate API key'
      setError(msg)
      toast.error('Could not generate API key', msg)
    }
  }

  async function submitTestReport() {
    if (!project) return
    setTestStatus('running')
    setError('')
    // Use the admin pipeline-test endpoint so we don't need the user to have
    // copied the key yet — we're already JWT-authenticated as the owner.
    const res = await apiFetch(`/v1/admin/projects/${project.project_id}/test-report`, { method: 'POST' })
    setTestRanAt(new Date().toISOString())
    setTestStatus(res.ok ? 'pass' : 'fail')
    if (res.ok) {
      toast.success('Test report sent', 'Look for it on the Reports page in a few seconds.')
      setup.reload()
    } else {
      const msg = res.error?.message ?? 'Test report submission failed'
      setError(msg)
      toast.error('Test report failed', msg)
    }
  }

  // Maps the local 4-state lifecycle to the shared ResultChip tone vocabulary.
  // Co-located with the consumer because the mapping is page-specific (idle is
  // suppressed at the call site so the chip never appears before first run).
  function testTone(status: 'idle' | 'running' | 'pass' | 'fail'): ResultChipTone {
    if (status === 'running') return 'running'
    if (status === 'pass') return 'success'
    if (status === 'fail') return 'error'
    return 'idle'
  }

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true)
      setTimeout(() => setter(false), 2000)
    })
  }

  const sdkInstalled = !setup.isStepIncomplete('sdk_installed')
  const hasReports = (project?.report_count ?? 0) > 0
  const hasFix = (project?.fix_count ?? 0) > 0
  const hasMerged = (project?.merged_fix_count ?? 0) > 0

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-fg">Get started with Mushi Mushi</h2>
        <p className="text-xs text-fg-muted mt-0.5">
          Live progress — every step is verified against your project's data, not local cache.
        </p>
      </div>

      {project && (
        <ProjectNarrativeStrip
          projectName={project.project_name}
          sdkInstalled={sdkInstalled}
          hasReports={hasReports}
          hasFix={hasFix}
          hasMerged={hasMerged}
        />
      )}

      <PageHelp
        title={copy?.help?.title ?? 'About this wizard'}
        whatIsIt={copy?.help?.whatIsIt ?? 'A guided flow that creates your first project, generates an API key, verifies the pipeline, and shows the SDK snippet. State syncs across devices.'}
        useCases={copy?.help?.useCases ?? [
          'Create the project that will receive bug reports from your app',
          'Mint and copy the API key that authenticates SDK requests',
          'Confirm the ingest pipeline is reachable before shipping any code',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Complete the required steps in order. The API key is only shown once \u2014 copy it before continuing. You can rerun the test report any time from Settings.'}
      />

      {project && <SetupChecklist project={project} mode="wizard" />}

      {/* Card 1: Create Project (only when no project yet) */}
      {!setup.hasAnyProject && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Create your first project</h3>
            <p className="text-xs text-fg-muted mt-1">
              A project groups all bug reports from one application. Name it after your app.
            </p>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="e.g. My SaaS App"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                autoFocus
              />
            </div>
            <Btn onClick={createProject} loading={creating} disabled={creating || !projectName.trim()}>
              Create
            </Btn>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </Card>
      )}

      {/* Card 2: API Key (only when project exists but no key) */}
      {project && nextRequired?.id === 'api_key_generated' && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Generate an API key</h3>
            <p className="text-xs text-fg-muted mt-1">
              Your SDK uses this key to authenticate report submissions. The full key is shown <strong>only once</strong> — copy it before navigating away.
            </p>
          </div>
          {!apiKey ? (
            <>
              <Btn onClick={generateKey} loading={generatingKey} disabled={generatingKey}>
                Generate API Key
              </Btn>
              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          ) : (
            <KeyReveal apiKey={apiKey} copied={keyCopied} onCopy={() => copyToClipboard(apiKey.key, setKeyCopied)} />
          )}
        </Card>
      )}

      {/* Card 3: Test connection */}
      {project && !setup.isStepIncomplete('api_key_generated') && setup.isStepIncomplete('first_report_received') && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Test your connection</h3>
            <p className="text-xs text-fg-muted mt-1">
              Verify that the backend is reachable and the pipeline can accept reports.
            </p>
          </div>
          <ConnectionStatus />
          <div className="border-t border-edge-subtle pt-3">
            <p className="text-xs text-fg-muted mb-2">Submit a test report to verify the full pipeline:</p>
            <div className="flex items-center gap-3 flex-wrap">
              <Btn
                onClick={submitTestReport}
                loading={testStatus === 'running'}
                disabled={testStatus === 'running'}
                variant={testStatus === 'pass' ? 'ghost' : 'primary'}
              >
                {testStatus === 'pass' ? 'Send another' : 'Submit test report'}
              </Btn>
              {testStatus !== 'idle' && (
                <ResultChip
                  tone={testTone(testStatus)}
                  at={testStatus === 'pass' || testStatus === 'fail' ? testRanAt : null}
                >
                  {testStatus === 'running' && 'Submitting test report…'}
                  {testStatus === 'pass' && 'Pipeline is working — open /reports to see the row'}
                  {testStatus === 'fail' && (error || 'Submission failed')}
                </ResultChip>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Card 4: SDK snippet — always available once a key exists */}
      {project && !setup.isStepIncomplete('api_key_generated') && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Integrate the SDK</h3>
            <p className="text-xs text-fg-muted mt-1">
              Install the package for your framework and drop in this snippet. Your project ID is pre-filled; replace
              <code className="mx-1 px-1 py-0.5 rounded bg-surface-raised text-fg-secondary">mushi_xxx</code>
              with the API key above (or generate a new one in Projects).
            </p>
          </div>

          <div className="flex gap-1 border-b border-edge-subtle pb-2">
            {(Object.keys(SDK_SNIPPETS) as Framework[]).map((fw) => (
              <button
                key={fw}
                onClick={() => { setFramework(fw); setSnippetCopied(false) }}
                className={`px-2.5 py-1 rounded-sm text-xs transition-colors ${
                  framework === fw
                    ? 'bg-brand text-brand-fg font-medium'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-overlay'
                }`}
              >
                {fw === 'vanilla' ? 'Vanilla JS' : fw.charAt(0).toUpperCase() + fw.slice(1)}
              </button>
            ))}
          </div>

          <div>
            <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Install</span>
            <pre className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-xs font-mono text-fg-secondary">
              npm install @mushi-mushi/{framework === 'vanilla' ? 'web' : framework}{framework !== 'react' && framework !== 'vanilla' ? ' @mushi-mushi/web' : ''}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Code</span>
              <button
                onClick={() => copyToClipboard(
                  SDK_SNIPPETS[framework](project.project_id, apiKey?.key ?? 'mushi_xxx'),
                  setSnippetCopied,
                )}
                className="text-2xs text-brand hover:text-brand-hover"
              >
                {snippetCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap">
              {SDK_SNIPPETS[framework](project.project_id, apiKey?.key ?? 'mushi_xxx')}
            </pre>
          </div>

          <div className="flex gap-2 pt-2">
            <Btn variant="ghost" onClick={() => navigate('/')}>Go to Dashboard</Btn>
          </div>
        </Card>
      )}

      <p className="text-center flex items-center justify-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-2xs text-fg-faint hover:text-fg-muted transition-colors"
        >
          Skip setup — go to dashboard
        </button>
        <span className="text-2xs text-fg-faint" aria-hidden="true">·</span>
        <button
          onClick={() => {
            restartFirstRunTour()
            navigate('/')
          }}
          className="text-2xs text-fg-faint hover:text-fg-muted transition-colors"
        >
          Restart tour
        </button>
      </p>
    </div>
  )
}

function KeyReveal({ apiKey, copied, onCopy }: { apiKey: ApiKey; copied: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-3">
      <div className="bg-surface-raised border border-ok/30 rounded-sm px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Your API Key</span>
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? 'API key copied' : 'Copy API key to clipboard'}
            className="inline-flex items-center gap-1 text-2xs font-medium text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors motion-safe:active:scale-[0.97]"
          >
            <span aria-hidden="true">{copied ? '✓' : '⎘'}</span>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <code className="text-sm font-mono text-ok break-all select-all">{apiKey.key}</code>
      </div>
      <div className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2">
        <p className="text-2xs text-warn">
          Save this key securely. It will not be shown again after you leave this page.
        </p>
      </div>
    </div>
  )
}
