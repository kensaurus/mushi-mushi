import { describe, expect, it } from 'vitest'
import {
  anomaliesMethodOverlay,
  codeHealthMetricOverlay,
  complianceConceptOverlay,
  connectLaneOverlay,
  driftSeverityOverlay,
  exploreTabOverlay,
  fixesStageOverlay,
  healthProbeOverlay,
  inboxStageOverlay,
  integrationsStepOverlay,
  judgeStageOverlay,
  onboardingStepOverlay,
  projectsHealthOverlay,
  promptLabStageOverlay,
  qaProviderOverlay,
  reportsSeverityOverlay,
  settingsTabOverlay,
  skillsModeOverlay,
} from './guideLiveOverlay'

describe('guideLiveOverlay', () => {
  it('inbox open plan stage', () => {
    const overlay = inboxStageOverlay('plan', {
      openPlan: true,
      openDo: false,
      openCheck: false,
      openAct: false,
      openOps: false,
    })
    expect(overlay.posture).toBe('open')
    expect(overlay.metric).toBe('Open')
  })

  it('connect mcp lane not done when sdk connected', () => {
    const overlay = connectLaneOverlay('mcp', {
      githubConnected: true,
      sdkConnected: true,
      mcpConnected: false,
    })
    expect(overlay.metric).toBe('Not in IDE')
    expect(overlay.posture).toBe('open')
  })

  it('fixes dispatch shows failed count', () => {
    const overlay = fixesStageOverlay('dispatch', {
      failed: 2,
      inProgress: 0,
      prsOpen: 0,
      prsCiPassing: 0,
      topPriority: 'failed',
      topPriorityLabel: 'Retry failed fixes',
      topPriorityTo: '/fixes',
    })
    expect(overlay.metric).toBe('2 failed')
    expect(overlay.posture).toBe('danger')
  })

  it('healthProbeOverlay flags LLM errors', () => {
    const overlay = healthProbeOverlay('llm', {
      errorRatePct: 8,
      cronErrorCount: 0,
      cronStaleCount: 0,
      cronWarnCount: 0,
      redCount: 0,
      topPriority: 'llm_errors',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('8% errors')
  })

  it('judgeStageOverlay shows disagreement count', () => {
    const overlay = judgeStageOverlay('judge', {
      totalEvaluations: 12,
      disagreementCount: 3,
      disagreementRatePct: 25,
      latestWeekScore: 72,
      topPriority: 'disagreements',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('3 disagree')
  })

  it('projectsHealthOverlay shows no heartbeat', () => {
    const overlay = projectsHealthOverlay('sdk', {
      projectsWithReports: 1,
      sdkConnectedCount: 0,
      projectCount: 1,
      activeProjectHasReports: true,
      activeProjectSdkConnected: false,
      topPriority: 'no_sdk_heartbeat',
    })
    expect(overlay.posture).toBe('open')
    expect(overlay.metric).toBe('No heartbeat')
  })

  it('driftSeverityOverlay counts critical findings', () => {
    const overlay = driftSeverityOverlay('critical', {
      criticalOpen: 2,
      warnOpen: 0,
      infoOpen: 1,
      topPriority: 'critical_findings',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('2 open')
  })

  it('codeHealthMetricOverlay flags god-file errors', () => {
    const overlay = codeHealthMetricOverlay('god_file', {
      errorCount: 1,
      warnCount: 2,
      hasRun: true,
      topPriority: 'errors',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('1 error')
  })

  it('codeHealthMetricOverlay pluralizes warning count', () => {
    const overlay = codeHealthMetricOverlay('god_file', {
      errorCount: 0,
      warnCount: 1,
      hasRun: true,
      topPriority: 'warnings',
    })
    expect(overlay.posture).toBe('warn')
    expect(overlay.metric).toBe('1 warning')
  })

  it('anomaliesMethodOverlay shows open anomalies', () => {
    const overlay = anomaliesMethodOverlay('zscore', {
      openAnomalies: 4,
      metricPointCount: 100,
      topPriority: 'open_anomalies',
    })
    expect(overlay.posture).toBe('warn')
    expect(overlay.metric).toBe('4 open')
  })

  it('anomaliesMethodOverlay pluralizes single metric point', () => {
    const overlay = anomaliesMethodOverlay('ingest', {
      openAnomalies: 0,
      metricPointCount: 1,
      topPriority: 'no_data',
    })
    expect(overlay.posture).toBe('ok')
    expect(overlay.metric).toBe('1 point')
  })

  it('exploreTabOverlay shows indexing state', () => {
    const overlay = exploreTabOverlay('index', {
      indexedFiles: 0,
      symbolCount: 0,
      topPriority: 'indexing',
      codebaseIndexEnabled: true,
    })
    expect(overlay.posture).toBe('info')
    expect(overlay.metric).toBe('Indexing…')
  })

  it('onboardingStepOverlay marks next step', () => {
    const overlay = onboardingStepOverlay('sdk_installed', {
      requiredComplete: 2,
      requiredTotal: 4,
      sdkInstalled: false,
      reportCount: 0,
      nextStepId: 'sdk_installed',
    })
    expect(overlay.posture).toBe('open')
    expect(overlay.metric).toBe('Next')
  })

  it('onboardingStepOverlay pluralizes single report count', () => {
    const overlay = onboardingStepOverlay('ingest', {
      requiredComplete: 2,
      requiredTotal: 4,
      sdkInstalled: true,
      reportCount: 1,
      nextStepId: 'other_step',
    })
    expect(overlay.posture).toBe('ok')
    expect(overlay.metric).toBe('1 report')
  })

  it('integrationsStepOverlay requires GitHub first', () => {
    const overlay = integrationsStepOverlay(1, {
      githubOk: false,
      sentryOk: false,
      langfuseOk: false,
      slackOk: false,
    })
    expect(overlay.posture).toBe('open')
    expect(overlay.metric).toBe('Not linked')
  })

  it('qaProviderOverlay highlights failing stories on firecrawl', () => {
    const overlay = qaProviderOverlay('firecrawl_actions', {
      failingStories: 2,
      totalStories: 5,
      topPriority: 'failing',
    })
    expect(overlay.posture).toBe('warn')
    expect(overlay.metric).toBe('2 failing')
  })

  it('skillsModeOverlay shows failed runs', () => {
    const overlay = skillsModeOverlay('cloud', {
      activeRuns: 0,
      failedRuns: 1,
      awaitingCheckin: 0,
      topPriority: 'failed_runs',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('1 failed')
  })

  it('complianceConceptOverlay flags failing controls', () => {
    const overlay = complianceConceptOverlay('soc2', {
      controlsFail: 2,
      overdueDsars: 0,
      topPriority: 'failing_controls',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('2 failing')
  })

  it('promptLabStageOverlay shows dataset size', () => {
    const overlay = promptLabStageOverlay('judge', {
      datasetTotal: 42,
      candidatePrompts: 0,
      abTestingCount: 0,
      promoteReadyCount: 0,
      topPriority: 'healthy',
    })
    expect(overlay.posture).toBe('ok')
    expect(overlay.metric).toBe('42 examples')
  })

  it('reportsSeverityOverlay counts critical reports', () => {
    const overlay = reportsSeverityOverlay('critical', {
      critical14d: 3,
      high14d: 1,
      newUntriaged: 2,
      openBacklog: 10,
      topPriority: 'critical',
    })
    expect(overlay.posture).toBe('danger')
    expect(overlay.metric).toBe('3 (14d)')
  })

  it('settingsTabOverlay shows missing BYOK key', () => {
    const overlay = settingsTabOverlay('byok', { hasByokKey: false })
    expect(overlay.posture).toBe('open')
    expect(overlay.metric).toBe('No BYOK key')
  })
})
