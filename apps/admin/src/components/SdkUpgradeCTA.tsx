/**
 * Inline upgrade affordance beside SdkVersionBadge — copies the exact
 * `mushi upgrade` command operators should run in the consumer repo.
 */

import { useState } from 'react'
import { Btn, Tooltip } from './ui'
import { CodeInline } from './CodePanel'
import { IconCopy, IconTerminal } from './icons'
import { resolveSdkDisplay } from '../lib/sdkVersionCompare'
import type { SdkStatus } from './SdkVersionBadge'

interface SdkUpgradeCTAProps {
  package_: string | null
  observedVersion: string | null
  latestVersion: string | null
  status: SdkStatus
  /** Stack label for tooltip context (e.g. "Vite SPA"). */
  stackLabel?: string
  compact?: boolean
}

export function SdkUpgradeCTA({
  package_,
  observedVersion,
  latestVersion,
  status,
  stackLabel,
  compact = false,
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
      <Tooltip content={detail} side="top">
        <Btn size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => void copy()} aria-label="Copy mushi upgrade command">
          <IconTerminal className="h-3.5 w-3.5" aria-hidden />
          <span className="text-xs">Upgrade</span>
        </Btn>
      </Tooltip>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/25 bg-warn-muted/30 px-3 py-2">
      <IconTerminal className="h-4 w-4 text-warn shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-medium text-fg">SDK upgrade available</p>
        <p className="text-2xs text-fg-muted">{detail}</p>
        <CodeInline className="text-xs">{cmd}</CodeInline>
      </div>
      <Btn size="sm" variant="ghost" className="shrink-0 gap-1.5" onClick={() => void copy()}>
        <IconCopy className="h-3.5 w-3.5" aria-hidden />
        {copied ? 'Copied' : 'Copy cmd'}
      </Btn>
    </div>
  )
}
