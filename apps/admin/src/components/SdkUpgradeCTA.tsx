/**
 * Inline upgrade affordance beside SdkVersionBadge.
 *
 * When `projectId` is supplied (GitHub connected), the primary action is
 * "Create Upgrade PR" (server opens a draft PR in the connected repo).
 * The copy-command fallback is always present as a secondary option.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Tooltip } from './ui'
import { CodeInline } from './CodePanel'
import { IconCopy, IconTerminal, IconBolt, IconExternalLink } from './icons'
import { resolveSdkDisplay } from '../lib/sdkVersionCompare'
import { useSdkUpgrade } from '../lib/useSdkUpgrade'
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
  const { state, createUpgradePr } = useSdkUpgrade(projectId)

  if (state.status === 'completed' && state.prUrl) {
    return (
      <a href={state.prUrl} target="_blank" rel="noopener noreferrer">
        <Btn size="sm" variant="ghost" className={compact ? 'h-8 gap-1.5' : 'gap-1.5'}>
          <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span className={compact ? 'text-xs' : undefined}>View PR</span>
        </Btn>
      </a>
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
      <Tooltip content={state.error ?? 'Upgrade failed'} side="top">
        <span className={`${compact ? 'text-xs' : 'text-sm'} text-[var(--color-error-foreground)]`}>
          Upgrade failed
        </span>
      </Tooltip>
    )
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
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1">
        {projectId && <UpgradePrButton projectId={projectId} compact />}
        <Tooltip content={detail} side="top">
          <Btn size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => void copy()} aria-label="Copy mushi upgrade command">
            <IconTerminal className="h-3.5 w-3.5" aria-hidden />
            <span className="text-xs">{projectId ? 'Copy cmd' : 'Upgrade'}</span>
          </Btn>
        </Tooltip>
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
          <Link to="/connect">
            <Btn size="sm" variant="ghost" className="gap-1.5">
              <IconBolt className="h-3.5 w-3.5" aria-hidden />
              Connect GitHub
            </Btn>
          </Link>
        )}
      </div>
    </div>
  )
}
