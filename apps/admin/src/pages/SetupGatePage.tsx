/**
 * FILE: apps/admin/src/pages/SetupGatePage.tsx
 * PURPOSE: Shown in self-hosted mode when required env vars are missing.
 *          Offers two paths:
 *            1. Connect to Mushi Mushi Cloud (zero setup)
 *            2. Bring your own Supabase project (self-hosted)
 */

import { useState } from 'react'
import type { EnvStatus } from '../lib/env'
import { CLOUD_SUPABASE_URL, CLOUD_SUPABASE_ANON_KEY } from '../lib/env'
import { PageHelp } from '../components/ui'

const CLOUD_ENV_TEMPLATE = `VITE_SUPABASE_URL=${CLOUD_SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${CLOUD_SUPABASE_ANON_KEY}`

const SELF_HOSTED_TEMPLATE = `VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
# Optional — defaults to \${VITE_SUPABASE_URL}/functions/v1/api
# VITE_API_URL=https://your-project-ref.supabase.co/functions/v1/api
# Force self-hosted mode (skips cloud fallback):
VITE_INSTANCE_TYPE=self-hosted`

export function SetupGatePage({ env }: { env: EnvStatus }) {
  const [copied, setCopied] = useState<'cloud' | 'self' | null>(null)
  const [showSelfHosted, setShowSelfHosted] = useState(false)

  function copy(text: string, which: 'cloud' | 'self') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold">
            <span className="text-brand">mushi</span>mushi
          </h1>
          <p className="text-2xs text-fg-muted mt-0.5">admin console</p>
        </div>

        <div className="mb-3">
          <PageHelp
            title="Why am I seeing this?"
            whatIsIt="The admin console can't reach a Supabase backend. You either haven't created the .env file yet, or one of the required variables is missing or empty."
            useCases={[
              'Connect to the shared Mushi Mushi Cloud (zero setup, recommended for trying it out)',
              'Bring your own Supabase project for full data sovereignty (self-hosted)',
            ]}
            howToUse="Pick one of the two options below, copy the .env values into apps/admin/.env, and restart the dev server."
          />
        </div>

        <div className="bg-surface border border-edge rounded-md p-5 space-y-4">
          {/* Cloud option — primary */}
          <div>
            <h2 className="text-sm font-semibold text-fg mb-1">Quick start with Mushi Mushi Cloud</h2>
            <p className="text-xs text-fg-muted mb-3">
              Connect to the shared cloud backend — no Supabase project needed.
              Copy these credentials into a <code className="text-2xs bg-surface-raised px-1 py-0.5 rounded">.env</code> file
              in <code className="text-2xs bg-surface-raised px-1 py-0.5 rounded">apps/admin/</code>, then restart the dev server.
            </p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">.env (cloud)</span>
                <button
                  onClick={() => copy(CLOUD_ENV_TEMPLATE, 'cloud')}
                  className="text-2xs text-brand hover:text-brand-hover transition-colors"
                >
                  {copied === 'cloud' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="bg-surface-raised border border-edge-subtle rounded-sm p-3 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap">
                {CLOUD_ENV_TEMPLATE}
              </pre>
            </div>
          </div>

          <div className="flex items-center gap-3 text-2xs text-fg-faint">
            <div className="flex-1 border-t border-edge-subtle" />
            <span>or</span>
            <div className="flex-1 border-t border-edge-subtle" />
          </div>

          {/* Self-hosted option — secondary */}
          <div>
            <button
              onClick={() => setShowSelfHosted(!showSelfHosted)}
              className="flex items-center gap-1.5 text-sm font-medium text-fg hover:text-brand transition-colors"
            >
              <span className="text-2xs">{showSelfHosted ? '▾' : '▸'}</span>
              Connect your own Supabase project
            </button>
            <p className="text-xs text-fg-muted mt-1">
              For full data sovereignty — bring your own Supabase backend.
            </p>
          </div>

          {showSelfHosted && (
            <div className="space-y-4 pl-0 border-l-2 border-brand/20 ml-1 pl-4">
              {/* Missing vars checklist */}
              <div className="space-y-1.5">
                {(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const).map((v) => {
                  const isMissing = env.missing.includes(v)
                  return (
                    <div key={v} className="flex items-center gap-2 text-xs">
                      <span className={isMissing ? 'text-danger' : 'text-ok'}>
                        {isMissing ? '✗' : '✓'}
                      </span>
                      <code className={`font-mono text-2xs ${isMissing ? 'text-danger' : 'text-fg-secondary'}`}>
                        {v}
                      </code>
                      {isMissing && <span className="text-2xs text-fg-faint">— missing</span>}
                    </div>
                  )
                })}
              </div>

              {/* .env template */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">.env (self-hosted)</span>
                  <button
                    onClick={() => copy(SELF_HOSTED_TEMPLATE, 'self')}
                    className="text-2xs text-brand hover:text-brand-hover transition-colors"
                  >
                    {copied === 'self' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="bg-surface-raised border border-edge-subtle rounded-sm p-3 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap">
                  {SELF_HOSTED_TEMPLATE}
                </pre>
              </div>

              {/* Where to find values */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-fg">Where to find these values</p>
                <ol className="text-xs text-fg-muted space-y-1.5 list-decimal list-inside">
                  <li>
                    Go to{' '}
                    <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover underline">
                      supabase.com/dashboard
                    </a>
                    {' '}and create or select a project
                  </li>
                  <li>Open <strong>Settings → API</strong> in the Supabase dashboard</li>
                  <li>Copy the <strong>Project URL</strong> → paste as <code className="text-2xs bg-surface-raised px-1 py-0.5 rounded">VITE_SUPABASE_URL</code></li>
                  <li>Copy the <strong>anon / public</strong> key → paste as <code className="text-2xs bg-surface-raised px-1 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code></li>
                </ol>
              </div>
            </div>
          )}

          {/* Refresh */}
          <div className="flex items-center justify-between pt-2 border-t border-edge-subtle">
            <p className="text-2xs text-fg-muted">
              After creating <code className="bg-surface-raised px-1 py-0.5 rounded">.env</code>, restart the dev server.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-sm bg-brand text-brand-fg hover:bg-brand-hover shadow-sm transition-all"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
