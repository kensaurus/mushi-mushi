/**
 * Inline upgrade affordance beside SdkVersionBadge.
 *
 * When `projectId` is supplied (GitHub connected), the primary action is
 * "Create Upgrade PR" (server opens a draft PR in the connected repo).
 * The copy-command fallback is always present as a secondary option.
 *
 * The "lockfile helper" disclosure hands out the host workflow from ADR 0019:
 * with it in the repo, the upgrade PR arrives with a refreshed lockfile.
 */

import { useState } from 'react'
import { Btn, Tooltip } from './ui'
import { JobStatusPill } from './ui/job-status-pill'
import { CodeInline, CodePanel } from './CodePanel'
import { IconCheck, IconCopy, IconTerminal, IconBolt, IconExternalLink } from './icons'
import { resolveSdkDisplay } from '../lib/sdkVersionCompare'
import { useSdkUpgrade } from '../lib/useSdkUpgrade'
import {
  SDK_LOCKFILE_DOCS_URL,
  SDK_LOCKFILE_WORKFLOW_PATH,
  SDK_LOCKFILE_WORKFLOW_YAML,
} from '../lib/sdkLockfileHelper'
import type { SdkStatus } from './SdkVersionBadge'

interface SdkUpgradeCTAProps {
  package_: string | null
  observedVersion: string | null
  latestVersion: string | null
  status: SdkStatus
  /** Stack label for tooltip context (e.g. "Vite SPA"). */
  stackLabel?: string
  compact?: boolean
  /** When supplied, enables the primary "Create Upgrade PR" action. */
  projectId?: string | null
}

function UpgradePrButton({
  projectId,
  compact,
}: {
  projectId: string
  compact: boolean
}) {
  const { state, createUpgradePr, refreshUpgradePr } = useSdkUpgrade(projectId)

  if (state.status === 'completed' && state.prUrl) {
    return (
      <span className="inline-flex items-center gap-1">
        <Btn size="sm" variant="ghost" href={state.prUrl} className={compact ? 'h-8 gap-1.5' : 'gap-1.5'}>
          <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span className={compact ? 'text-xs' : undefined}>View PR</span>
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          className={compact ? 'h-8 gap-1.5' : 'gap-1.5'}
          onClick={() => void refreshUpgradePr()}
          aria-label="Refresh existing upgrade PR"
        >
          <IconBolt className="h-3.5 w-3.5" aria-hidden />
          <span className={compact ? 'text-xs' : undefined}>Refresh</span>
        </Btn>
      </span>
    )
  }

  if (state.status === 'completed_no_pr') {
    return (
      <span className={`${compact ? 'text-xs' : 'text-sm'} text-ok`}>
        Already up to date ✓
      </span>
    )
  }

  if (state.status === 'failed') {
    return (
      <JobStatusPill status="failed" error={state.error} />
    )
  }

  if (state.status === 'awaiting_lockfile') {
    return <JobStatusPill status="awaiting_lockfile" />
  }

  const busy =
    state.status === 'queueing' ||
    state.status === 'queued' ||
    state.status === 'running'

  return (
    <Btn
      size="sm"
      variant={compact ? 'ghost' : 'primary'}
      className={compact ? 'h-8 gap-1.5' : 'gap-1.5'}
      onClick={() => void createUpgradePr()}
      disabled={busy}
      aria-label="Create upgrade PR"
    >
      <IconBolt className="h-3.5 w-3.5" aria-hidden />
      <span className={compact ? 'text-xs' : undefined}>
        {busy ? 'Creating PR…' : 'Create Upgrade PR'}
      </span>
    </Btn>
  )
}

/** Copy block for the host workflow that refreshes the lockfile on upgrade branches. */
export function LockfileHelperDisclosure() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SDK_LOCKFILE_WORKFLOW_YAML)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }
  return (
    <details className="w-full text-2xs text-fg-muted">
      <summary className="cursor-pointer select-none hover:text-fg">
        Upgrade PRs fail <CodeInline>npm ci</CodeInline>? Add the lockfile helper
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          Mushi edits only <CodeInline>package.json</CodeInline>. Save this workflow as{' '}
          <CodeInline>{SDK_LOCKFILE_WORKFLOW_PATH}</CodeInline> on your default branch: Mushi then pushes the
          bump first, your workflow regenerates the lockfile with your package manager, and the PR opens after
          that, so a frozen install passes.{' '}
          <a href={SDK_LOCKFILE_DOCS_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-fg">
            Docs
          </a>
        </p>
        <CodePanel
          label="Lockfile helper"
          language="yaml"
          code={SDK_LOCKFILE_WORKFLOW_YAML}
          onCopy={() => void copy()}
          copied={copied}
          maxHeight="max-h-64"
        />
      </div>
    </details>
  )
}

export function SdkUpgradeCTA({
  package_,
  observedVersion,
  latestVersion,
  status,
  stackLabel,
  compact = false,
  projectId,
}: SdkUpgradeCTAProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const resolution = resolveSdkDisplay({
    observedVersion,
    latestVersion,
    backendStatus: status,
    deprecated: status === 'deprecated',
  })

  if (resolution.kind !== 'upgrade-available' || !resolution.upgradeTarget) return null

  const pkg = package_ ?? '@mushi-mushi/web'
  const cmd = 'mushi upgrade'
  const detail =
    `Bump ${pkg} from v${observedVersion} to v${resolution.upgradeTarget}` +
    (stackLabel ? ` (${stackLabel})` : '') +
    '. Run in your app repo after saving package.json.'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopyFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: say so and show the command to copy by hand (QA bug 265).
      setCopied(false)
      setCopyFailed(true)
    }
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1">
        {projectId && <UpgradePrButton projectId={projectId} compact />}
        <Tooltip content={detail} side="top">
          <Btn size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => void copy()} aria-label="Copy mushi upgrade command">
            {copied ? <IconCheck className="h-3.5 w-3.5" aria-hidden /> : <IconTerminal className="h-3.5 w-3.5" aria-hidden />}
            <span className="text-xs" aria-live="polite">
              {copied ? 'Copied' : projectId ? 'Copy cmd' : 'Upgrade'}
            </span>
          </Btn>
        </Tooltip>
        {copyFailed && (
          <span className="text-2xs text-fg-muted" role="status">
            Copy blocked. Run <CodeInline>{cmd}</CodeInline>
          </span>
        )}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/25 bg-warn-muted/30 px-3 py-2">
      <IconTerminal className="h-4 w-4 text-warn shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-medium text-fg">SDK upgrade available</p>
        <p className="text-2xs text-fg-muted">{detail}</p>
        {!projectId && <CodeInline className="text-xs">{cmd}</CodeInline>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {projectId && <UpgradePrButton projectId={projectId} compact={false} />}
        <Tooltip content={projectId ? 'Or run manually in your repo' : detail} side="top">
          <Btn size="sm" variant="ghost" className="gap-1.5" onClick={() => void copy()}>
            <IconCopy className="h-3.5 w-3.5" aria-hidden />
            {copied ? 'Copied' : 'Copy cmd'}
          </Btn>
        </Tooltip>
        {!projectId && (
          <Btn to="/connect" size="sm" variant="ghost" className="gap-1.5">
              <IconBolt className="h-3.5 w-3.5" aria-hidden />
              Connect GitHub
            </Btn>
        )}
      </div>
      {projectId && <LockfileHelperDisclosure />}
    </div>
  )
}
