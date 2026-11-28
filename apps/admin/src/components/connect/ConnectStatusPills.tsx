/**
 * FILE: apps/admin/src/components/connect/ConnectStatusPills.tsx
 * PURPOSE: The status Connect shows for each thing it connects (console
 *          journeys 2026-10-27): "Is my SDK talking to Mushi, is it current,
 *          and is my editor connected?"
 *
 *            SDK heartbeat   when the app last checked in (SDK keys only)
 *            SDK version     the version seen, with an upgrade badge when behind
 *            Editor          how many editor connections have called Mushi
 *
 *          These were three pills over the page. Since ADR 0069 Connect is one
 *          step at a time and each step row carries its own line from here,
 *          so the pills no longer render on their own.
 */

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

export function sdkIsBehind(input: Pick<ConnectPillsInput, 'sdkVersion' | 'sdkLatestVersion' | 'sdkStatus'>): boolean {
  if (input.sdkStatus === 'outdated' || input.sdkStatus === 'deprecated') return true
  return Boolean(input.sdkVersion && input.sdkLatestVersion && input.sdkVersion !== input.sdkLatestVersion)
}

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
      label: 'App checked in',
      value: heard ?? 'Not yet',
      // Quiet (1 h – 7 d) is grey; only a week of silence warns (2026-11-18).
      tone: freshness === 'healthy' ? 'ok' : freshness === 'cold' ? 'warn' : 'neutral',
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
