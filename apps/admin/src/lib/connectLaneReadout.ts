/**
 * FILE: connectLaneReadout.ts
 * PURPOSE: Single-sentence lane readout copy for Connect pipeline — avoids looping
 *          actionLine + plain + summary into the same message twice.
 */

import type { StepNodeData } from '../components/connect/ConnectStepFlow'
import type { WorkflowPosture } from './guideLiveOverlay'
import { CHIP_TONE } from './chipTone'

const DONE_BLURB: Record<string, string> = {
  github: 'Your repo is linked and ready for upgrade PRs.',
  sdk: 'Your app is sending reports to this project.',
  mcp: 'Your editor can call Mushi tools from the IDE.',
  cli: 'Install anytime — handy for terminal workflows.',
  upgrade: 'SDK packages match the latest npm release.',
  native_ci: 'Native build secrets are configured.',
}

export function resolveLaneOverlayPosture(lane: StepNodeData): WorkflowPosture {
  if (typeof lane.overlayPosture === 'string') return lane.overlayPosture
  if (lane.posture === 'current') return 'open'
  return lane.posture
}

/** One body line — never stacks actionLine on top of plain. */
export function pickConnectLaneBody(lane: StepNodeData, overlayPosture: WorkflowPosture): string {
  const installed = lane.facts?.find((f) => f.label === 'Installed')?.value
  const latest = lane.facts?.find((f) => f.label === 'Latest')?.value

  if (lane.laneId === 'upgrade' && installed && latest && installed !== latest) {
    return `You're on ${installed} — npm has ${latest}. Create an upgrade PR to bump packages.`
  }

  if (overlayPosture === 'clear' || overlayPosture === 'ok') {
    if (lane.laneId === 'upgrade' && installed && latest && installed === latest) {
      return `${installed} matches npm — nothing to bump.`
    }
    if (lane.laneId === 'sdk' && installed && installed !== '—') {
      const heartbeat = lane.facts?.find((f) => f.label === 'Heartbeat')?.value
      return heartbeat && heartbeat !== 'None yet'
        ? `SDK ${installed} is live (${heartbeat.toLowerCase()}).`
        : `SDK ${installed} is installed in your app.`
    }
    return DONE_BLURB[lane.laneId ?? ''] ?? `${lane.shortLabel} is set up.`
  }
  if (lane.actionLine?.trim()) return lane.actionLine.trim()
  return lane.plain?.trim() ?? ''
}

export interface ConnectLaneReadoutModel {
  title: string
  statusLabel: string
  statusTone: WorkflowPosture
  body: string
  isNext: boolean
  borderAccent: string
  chipClass: string
}

const CHIP: Record<WorkflowPosture, string> = {
  clear: `${CHIP_TONE.okSubtle}`,
  ok: `${CHIP_TONE.okSubtle}`,
  open: 'bg-warn-muted/40 text-warning-foreground border-warn/30',
  warn: 'bg-warn-muted/40 text-warning-foreground border-warn/30',
  danger: `${CHIP_TONE.dangerSubtle}`,
  info: `${CHIP_TONE.infoSubtle}`,
}

const BORDER: Record<WorkflowPosture, string> = {
  clear: 'border-l-ok',
  ok: 'border-l-ok',
  open: 'border-l-warn',
  warn: 'border-l-warn',
  danger: 'border-l-danger',
  info: 'border-l-info',
}

export function buildConnectLaneReadout(lane: StepNodeData): ConnectLaneReadoutModel {
  const statusTone = resolveLaneOverlayPosture(lane)
  const statusLabel = lane.metric ?? (statusTone === 'clear' || statusTone === 'ok' ? 'Done' : 'Pending')
  const isNext = lane.posture === 'current'
  const borderAccent = isNext ? 'border-l-brand' : BORDER[statusTone]

  return {
    title: lane.shortLabel,
    statusLabel,
    statusTone,
    body: pickConnectLaneBody(lane, statusTone),
    isNext,
    borderAccent,
    chipClass: CHIP[statusTone],
  }
}
