/**
 * FILE: apps/admin/src/components/CliSetupGuide.tsx
 * PURPOSE: Reusable 1-2-3 setup strip linking console steps to CLI commands.
 *
 * OVERVIEW:
 * - Plain-language steps: create project → mint key → run CLI
 * - Deep links to onboarding/projects/connect tabs
 * - Optional copyable CLI command when project id is known
 *
 * USAGE:
 * - ConnectPage, Onboarding overview, Projects empty state
 */

import { Link } from 'react-router-dom'
import { CopyButton } from './ui'
import { CodeInline } from './CodePanel'
import { buildMushiConnectCommand } from '../lib/cliSetupCommands'

interface Props {
  projectId?: string | null
  sdkInstalled?: boolean
  className?: string
}

const STEPS = [
  {
    n: 1,
    title: 'Create a project',
    body: 'Name your app — one project holds all bugs and keys for that product.',
    to: '/onboarding?tab=steps&setup=cli',
  },
  {
    n: 2,
    title: 'Generate an API key',
    body: 'Generate a report key on the Verify tab. Copy it immediately — shown once.',
    to: '/onboarding?tab=verify',
  },
  {
    n: 3,
    title: 'Run npx mushi-mushi in your app',
    body: 'The wizard detects your framework, signs in via browser, and writes .env.local — no copy-paste.',
    to: '/onboarding?tab=sdk',
  },
] as const

export function CliSetupGuide({ projectId, sdkInstalled = false, className = '' }: Props) {
  const connectCmd = projectId
    ? buildMushiConnectCommand(projectId)
    : 'npx mushi-mushi   # run in your app repo'

  const step3Link = sdkInstalled ? '/connect' : '/onboarding?tab=sdk'

  return (
    <section
      className={`rounded-md border border-edge-subtle bg-surface-raised/40 p-4 ${className}`}
      aria-label="CLI setup steps"
      data-testid="cli-setup-guide"
    >
      <h3 className="text-sm font-semibold text-fg">Set up the SDK</h3>
      <p className="mt-1 text-xs text-fg-muted">
        Run <span className="font-mono">npx mushi-mushi</span> in your app repo — the wizard handles everything.
      </p>
      <ol className="mt-4 space-y-3">
        {STEPS.map((step) => {
          const to = step.n === 3 ? step3Link : step.to
          return (
            <li key={step.n} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-2xs font-bold text-brand border border-brand/28">
                {step.n}
              </span>
              <div className="min-w-0">
                <Link to={to} className="text-xs font-semibold text-fg hover:underline">
                  {step.title}
                </Link>
                <p className="text-2xs text-fg-muted">{step.body}</p>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 flex items-start gap-2 rounded-md border border-edge-subtle bg-surface px-3 py-2">
        <CodeInline className="min-w-0 flex-1 break-all text-2xs">{connectCmd}</CodeInline>
        <CopyButton value={connectCmd} label="Copy CLI command" data-testid="cli-setup-guide-copy" />
      </div>
      <p className="mt-2 text-2xs text-fg-faint">
        The verification code shown in your terminal belongs in the browser — do not paste it into the shell.
      </p>
    </section>
  )
}
