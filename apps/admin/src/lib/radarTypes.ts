/**
 * FILE: apps/admin/src/lib/radarTypes.ts
 * PURPOSE: Console mirror of the radar and digest wire shapes
 *          (server: _shared/radar/run.ts RadarView, api/routes/digest.ts).
 */

export type DetectorState = 'ok' | 'finding' | 'unknown' | 'error'

interface RadarFindingView {
  id: string
  severity: string
  message: string
  filePath: string | null
  line: number | null
  fix: string | null
  target: string | null
}

interface RadarDetectorView {
  ruleId: string
  title: string
  prevents: string
  source: 'public_probe' | 'repo_scan' | 'host_ci' | 'connector'
  state: DetectorState
  reason: string
  checkedAt: string | null
  from: 'portfolio_radar' | 'portfolio_radar_ci' | null
  findings: RadarFindingView[]
}

export interface RadarView {
  projectId: string
  checkedAt: string | null
  ciCheckedAt: string | null
  status: 'never_run' | 'pass' | 'warn' | 'fail' | 'skipped' | 'error'
  detectors: RadarDetectorView[]
}

export interface DigestSettingsView {
  organizationId: string
  enabled: boolean
  slackProjectId: string | null
  email: boolean
  webPush: boolean
  sendHourUtc: number
  lastSentAt: string | null
  lastStatus: 'sent' | 'partial' | 'failed' | 'nothing_to_send' | null
  lastError: string | null
}

export interface DigestPreviewResponse {
  settings: DigestSettingsView
  preview: { title: string; lines: string[]; text: string; hasContent: boolean }
}
