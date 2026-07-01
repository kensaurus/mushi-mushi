/**
 * Maps live stats posture to workflow stage row presentation.
 * Keeps guide rows aligned with StatusBanner / PageHero without duplicating page logic.
 */

import { pluralizeWithCount } from './format'

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
      ? { posture: 'clear', metric: 'Linked' }
      : { posture: 'open', metric: 'Not linked', actionLine: 'Connect your GitHub repo to continue.' }
  }
  if (laneId === 'sdk') {
    return flags.sdkConnected
      ? { posture: 'clear', metric: 'Live' }
      : {
          posture: flags.githubConnected ? 'open' : 'info',
          metric: 'Not installed',
          actionLine: flags.githubConnected
            ? 'Copy the SDK snippet into your app.'
            : 'Link GitHub first, then add the SDK.',
        }
  }
  if (laneId === 'mcp') {
    if (flags.mcpConnected) {
      return { posture: 'clear', metric: 'In IDE' }
    }
    return {
      posture: flags.sdkConnected ? 'open' : 'info',
      metric: flags.sdkConnected ? 'Not in IDE' : 'After SDK',
      actionLine: flags.sdkConnected
        ? 'Add MCP to Cursor or VS Code.'
        : 'Finish GitHub and SDK first.',
    }
  }
  if (laneId === 'cli') {
    if (flags.cliConnected) {
      return { posture: 'clear', metric: 'Installed' }
    }
    return {
      posture: flags.sdkConnected ? 'info' : 'clear',
      metric: 'Optional',
    }
  }
  if (laneId === 'upgrade') {
    if (flags.upgradeComplete) {
      return { posture: 'clear', metric: 'Up to date' }
    }
    return {
      posture: flags.sdkConnected && flags.githubConnected ? 'warn' : 'info',
      metric: flags.sdkConnected ? 'Update available' : 'After SDK',
      actionLine: flags.sdkConnected && flags.githubConnected
        ? 'Create an upgrade PR when npm publishes a newer SDK.'
        : undefined,
    }
  }
  if (laneId === 'native_ci') {
    if (flags.nativeCiNeedsAttention) {
      return {
        posture: 'warn',
        metric: 'Needs setup',
        actionLine: 'Sync MUSHI_* secrets into GitHub Actions for native builds.',
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

/** Health probe tab overlay from live stats. */
export function healthProbeOverlay(
  tabId: string,
  stats: {
    errorRatePct: number
    cronErrorCount: number
    cronStaleCount: number
    cronWarnCount: number
    redCount: number
    topPriority: string
  },
): WorkflowStageOverlay {
  if (tabId === 'llm') {
    if (stats.topPriority === 'llm_errors' || stats.errorRatePct >= 5) {
      return { posture: 'danger', metric: `${stats.errorRatePct}% errors` }
    }
    if (stats.topPriority === 'llm_fallbacks') {
      return { posture: 'warn', metric: 'Fallbacks' }
    }
    return stats.errorRatePct > 0
      ? { posture: 'ok', metric: `${stats.errorRatePct}% err` }
      : { posture: 'clear', metric: 'Healthy' }
  }
  if (tabId === 'cron') {
    if (stats.cronErrorCount > 0) {
      return { posture: 'danger', metric: `${stats.cronErrorCount} failed` }
    }
    if (stats.cronStaleCount > 0 || stats.cronWarnCount > 0) {
      return { posture: 'warn', metric: `${stats.cronStaleCount + stats.cronWarnCount} stale` }
    }
    return { posture: 'clear', metric: 'On schedule' }
  }
  if (tabId === 'activity') {
    return stats.redCount > 0
      ? { posture: 'warn', metric: `${stats.redCount} alerts` }
      : { posture: 'clear', metric: 'Quiet' }
  }
  return { posture: 'info' }
}

/** Judge pipeline step overlay. */
export function judgeStageOverlay(
  stepId: string,
  stats: {
    totalEvaluations: number
    disagreementCount: number
    disagreementRatePct: number | null
    latestWeekScore: number | null
    topPriority: string
  },
): WorkflowStageOverlay {
  if (stepId === 'classifier') {
    return { posture: 'clear', metric: 'Always on' }
  }
  if (stepId === 'judge') {
    if (stats.totalEvaluations === 0) {
      return { posture: 'open', metric: 'No evals', actionLine: 'Run judge to baseline quality.' }
    }
    if (stats.topPriority === 'disagreements' && stats.disagreementCount > 0) {
      return {
        posture: 'danger',
        metric: `${stats.disagreementCount} disagree`,
        actionLine: stats.disagreementRatePct != null ? `${stats.disagreementRatePct}% mismatch rate` : undefined,
      }
    }
    if (stats.topPriority === 'low_score' && stats.latestWeekScore != null) {
      return { posture: 'warn', metric: `Score ${stats.latestWeekScore}` }
    }
    return { posture: 'ok', metric: `${stats.totalEvaluations} evals` }
  }
  return { posture: 'clear' }
}

/** Projects hub health signal overlay. */
export function projectsHealthOverlay(
  signalId: string,
  stats: {
    projectsWithReports: number
    sdkConnectedCount: number
    projectCount: number
    activeProjectHasReports: boolean
    activeProjectSdkConnected: boolean
    topPriority: string
  },
): WorkflowStageOverlay {
  if (signalId === 'ingest') {
    const n = stats.projectsWithReports
    if (n === 0) return { posture: 'open', metric: 'None yet' }
    return { posture: 'ok', metric: `${n} project${n === 1 ? '' : 's'}` }
  }
  if (signalId === 'sdk') {
    if (stats.sdkConnectedCount === 0) return { posture: 'open', metric: 'No heartbeat' }
    return { posture: 'ok', metric: `${stats.sdkConnectedCount} live` }
  }
  if (signalId === 'github') {
    return stats.topPriority === 'healthy'
      ? { posture: 'clear', metric: 'Linked' }
      : { posture: 'info', metric: 'Check Connect' }
  }
  if (signalId === 'index') {
    return { posture: 'info', metric: 'Optional' }
  }
  return { posture: 'clear' }
}

/** QA provider row overlay — highlights failing provider context. */
export function qaProviderOverlay(
  providerId: string,
  stats: {
    failingStories: number
    totalStories: number
    topPriority: string
  },
): WorkflowStageOverlay {
  if (stats.topPriority === 'failing' && stats.failingStories > 0) {
    if (providerId === 'firecrawl_actions') {
      return { posture: 'warn', metric: `${stats.failingStories} failing` }
    }
    return { posture: 'info', metric: 'Check runs' }
  }
  if (stats.totalStories === 0) {
    return { posture: providerId === 'firecrawl_actions' ? 'open' : 'info', metric: 'No stories' }
  }
  return { posture: 'clear', metric: 'Available' }
}

/** Integrations setup step overlay (1-based step index strings). */
export function integrationsStepOverlay(
  stepIndex: number,
  flags: { githubOk: boolean; sentryOk: boolean; langfuseOk: boolean; slackOk: boolean },
): WorkflowStageOverlay {
  switch (stepIndex) {
    case 1:
      return flags.githubOk
        ? { posture: 'clear', metric: 'Connected' }
        : { posture: 'open', metric: 'Not linked', actionLine: 'Required for auto-fix PRs.' }
    case 2:
      return flags.sentryOk ? { posture: 'clear', metric: 'Connected' } : { posture: 'info', metric: 'Optional' }
    case 3:
      return flags.langfuseOk ? { posture: 'clear', metric: 'Connected' } : { posture: 'info', metric: 'Optional' }
    case 5:
      return flags.slackOk ? { posture: 'clear', metric: 'Connected' } : { posture: 'info', metric: 'Optional' }
    default:
      return { posture: 'info', metric: 'Optional' }
  }
}

/** Drift severity live counts overlay. */
export function driftSeverityOverlay(
  severityId: string,
  stats: { criticalOpen: number; warnOpen: number; infoOpen: number; topPriority: string },
): WorkflowStageOverlay {
  if (severityId === 'critical') {
    return stats.criticalOpen > 0
      ? { posture: 'danger', metric: `${stats.criticalOpen} open` }
      : { posture: 'clear', metric: '0 open' }
  }
  if (severityId === 'warn') {
    return stats.warnOpen > 0
      ? { posture: 'warn', metric: `${stats.warnOpen} open` }
      : { posture: 'clear', metric: '0 open' }
  }
  if (severityId === 'info') {
    return stats.infoOpen > 0
      ? { posture: 'info', metric: `${stats.infoOpen} open` }
      : { posture: 'clear', metric: '0 open' }
  }
  return { posture: 'clear' }
}

/** Code health metric overlay. */
export function codeHealthMetricOverlay(
  metricId: string,
  stats: {
    errorCount: number
    warnCount: number
    hasRun: boolean
    topPriority: string
  },
): WorkflowStageOverlay {
  if (metricId === 'bundle') {
    return stats.hasRun ? { posture: 'ok', metric: 'Trending' } : { posture: 'open', metric: 'No data' }
  }
  if (metricId === 'god_file') {
    if (stats.errorCount > 0) return { posture: 'danger', metric: pluralizeWithCount(stats.errorCount, 'error') }
    if (stats.warnCount > 0) return { posture: 'warn', metric: pluralizeWithCount(stats.warnCount, 'warning') }
    return { posture: 'clear', metric: 'Within budget' }
  }
  if (metricId === 'ingest') {
    return stats.topPriority === 'no_data'
      ? { posture: 'open', metric: 'Not wired' }
      : { posture: 'clear', metric: 'Receiving' }
  }
  return { posture: 'clear' }
}

/** Anomaly detection method overlay. */
export function anomaliesMethodOverlay(
  methodId: string,
  stats: {
    openAnomalies: number
    metricPointCount: number
    topPriority: string
  },
): WorkflowStageOverlay {
  if (methodId === 'ingest') {
    return stats.metricPointCount === 0
      ? { posture: 'open', metric: 'No points' }
      : { posture: 'ok', metric: pluralizeWithCount(stats.metricPointCount, 'point') }
  }
  if (stats.openAnomalies > 0) {
    return { posture: 'warn', metric: `${stats.openAnomalies} open` }
  }
  return { posture: 'clear', metric: 'Idle' }
}

/** Explore atlas tab overlay. */
export function exploreTabOverlay(
  tabId: string,
  stats: {
    indexedFiles: number
    symbolCount: number
    topPriority: string
    codebaseIndexEnabled: boolean
  },
): WorkflowStageOverlay {
  if (tabId === 'overview' || tabId === 'index') {
    if (!stats.codebaseIndexEnabled) return { posture: 'open', metric: 'Disabled' }
    if (stats.topPriority === 'indexing') return { posture: 'info', metric: 'Indexing…' }
    if (stats.topPriority === 'error') return { posture: 'danger', metric: 'Error' }
    if (stats.indexedFiles === 0) return { posture: 'open', metric: 'Empty' }
    return { posture: 'ok', metric: `${stats.indexedFiles} files` }
  }
  if (tabId === 'search' || tabId === 'ask') {
    return stats.symbolCount > 0
      ? { posture: 'ok', metric: `${stats.symbolCount} symbols` }
      : { posture: 'info', metric: 'After index' }
  }
  return { posture: 'clear', metric: 'Ready' }
}

/** Onboarding step overlay. */
export function onboardingStepOverlay(
  stepId: string,
  stats: {
    requiredComplete: number
    requiredTotal: number
    sdkInstalled: boolean
    reportCount: number
    nextStepId: string | null
  },
  optional = false,
): WorkflowStageOverlay {
  if (optional) {
    return { posture: 'info', metric: 'Optional' }
  }
  if (stepId === stats.nextStepId) {
    return { posture: 'open', metric: 'Next', actionLine: 'Complete this step to continue setup.' }
  }
  if (stats.requiredComplete >= stats.requiredTotal) {
    return { posture: 'clear', metric: 'Done' }
  }
  if (stepId === 'sdk' && stats.sdkInstalled) {
    return { posture: 'ok', metric: 'Installed' }
  }
  if (stepId === 'ingest' && stats.reportCount > 0) {
    return { posture: 'ok', metric: pluralizeWithCount(stats.reportCount, 'report') }
  }
  return { posture: 'clear', metric: 'Pending' }
}

/** Skills pipeline mode overlay. */
export function skillsModeOverlay(
  modeId: string,
  stats: { activeRuns: number; failedRuns: number; awaitingCheckin: number; topPriority: string },
): WorkflowStageOverlay {
  if (modeId === 'cloud') {
    if (stats.failedRuns > 0) return { posture: 'danger', metric: `${stats.failedRuns} failed` }
    if (stats.activeRuns > 0) return { posture: 'info', metric: `${stats.activeRuns} running` }
    if (stats.awaitingCheckin > 0) return { posture: 'open', metric: `${stats.awaitingCheckin} waiting` }
  }
  return { posture: 'clear', metric: 'Ready' }
}

/** Rewards economy concept overlay — static unless economy has open config gaps. */
export function rewardsConceptOverlay(
  conceptId: string,
  stats: { topPriority: string; openRules?: number },
): WorkflowStageOverlay {
  if (conceptId === 'rules' && stats.topPriority !== 'healthy') {
    return { posture: 'open', metric: 'Review' }
  }
  return { posture: 'clear', metric: 'Configured' }
}

/** SSO protocol overlay. */
export function ssoProtocolOverlay(
  protocolId: string,
  flags: { samlConfigured: boolean; oidcConfigured: boolean },
): WorkflowStageOverlay {
  if (protocolId === 'saml') {
    return flags.samlConfigured ? { posture: 'clear', metric: 'Configured' } : { posture: 'info', metric: 'Not set' }
  }
  if (protocolId === 'oidc') {
    return flags.oidcConfigured ? { posture: 'clear', metric: 'Configured' } : { posture: 'info', metric: 'Not set' }
  }
  return { posture: 'info', metric: 'Optional' }
}

/** Compliance concept overlay. */
export function complianceConceptOverlay(
  conceptId: string,
  stats: { controlsFail: number; overdueDsars: number; topPriority: string },
): WorkflowStageOverlay {
  if (conceptId === 'soc2' && stats.controlsFail > 0) {
    return { posture: 'danger', metric: `${stats.controlsFail} failing` }
  }
  if (conceptId === 'dsar' && stats.overdueDsars > 0) {
    return { posture: 'warn', metric: `${stats.overdueDsars} overdue` }
  }
  return stats.topPriority === 'healthy'
    ? { posture: 'clear', metric: 'OK' }
    : { posture: 'info', metric: 'Review' }
}

/** Prompt lab workflow step overlay. */
export function promptLabStageOverlay(
  stepId: string,
  stats: {
    datasetTotal: number
    candidatePrompts: number
    abTestingCount: number
    promoteReadyCount: number
    topPriority: string
  },
): WorkflowStageOverlay {
  if (stepId === 'judge') {
    return stats.datasetTotal > 0
      ? { posture: 'ok', metric: `${stats.datasetTotal} examples` }
      : { posture: 'open', metric: 'No dataset' }
  }
  if (stepId === 'clone' && stats.candidatePrompts > 0) {
    return { posture: 'open', metric: `${stats.candidatePrompts} candidates` }
  }
  if (stepId === 'ab' && stats.abTestingCount > 0) {
    return { posture: 'info', metric: `${stats.abTestingCount} A/B` }
  }
  if (stepId === 'promote' && stats.promoteReadyCount > 0) {
    return { posture: 'open', metric: `${stats.promoteReadyCount} ready` }
  }
  return { posture: 'clear', metric: '—' }
}

/** Reports severity band overlay. */
export function reportsSeverityOverlay(
  bandId: string,
  stats: {
    critical14d: number
    high14d: number
    newUntriaged: number
    openBacklog: number
    topPriority: string
  },
): WorkflowStageOverlay {
  if (bandId === 'critical') {
    return stats.critical14d > 0
      ? { posture: 'danger', metric: `${stats.critical14d} (14d)` }
      : { posture: 'clear', metric: '0' }
  }
  if (bandId === 'high') {
    return stats.high14d > 0
      ? { posture: 'warn', metric: `${stats.high14d} (14d)` }
      : { posture: 'clear', metric: '0' }
  }
  if (bandId === 'backlog') {
    return stats.openBacklog > 0
      ? { posture: 'open', metric: `${stats.openBacklog} open` }
      : { posture: 'clear', metric: 'Clear' }
  }
  if (bandId === 'untriaged') {
    return stats.newUntriaged > 0
      ? { posture: 'open', metric: `${stats.newUntriaged} new` }
      : { posture: 'clear', metric: 'Clear' }
  }
  return { posture: 'clear' }
}

/** Settings tab overlay from local probe flags. */
export function settingsTabOverlay(
  tabId: string,
  flags: {
    hasByokKey?: boolean
    slackConfigured?: boolean
    githubConfigured?: boolean
  },
): WorkflowStageOverlay {
  if (tabId === 'byok') {
    return flags.hasByokKey
      ? { posture: 'clear', metric: 'Key saved' }
      : { posture: 'open', metric: 'No BYOK key' }
  }
  if (tabId === 'slack') {
    return flags.slackConfigured
      ? { posture: 'clear', metric: 'Connected' }
      : { posture: 'info', metric: 'Optional' }
  }
  if (tabId === 'github') {
    return flags.githubConfigured
      ? { posture: 'clear', metric: 'Connected' }
      : { posture: 'open', metric: 'Not linked' }
  }
  return { posture: 'clear', metric: 'Ready' }
}
