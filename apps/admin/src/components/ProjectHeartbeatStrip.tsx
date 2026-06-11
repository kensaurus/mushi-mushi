/**
 * FILE: apps/admin/src/components/ProjectHeartbeatStrip.tsx
 * PURPOSE: One-line SDK heartbeat readout for the project switcher dropdown.
 *          Surfaces last-seen time + origin with a rich tooltip.
 */

import type { SetupProject } from '../lib/useSetupStatus'
import { summarizeProjectHeartbeat } from '../lib/resolveProjectDomain'
import { MetricTooltipContent, Tooltip, type MetricTooltipData } from './ui'

const TONE_DOT: Record<
  ReturnType<typeof summarizeProjectHeartbeat>['tone'],
  string
> = {
  live: 'bg-ok',
  stale: 'bg-warn',
  mismatch: 'bg-warn motion-safe:animate-pulse',
  none: 'bg-fg-faint/50',
}

const TONE_TEXT: Record<
  ReturnType<typeof summarizeProjectHeartbeat>['tone'],
  string
> = {
  live: 'text-fg-muted',
  stale: 'text-warn',
  mismatch: 'text-warn',
  none: 'text-fg-faint',
}

interface ProjectHeartbeatStripProps {
  project: SetupProject
  adminEndpointHost?: string | null
}

function buildHeartbeatTooltip(
  heartbeat: ReturnType<typeof summarizeProjectHeartbeat>,
  adminEndpointHost?: string | null,
): MetricTooltipData {
  if (heartbeat.tone === 'none') {
    return {
      sections: [
        {
          kind: 'shows',
          label: 'SDK heartbeat',
          body: 'No API key from this project has reached the backend yet. Install the SDK and load a page with the widget to populate this signal.',
        },
      ],
      callout: { tone: 'warn', text: 'Generate a key on the Projects page, then embed the SDK in your app.' },
    }
  }

  const sections: MetricTooltipData['sections'] = [
    {
      kind: 'shows',
      label: 'Last seen',
      body: heartbeat.ago
        ? `The SDK last authenticated ${heartbeat.ago}.`
        : 'The SDK has connected at least once.',
    },
  ]

  if (heartbeat.origin) {
    sections.push({
      kind: 'counted',
      label: 'Origin',
      body: `Reports are arriving from ${heartbeat.origin} — usually your production or staging URL.`,
    })
  }

  if (adminEndpointHost) {
    sections.push({
      kind: 'takeaway',
      label: 'Backend',
      body: `This admin reads from ${adminEndpointHost}. If the SDK points at a different host, the setup checklist stays red even when the widget works.`,
    })
  }

  return {
    sections,
    callout:
      heartbeat.tone === 'mismatch'
        ? { tone: 'warn', text: 'Host mismatch — your SDK and this admin may be on different backends.' }
        : heartbeat.tone === 'stale'
          ? { tone: 'warn', text: 'Heartbeat is stale — confirm the SDK is still embedded and the API key is active.' }
          : { tone: 'ok', text: 'SDK is actively reaching this backend.' },
  }
}

export function ProjectHeartbeatStrip({ project, adminEndpointHost }: ProjectHeartbeatStripProps) {
  const heartbeat = summarizeProjectHeartbeat(project, adminEndpointHost)
  const tooltip = buildHeartbeatTooltip(heartbeat, adminEndpointHost)

  if (heartbeat.tone === 'none') {
    return (
      <Tooltip content={<MetricTooltipContent data={tooltip} />} side="left" nowrap={false} portal>
        <span className="mt-0.5 flex cursor-help items-center gap-1 truncate text-3xs text-fg-faint">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT.none}`} />
          <span>SDK not seen yet</span>
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={<MetricTooltipContent data={tooltip} />} side="left" nowrap={false} portal>
      <span
        className={`mt-0.5 flex cursor-help items-center gap-1 truncate text-3xs ${TONE_TEXT[heartbeat.tone]}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[heartbeat.tone]}`} />
        <span className="shrink-0 font-medium">SDK</span>
        {heartbeat.ago && <span className="shrink-0 tabular-nums">{heartbeat.ago}</span>}
        {heartbeat.origin && (
          <>
            <span aria-hidden className="text-fg-faint shrink-0">·</span>
            <span className="truncate font-mono text-fg-faint">{heartbeat.origin}</span>
          </>
        )}
        {heartbeat.tone === 'mismatch' && (
          <span className="shrink-0 rounded bg-warn/15 px-1 py-px text-3xs font-medium text-warn">
            host mismatch
          </span>
        )}
      </span>
    </Tooltip>
  )
}
