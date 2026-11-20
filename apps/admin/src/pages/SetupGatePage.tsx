/**
 * FILE: apps/admin/src/pages/SetupGatePage.tsx
 * PURPOSE: Shown in self-hosted mode when the console has no backend address
 *          (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing), e.g. the
 *          published Docker image or a static build made without them.
 *
 *          What is wrong → why → one button:
 *            1. Connect this browser (primary): paste the Supabase URL and
 *               anon key; kept in this browser, works for any build.
 *            2. Bake them in: the copyable block for how the console is
 *               served (static build, Docker image, Compose, dev server).
 *               Builds read VITE_* at build time, so a restart never helps.
 *            3. Escape hatch: use Mushi Mushi Cloud instead.
 */

import { useState } from 'react'
import type { EnvStatus } from '../lib/env'
import { saveAndApplyInstanceConfig } from '../lib/env'
import { backendFormErrors, consoleConfigBlock, CONSOLE_HOSTING_OPTIONS, type BackendValues, type ConsoleHosting } from '../lib/setupGate'
import { Btn, CopyButton, Input, SegmentedControl } from '../components/ui'
import { StatusMark } from '../components/signal/StatusMark'

const SELF_HOST_DOCS = 'https://kensaur.us/mushi-mushi/docs/self-hosting'

export function SetupGatePage({ env }: { env: EnvStatus }) {
  const [values, setValues] = useState<BackendValues>({ supabaseUrl: '', anonKey: '' })
  const [errors, setErrors] = useState<ReturnType<typeof backendFormErrors>>({})
  const [hosting, setHosting] = useState<ConsoleHosting>('static')
  const block = consoleConfigBlock(hosting, values)

  function connect() {
    const next = backendFormErrors(values)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    saveAndApplyInstanceConfig({ mode: 'self-hosted', supabaseUrl: values.supabaseUrl, supabaseAnonKey: values.anonKey })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
      <div className="w-full max-w-lg space-y-3">
        <h1 className="text-center text-xl font-bold">
          <span className="text-brand">mushi</span>mushi
        </h1>

        <div className="bg-surface border border-edge rounded-md p-4 space-y-3" data-testid="setup-gate">
          <div className="flex items-start gap-2">
            <StatusMark status="failed" label="Not connected" className="mt-1" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">This console does not know where your Mushi Mushi server is.</p>
              <p className="text-xs text-fg-secondary">
                It was built without{' '}
                {env.missing.map((v, i) => (
                  <span key={v}>
                    {i > 0 ? ' and ' : ''}
                    <code className="font-mono text-2xs">{v}</code>
                  </span>
                ))}
                . Paste them here, or bake them into the build below.
              </p>
            </div>
          </div>

          {/* 1. Connect this browser */}
          <div className="space-y-2" data-testid="setup-gate-connect">
            <Input
              label="Supabase project URL"
              placeholder="https://<ref>.supabase.co, or http://localhost for Compose"
              value={values.supabaseUrl}
              onChange={(e) => setValues({ ...values, supabaseUrl: e.target.value })}
              error={errors.supabaseUrl}
            />
            <Input
              label="Anon (public) key"
              placeholder="eyJhbGci…"
              value={values.anonKey}
              onChange={(e) => setValues({ ...values, anonKey: e.target.value })}
              error={errors.anonKey}
            />
            <p className="text-2xs text-fg-muted">
              Supabase: Project Settings → API. Compose: <code className="font-mono">MUSHI_PUBLIC_URL</code> and{' '}
              <code className="font-mono">SUPABASE_ANON_KEY</code> in <code className="font-mono">deploy/.env</code>. The anon key is public; the
              service-role key never goes here.
            </p>
            <Btn variant="primary" onClick={connect}>
              Connect this browser
            </Btn>
          </div>

          {/* 2. Bake it into the build */}
          <details className="group border-t border-edge-subtle pt-2" data-testid="setup-gate-build">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-fg-secondary hover:text-fg">
              <span aria-hidden className="text-fg-faint transition-transform group-open:rotate-90">▸</span>
              Bake the address into the console instead
            </summary>
            <div className="mt-2 space-y-2">
              <SegmentedControl
                ariaLabel="How the console is served"
                size="sm"
                wrap
                value={hosting}
                options={CONSOLE_HOSTING_OPTIONS}
                onChange={setHosting}
              />
              <p className="text-xs text-fg-secondary">{block.when}</p>
              <div className="relative">
                <pre
                  className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm p-3 pr-10 text-2xs font-mono overflow-x-auto whitespace-pre-wrap"
                  data-testid="setup-gate-block"
                >
                  {block.code}
                </pre>
                <div className="absolute right-1.5 top-1.5">
                  <CopyButton value={block.code} label="Copy commands" />
                </div>
              </div>
            </div>
          </details>

          <div className="flex items-center justify-between gap-2 border-t border-edge-subtle pt-2 flex-wrap">
            <a href={SELF_HOST_DOCS} target="_blank" rel="noopener noreferrer" className="text-2xs text-fg-muted underline hover:text-fg">
              Self-hosting guide
            </a>
            {/* Escape hatch: switch to Cloud via localStorage, so recovering from an
                accidental self-hosted pick needs no devtools. */}
            <Btn variant="ghost" size="sm" onClick={() => saveAndApplyInstanceConfig({ mode: 'cloud' })}>
              Use Mushi Mushi Cloud instead
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
