/**
 * Maps live stats posture to workflow stage row presentation.
 * Keeps guide rows aligned with StatusBanner / PageHero without duplicating page logic.
 */

export type WorkflowPosture = 'clear' | 'open' | 'warn' | 'danger' | 'info' | 'ok'

export interface WorkflowStageOverlay {
  posture: WorkflowPosture
  metric?: string
  actionLine?: string
  actionHref?: string
}

/** Inbox PDCA stage open flags → row overlay. */
export function inboxStageOverlay(
  stageId: string,
  stats: {
    openPlan: boolean
    openDo: boolean
    openCheck: boolean
    openAct: boolean
    openOps: boolean
  },
): WorkflowStageOverlay {
  const open =
    (stageId === 'plan' && stats.openPlan) ||
    (stageId === 'do' && stats.openDo) ||
    (stageId === 'check' && stats.openCheck) ||
    (stageId === 'act' && stats.openAct) ||
    (stageId === 'ops' && stats.openOps)

  if (!open) {
    return { posture: 'clear', metric: 'Clear' }
  }

  return {
    posture: stageId === 'ops' ? 'warn' : 'open',
    metric: 'Open',
    actionLine: 'Work this stage before moving on.',
  }
}

/** Fixes lifecycle stage overlay from aggregate stats. */
export function fixesStageOverlay(
  stageId: string,
  stats: {
    failed: number
    inProgress: number
    prsOpen: number
    prsCiPassing: number
    topPriority: string
    topPriorityLabel: string | null
    topPriorityTo: string | null
  },
): WorkflowStageOverlay {
  switch (stageId) {
    case 'dispatch':
      if (stats.inProgress > 0) {
        return {
          posture: 'info',
          metric: `${stats.inProgress} running`,
        }
      }
      if (stats.topPriority === 'failed' || stats.failed > 0) {
        return {
          posture: 'danger',
          metric: stats.failed > 0 ? `${stats.failed} failed` : 'Failed',
          actionLine: stats.topPriorityLabel ?? undefined,
          actionHref: stats.topPriorityTo ?? undefined,
        }
      }
      return { posture: 'clear', metric: 'Idle' }
    case 'draft_pr':
      if (stats.prsOpen > 0) {
        return {
          posture: 'open',
          metric: `${stats.prsOpen} open`,
        }
      }
      return { posture: 'clear', metric: 'None' }
    case 'ci':
      if (stats.prsOpen > 0 && stats.prsCiPassing < stats.prsOpen) {
        const failing = stats.prsOpen - stats.prsCiPassing
        return {
          posture: 'warn',
          metric: `${failing} failing`,
          actionLine: stats.topPriority === 'waiting' ? stats.topPriorityLabel ?? undefined : undefined,
          actionHref: stats.topPriority === 'waiting' ? stats.topPriorityTo ?? undefined : undefined,
        }
      }
      if (stats.prsCiPassing > 0) {
        return { posture: 'ok' as WorkflowPosture, metric: `${stats.prsCiPassing} green` }
      }
      return { posture: 'clear', metric: '—' }
    case 'merge':
      if (stats.topPriority === 'waiting' && stats.prsCiPassing > 0) {
        return {
          posture: 'open',
          metric: 'Ready',
          actionLine: stats.topPriorityLabel ?? undefined,
          actionHref: stats.topPriorityTo ?? undefined,
        }
      }
      return { posture: 'clear', metric: '—' }
    default:
      return { posture: 'clear' }
  }
}

/** Connect setup lane overlay. */
export function connectLaneOverlay(
  laneId: string,
  flags: {
    githubConnected: boolean
    sdkConnected: boolean
    mcpConnected?: boolean
    cliConnected?: boolean
    upgradeComplete?: boolean
    nativeCiNeedsAttention?: boolean
  },
): WorkflowStageOverlay {
  if (laneId === 'github') {
    return flags.githubConnected
      ? { posture: 'clear', metric: 'Connected' }
      : { posture: 'open', metric: 'Not connected', actionLine: 'Connect GitHub first.' }
  }
  if (laneId === 'sdk') {
    return flags.sdkConnected
      ? { posture: 'clear', metric: 'Installed' }
      : {
          posture: flags.githubConnected ? 'open' : 'info',
          metric: 'Missing',
          actionLine: flags.githubConnected ? 'Install the SDK in your repo.' : 'Connect GitHub first.',
        }
  }
  if (laneId === 'mcp') {
    if (flags.mcpConnected) {
      return { posture: 'clear', metric: 'Configured' }
    }
    return {
      posture: flags.sdkConnected ? 'open' : 'info',
      metric: flags.sdkConnected ? 'Not set up' : 'After SDK',
      actionLine: flags.sdkConnected
        ? 'Add MCP to your editor after SDK install.'
        : 'Connect GitHub and install the SDK first.',
    }
  }
  if (laneId === 'cli') {
    if (flags.cliConnected) {
      return { posture: 'clear', metric: 'Available' }
    }
    return {
      posture: flags.sdkConnected ? 'info' : 'clear',
      metric: 'Optional',
      actionLine: flags.sdkConnected ? 'Install the CLI for terminal workflows.' : undefined,
    }
  }
  if (laneId === 'upgrade') {
    if (flags.upgradeComplete) {
      return { posture: 'clear', metric: 'Up to date' }
    }
    return {
      posture: flags.sdkConnected && flags.githubConnected ? 'warn' : 'info',
      metric: flags.sdkConnected ? 'Versions drift' : 'After SDK',
      actionLine: flags.sdkConnected
        ? 'Bump @mushi-mushi/* when npm publishes new SDKs.'
        : undefined,
    }
  }
  if (laneId === 'native_ci') {
    if (flags.nativeCiNeedsAttention) {
      return {
        posture: 'warn',
        metric: 'Needs secrets',
        actionLine: 'Native builds need CI env vars baked at compile time.',
      }
    }
    return flags.sdkConnected
      ? { posture: 'clear', metric: 'OK' }
      : { posture: 'info', metric: 'After SDK' }
  }
  return { posture: 'clear' }
}

/** Dashboard PDCA stage overlay from live counts. */
export function dashboardStageOverlay(
  _stageId: string,
  count: number,
): WorkflowStageOverlay {
  if (count <= 0) {
    return { posture: 'clear', metric: 'Clear' }
  }
  return {
    posture: count >= 5 ? 'warn' : 'open',
    metric: `${count} open`,
  }
}
