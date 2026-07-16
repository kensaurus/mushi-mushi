/**
 * FILE: apps/admin/src/components/ProjectSdkOriginButton.tsx
 * PURPOSE: Header chip for the active project's live SDK origin (e.g.
 *          localhost, staging, production). Keeps long hostnames out of the
 *          project switcher rows while staying one click away.
 */

import { useCallback, useState } from 'react'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'
import {
  formatHeartbeatOrigin,
  sdkDiagnosticFromSetupProject,
  summarizeProjectHeartbeat,
} from '../lib/resolveProjectDomain'
import { MetricTooltipContent, Tooltip } from './ui'

function isLocalOrigin(origin: string | null): boolean {
  if (!origin?.trim()) return false
  try {
    const url = new URL(origin.includes('://') ? origin : `https://${origin}`)
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
  } catch {
    return false
  }
}

function shortHostLabel(origin: string | null, adminHost: string | null): string | null {
  if (origin) {
    const formatted = formatHeartbeatOrigin(origin)
    if (formatted) return formatted.split('/')[0] ?? formatted
  }
  if (adminHost) return adminHost.split(':')[0] ?? adminHost
  return null
}

function originHref(origin: string | null): string | null {
  if (!origin?.trim()) return null
  try {
    const url = new URL(origin.includes('://') ? origin : `https://${origin}`)
    return url.href
  } catch {
    return null
  }
}

export function ProjectSdkOriginButton() {
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const [copied, setCopied] = useState(false)

  const active = setup.activeProject
  const adminHost = setup.data?.admin_endpoint_host ?? null
  const diagnostic = active ? sdkDiagnosticFromSetupProject(active) : null
  const heartbeat = active ? summarizeProjectHeartbeat(active, adminHost) : null
  const rawOrigin = diagnostic?.last_sdk_origin ?? null
  const isLocal = isLocalOrigin(rawOrigin)
  const label = shortHostLabel(rawOrigin, adminHost)
  const href = originHref(rawOrigin)

  const handleClick = useCallback(async () => {
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    const text = rawOrigin ?? adminHost
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }, [href, rawOrigin, adminHost])

  if (setup.loading || !label) return null

  const tooltipSections = [
    {
      kind: 'shows' as const,
      label: 'SDK origin',
      body: rawOrigin
        ? `Reports are arriving from ${formatHeartbeatOrigin(rawOrigin) ?? rawOrigin}.`
        : 'No SDK origin heartbeat yet for this project.',
    },
    ...(adminHost
      ? [
          {
            kind: 'takeaway' as const,
            label: 'Admin backend',
            body: `This console reads from ${adminHost}.`,
          },
        ]
      : []),
  ]

  const callout =
    heartbeat?.tone === 'mismatch'
      ? { tone: 'warn' as const, text: 'SDK and admin are on different backends.' }
      : heartbeat?.tone === 'none'
        ? { tone: 'warn' as const, text: 'Load a page with the SDK to populate this signal.' }
        : heartbeat?.tone === 'stale'
          ? { tone: 'warn' as const, text: 'SDK heartbeat is stale.' }
          : { tone: 'ok' as const, text: href ? 'Click to open in a new tab.' : 'Click to copy.' }

  return (
    <Tooltip
      content={
        <MetricTooltipContent
          data={{
            sections: tooltipSections,
            callout,
          }}
        />
      }
      side="bottom"
      nowrap={false}
      portal
    >
      <button
        type="button"
        onClick={() => void handleClick()}
        className="inline-flex max-w-[9rem] items-center gap-1 rounded-sm border border-edge-subtle bg-surface-raised/50 px-2 py-1 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        aria-label={`SDK origin: ${isLocal ? 'local development' : label}${copied ? ' (copied)' : ''}`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            heartbeat?.tone === 'live'
              ? 'bg-ok'
              : heartbeat?.tone === 'mismatch' || heartbeat?.tone === 'stale'
                ? 'bg-warn motion-safe:animate-pulse'
                : 'bg-fg-faint/50'
          }`}
        />
        {copied ? (
          <span className="text-3xs font-medium text-fg-muted">Copied</span>
        ) : isLocal ? (
          <span className="rounded-sm border border-edge-subtle bg-surface-overlay px-1.5 py-px text-3xs font-medium leading-none text-fg-secondary">
            Local
          </span>
        ) : (
          <span className="truncate font-mono">{label}</span>
        )}
        {href && !copied && <span aria-hidden className="shrink-0 text-fg-faint">↗</span>}
      </button>
    </Tooltip>
  )
}
