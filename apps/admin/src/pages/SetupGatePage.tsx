/**
 * FILE: apps/admin/src/pages/SetupGatePage.tsx
 * PURPOSE: Shown in self-hosted mode when required env vars are missing.
 *          Offers two paths:
 *            1. Connect to Mushi Mushi Cloud (zero setup)
 *            2. Bring your own Supabase project (self-hosted)
 */

import { useState } from 'react'
import type { EnvStatus } from '../lib/env'
import { CLOUD_SUPABASE_URL, CLOUD_SUPABASE_ANON_KEY, saveAndApplyInstanceConfig } from '../lib/env'
import { PageHelpBanner, Btn, CopyButton } from '../components/ui'
import { ContainedBlock, InlineProof, SignalChip, ActionPill } from '../components/report-detail/ReportSurface'

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
          <SignalChip tone="neutral" className="mt-1.5">admin console</SignalChip>
        </div>

        <div className="mb-3">
          <PageHelpBanner
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
            <ContainedBlock tone="muted" className="mb-3">
              <InlineProof className="border-0 bg-transparent px-0 py-0 text-xs leading-relaxed">
                Connect to the shared cloud backend — no Supabase project needed.
                Copy these credentials into a{' '}
                <SignalChip tone="neutral" className="font-mono text-2xs">.env</SignalChip>
                file in{' '}
                <SignalChip tone="neutral" className="font-mono text-2xs">apps/admin/</SignalChip>
                , then restart the dev server.
              </InlineProof>
            </ContainedBlock>
            <div>
              <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                <SignalChip tone="neutral" className="uppercase tracking-wider font-medium">
                  .env (cloud)
                </SignalChip>
                <CopyButton
                  onCopy={() => copy(CLOUD_ENV_TEMPLATE, 'cloud')}
                  copied={copied === 'cloud'}
                  label="Copy cloud .env block"
                  copiedLabel=".env block copied"
                />
              </div>
              <pre className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm p-3 text-2xs font-mono overflow-x-auto whitespace-pre-wrap">
                {CLOUD_ENV_TEMPLATE}
              </pre>
            </div>
          </div>

          <div className="flex items-center gap-3 text-2xs">
            <div className="flex-1 border-t border-edge-subtle" />
            <SignalChip tone="neutral">or</SignalChip>
            <div className="flex-1 border-t border-edge-subtle" />
          </div>

          {/* Self-hosted option — secondary */}
          <div>
            <ActionPill onClick={() => setShowSelfHosted(!showSelfHosted)}>
              {showSelfHosted ? '▾' : '▸'} Connect your own Supabase project
            </ActionPill>
            <ContainedBlock tone="muted" className="mt-1">
              <InlineProof className="border-0 bg-transparent px-0 py-0 text-xs leading-relaxed">
                For full data sovereignty — bring your own Supabase backend.
              </InlineProof>
            </ContainedBlock>
          </div>

          {showSelfHosted && (
            <div className="space-y-4 pl-0 border-l-2 border-brand/20 ml-1 pl-4">
              {/* Missing vars checklist */}
              <div className="space-y-1.5">
                {(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const).map((v) => {
                  const isMissing = env.missing.includes(v)
                  return (
                    <div key={v} className="flex items-center gap-2 text-xs flex-wrap">
                      <SignalChip tone={isMissing ? 'danger' : 'ok'}>
                        {isMissing ? 'Missing' : 'Set'}
                      </SignalChip>
                      <code className={`font-mono text-2xs ${isMissing ? 'text-danger' : 'text-fg-secondary'}`}>
                        {v}
                      </code>
                    </div>
                  )
                })}
              </div>

              {/* .env template */}
              <div>
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <SignalChip tone="neutral" className="uppercase tracking-wider font-medium">
                    .env (self-hosted)
                  </SignalChip>
                  <CopyButton
                    onCopy={() => copy(SELF_HOSTED_TEMPLATE, 'self')}
                    copied={copied === 'self'}
                    label="Copy self-hosted .env block"
                    copiedLabel=".env block copied"
                  />
                </div>
                <pre className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm p-3 text-2xs font-mono overflow-x-auto whitespace-pre-wrap">
                  {SELF_HOSTED_TEMPLATE}
                </pre>
              </div>

              {/* Where to find values */}
              <ContainedBlock tone="muted" className="space-y-2">
                <SignalChip tone="neutral">Where to find these values</SignalChip>
                <ol className="text-xs text-fg-secondary space-y-1.5 list-decimal list-inside">
                  <li>
                    Go to{' '}
                    <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover underline">
                      supabase.com/dashboard
                    </a>
                    {' '}and create or select a project
                  </li>
                  <li>Open <strong>Settings → API</strong> in the Supabase dashboard</li>
                  <li>
                    Copy the <strong>Project URL</strong> → paste as{' '}
                    <SignalChip tone="brand" className="font-mono text-2xs">VITE_SUPABASE_URL</SignalChip>
                  </li>
                  <li>
                    Copy the <strong>anon / public</strong> key → paste as{' '}
                    <SignalChip tone="brand" className="font-mono text-2xs">VITE_SUPABASE_ANON_KEY</SignalChip>
                  </li>
                </ol>
              </ContainedBlock>
            </div>
          )}

          {/* Refresh + escape hatch */}
          <div className="flex items-center justify-between pt-2 border-t border-edge-subtle gap-3 flex-wrap">
            <InlineProof>
              After creating <code className="bg-surface-raised px-1 py-0.5 rounded">.env</code>, restart the dev server.
            </InlineProof>
            <div className="flex items-center gap-2 shrink-0">
              {/* Escape hatch: switch to cloud via localStorage so the user
                  doesn't need devtools to recover from an accidental self-hosted
                  selection when no env vars are set. saveAndApplyInstanceConfig
                  stores mode=cloud, clears any stored URL/key, and reloads. */}
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => saveAndApplyInstanceConfig({ mode: 'cloud' })}
              >
                Use Mushi Cloud instead
              </Btn>
              <Btn variant="primary" onClick={() => window.location.reload()}>
                Refresh
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
