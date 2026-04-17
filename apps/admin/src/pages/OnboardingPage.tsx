/**
 * FILE: apps/admin/src/pages/OnboardingPage.tsx
 * PURPOSE: First-run setup wizard shown when a user has no projects.
 *          Guides through: create project → generate API key → test connection → copy SDK snippet.
 *          Follows NN/g wizard guidelines: step indicators, linear flow, self-sufficient steps.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { Btn, Card, Input } from '../components/ui'
import { ConnectionStatus } from '../components/ConnectionStatus'

type WizardStep = 1 | 2 | 3 | 4

interface Project {
  id: string
  name: string
}

interface ApiKey {
  id: string
  key: string
  key_prefix: string
}

const STEP_LABELS = [
  'Create Project',
  'API Key',
  'Test Connection',
  'Integrate SDK',
]

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
  const [step, setStep] = useState<WizardStep>(1)
  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const [apiKey, setApiKey] = useState<ApiKey | null>(null)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [framework, setFramework] = useState<Framework>('react')
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch<{ projects: Project[] }>('/v1/admin/projects').then((res) => {
      if (res.ok && res.data?.projects?.length) {
        setProject(res.data.projects[0])
        setStep(2)
      }
    })
  }, [])

  async function createProject() {
    if (!projectName.trim()) return
    setCreating(true)
    setError('')
    const res = await apiFetch<{ project: Project }>('/v1/admin/projects', {
      method: 'POST',
      body: JSON.stringify({ name: projectName.trim() }),
    })
    setCreating(false)
    if (res.ok && res.data?.project) {
      setProject(res.data.project)
      setStep(2)
    } else {
      const fallback = await apiFetch<{ projects: Project[] }>('/v1/admin/projects')
      if (fallback.ok && fallback.data?.projects?.length) {
        setProject(fallback.data.projects[fallback.data.projects.length - 1])
        setStep(2)
      } else {
        setError(res.error?.message ?? 'Failed to create project')
      }
    }
  }

  async function generateKey() {
    if (!project) return
    setGeneratingKey(true)
    setError('')
    const res = await apiFetch<ApiKey>(`/v1/admin/projects/${project.id}/keys`, { method: 'POST' })
    setGeneratingKey(false)
    if (res.ok && res.data) {
      setApiKey(res.data)
      setStep(3)
    } else {
      setError(res.error?.message ?? 'Failed to generate API key')
    }
  }

  async function submitTestReport() {
    if (!project || !apiKey) return
    setTestResult('running')
    const res = await apiFetch('/v1/reports', {
      method: 'POST',
      headers: { 'X-Mushi-Api-Key': apiKey.key },
      body: JSON.stringify({
        projectId: project.id,
        description: 'Onboarding test report — verifying pipeline connectivity',
        category: 'other',
        environment: { url: 'admin://onboarding', browser: 'mushi-admin', userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, viewport: { width: window.innerWidth, height: window.innerHeight }, referrer: '', timestamp: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        reporterToken: 'onboarding-test',
      }),
    })
    setTestResult(res.ok ? 'pass' : 'fail')
    if (!res.ok) setError(res.error?.message ?? 'Test report submission failed')
  }

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true)
      setTimeout(() => setter(false), 2000)
    })
  }

  function finishOnboarding() {
    localStorage.setItem('mushi:onboarding_completed', 'true')
    navigate('/')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-fg">Get started with Mushi Mushi</h2>
        <p className="text-xs text-fg-muted mt-0.5">Set up your first project in a few steps.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEP_LABELS.map((label, i) => {
          const stepNum = (i + 1) as WizardStep
          const isActive = step === stepNum
          const isDone = step > stepNum
          return (
            <div key={label} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-2xs font-bold shrink-0 ${
                isDone ? 'bg-ok text-ok-fg' : isActive ? 'bg-brand text-brand-fg' : 'bg-surface-raised text-fg-faint border border-edge-subtle'
              }`}>
                {isDone ? '✓' : stepNum}
              </div>
              <span className={`text-2xs truncate hidden sm:inline ${isActive ? 'text-fg font-medium' : 'text-fg-faint'}`}>
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${isDone ? 'bg-ok' : 'bg-edge-subtle'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1: Create Project */}
      {step === 1 && (
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
            <Btn onClick={createProject} disabled={creating || !projectName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </Btn>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </Card>
      )}

      {/* Step 2: Generate API Key */}
      {step === 2 && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Generate an API key</h3>
            <p className="text-xs text-fg-muted mt-1">
              Your SDK uses this key to authenticate report submissions.
              The full key is shown <strong>only once</strong> — copy it now.
            </p>
          </div>
          {project && (
            <div className="bg-surface-raised/50 border border-edge-subtle rounded-sm px-3 py-2">
              <span className="text-2xs text-fg-faint">Project:</span>{' '}
              <span className="text-xs font-medium text-fg">{project.name}</span>
              <span className="text-2xs text-fg-faint ml-2 font-mono">{project.id}</span>
            </div>
          )}
          {!apiKey ? (
            <>
              <Btn onClick={generateKey} disabled={generatingKey}>
                {generatingKey ? 'Generating…' : 'Generate API Key'}
              </Btn>
              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-surface-raised border border-ok/30 rounded-sm px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xs text-fg-faint uppercase tracking-wider font-medium">Your API Key</span>
                  <button
                    onClick={() => copyToClipboard(apiKey.key, setKeyCopied)}
                    className="text-2xs text-brand hover:text-brand-hover"
                  >
                    {keyCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="text-sm font-mono text-ok break-all select-all">{apiKey.key}</code>
              </div>
              <div className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2">
                <p className="text-2xs text-warn">
                  Save this key securely. It will not be shown again after you leave this page.
                </p>
              </div>
              <Btn onClick={() => setStep(3)}>Continue</Btn>
            </div>
          )}
        </Card>
      )}

      {/* Step 3: Test Connection */}
      {step === 3 && (
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
            <div className="flex items-center gap-3">
              <Btn
                onClick={submitTestReport}
                disabled={testResult === 'running'}
                variant={testResult === 'pass' ? 'ghost' : 'primary'}
              >
                {testResult === 'running' ? 'Submitting…' : testResult === 'pass' ? '✓ Test passed' : 'Submit test report'}
              </Btn>
              {testResult === 'pass' && (
                <span className="text-xs text-ok">Pipeline is working.</span>
              )}
              {testResult === 'fail' && (
                <span className="text-xs text-danger">{error || 'Submission failed'}</span>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Btn variant="ghost" onClick={() => setStep(2)}>Back</Btn>
            <Btn onClick={() => setStep(4)}>Continue</Btn>
          </div>
        </Card>
      )}

      {/* Step 4: SDK Integration */}
      {step === 4 && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Integrate the SDK</h3>
            <p className="text-xs text-fg-muted mt-1">
              Install the package for your framework and drop in this snippet.
              Your project ID and API key are pre-filled.
            </p>
          </div>

          {/* Framework tabs */}
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

          {/* Install command */}
          <div>
            <span className="text-2xs text-fg-faint uppercase tracking-wider font-medium">Install</span>
            <pre className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-xs font-mono text-fg-secondary">
              npm install @mushi-mushi/{framework === 'vanilla' ? 'web' : framework}{framework !== 'react' && framework !== 'vanilla' ? ' @mushi-mushi/web' : ''}
            </pre>
          </div>

          {/* Code snippet */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-fg-faint uppercase tracking-wider font-medium">Code</span>
              <button
                onClick={() => copyToClipboard(
                  SDK_SNIPPETS[framework](project?.id ?? 'proj_xxx', apiKey?.key ?? 'mushi_xxx'),
                  setSnippetCopied,
                )}
                className="text-2xs text-brand hover:text-brand-hover"
              >
                {snippetCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap">
              {SDK_SNIPPETS[framework](project?.id ?? 'proj_xxx', apiKey?.key ?? 'mushi_xxx')}
            </pre>
          </div>

          <div className="flex gap-2 pt-2">
            <Btn variant="ghost" onClick={() => setStep(3)}>Back</Btn>
            <Btn onClick={finishOnboarding}>Go to Dashboard</Btn>
          </div>
        </Card>
      )}

      {/* Skip link */}
      <p className="text-center">
        <button
          onClick={finishOnboarding}
          className="text-2xs text-fg-faint hover:text-fg-muted transition-colors"
        >
          Skip setup — go to dashboard
        </button>
      </p>
    </div>
  )
}
