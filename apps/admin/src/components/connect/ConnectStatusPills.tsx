/**
 * FILE: apps/admin/src/components/connect/ConnectStatusPills.tsx
 * PURPOSE: The top of Connect (console journeys 2026-10-27): "Is my SDK
 *          talking to Mushi, is it current, and is my editor connected?"
 *          Three pills instead of seven tiles:
 *
 *            SDK heartbeat   when the app last checked in (SDK keys only)
 *            SDK version     the version seen, with an upgrade badge when behind
 *            Editor          how many editor connections have called Mushi
 *
 *          Each pill links to the section that fixes it. When the SDK is
 *          behind, "Upgrade the SDK" (to the Update center's upgrade PR) is the
 *          page's one primary action.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { SDK_HEALTH_ANCHOR } from '../../lib/sdkHealth'
import { relativeTime } from '../../lib/setupGuideSteps'
import { sdkFreshness } from '../../lib/heartbeat'
import type { McpStats } from '../mcp/types'
import type { SdkStatus } from '../SdkVersionBadge'

type PillTone = 'ok' | 'warn' | 'neutral'

interface ConnectPill {
  id: 'heartbeat' | 'version' | 'editor'
  label: string
  value: string
  tone: PillTone
  /** Where to fix or see it. */
  href: string
  /** Shown beside the version when a newer one exists. */
  badge?: string
}

interface ConnectPillsInput {
  sdkLastSeenAt: string | null
  sdkVersion: string | null
  sdkLatestVersion: string | null
  sdkStatus: SdkStatus | null
  mcpStats: Pick<McpStats, 'connectedKeyCount' | 'lastSeenAt'>
  now?: number
}

/** @internal Exported for tests. */
export function sdkIsBehind(input: Pick<ConnectPillsInput, 'sdkVersion' | 'sdkLatestVersion' | 'sdkStatus'>): boolean {
  if (input.sdkStatus === 'outdated' || input.sdkStatus === 'deprecated') return true
  return Boolean(input.sdkVersion && input.sdkLatestVersion && input.sdkVersion !== input.sdkLatestVersion)
}

/** @internal Exported for tests. */
export function connectPills(input: ConnectPillsInput): ConnectPill[] {
  const now = input.now ?? Date.now()
  const freshness = sdkFreshness(input.sdkLastSeenAt, now)
  const heard = relativeTime(input.sdkLastSeenAt, now)
  const behind = sdkIsBehind(input)
  const editors = input.mcpStats.connectedKeyCount
  const editorSeen = relativeTime(input.mcpStats.lastSeenAt, now)
  return [
    {
      id: 'heartbeat',
      label: 'SDK heartbeat',
      value: heard ? `Heard ${heard}` : 'Not heard yet',
      tone: freshness === 'healthy' ? 'ok' : freshness === 'never' ? 'neutral' : 'warn',
      href: `#${SDK_HEALTH_ANCHOR}`,
    },
    {
      id: 'version',
      label: 'SDK version',
      value: input.sdkVersion ?? 'Not seen yet',
      tone: !input.sdkVersion ? 'neutral' : behind ? 'warn' : 'ok',
      href: '#connect-update',
      badge: behind ? (input.sdkLatestVersion ? `${input.sdkLatestVersion} available` : 'Update available') : undefined,
    },
    {
      id: 'editor',
      label: 'Editor',
      value:
        editors > 0
          ? `${editors} connected${editorSeen ? `, last call ${editorSeen}` : ''}`
          : 'Not connected',
      tone: editors > 0 ? 'ok' : 'neutral',
      href: '#connect-studio',
    },
  ]
}

const DOT: Record<PillTone, string> = { ok: 'bg-ok', warn: 'bg-warn', neutral: 'bg-fg-faint' }

function jump(hash: string) {
  document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function ConnectStatusPills(props: ConnectPillsInput & { loading?: boolean }) {
  if (props.loading) {
    return (
      <p className="text-xs text-fg-muted" aria-busy="true" data-testid="connect-status-pills">
        Checking your SDK and editor…
      </p>
    )
  }
  const pills = connectPills(props)
  const behind = sdkIsBehind(props)
  return (
    <section aria-label="Connection status" className="flex min-w-0 flex-wrap items-center gap-2" data-testid="connect-status-pills">
      <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
        {pills.map((p) => (
          <li key={p.id} className="min-w-0">
            <Link
              to={p.href}
              onClick={(e) => {
                e.preventDefault()
                jump(p.href)
              }}
              data-pill={p.id}
              data-tone={p.tone}
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-edge-subtle bg-surface-raised px-3 py-1.5 text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[p.tone]}`} />
              <span className="shrink-0 text-fg-muted">{p.label}</span>
              <span className="min-w-0 truncate font-medium text-fg">{p.value}</span>
              {p.badge ? (
                <span className={`shrink-0 rounded-full px-1.5 py-px text-2xs font-medium ${CHIP_TONE.warnSubtle}`}>{p.badge}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      {behind ? (
        <Btn size="sm" variant="primary" onClick={() => jump('#connect-update')}>
          Upgrade the SDK
        </Btn>
      ) : null}
    </section>
  )
}
