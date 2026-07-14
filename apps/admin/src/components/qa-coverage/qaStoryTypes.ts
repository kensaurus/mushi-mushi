/** Shared QA Coverage story/run types and display constants. */

import { CHIP_TONE, runStatusChipTone } from '../../lib/chipTone'

export interface QaStoryCoverage {
  story_id: string
  project_id: string
  name: string
  enabled: boolean
  browser_provider: string
  last_run_status: string | null
  is_direct_fetch?: boolean
  runs_24h: number
  passed_24h: number
  failed_24h: number
  error_24h: number
  pass_rate_pct: number | null
  last_run_at: string | null
  last_failure_url: string | null
}

export interface QaStoryFull {
  id: string
  project_id: string
  name: string
  prompt: string | null
  script: string | null
  script_lang: string
  browser_provider: string
  schedule_cron: string | null
  enabled: boolean
  byok_provider: string | null
  created_at: string
  updated_at: string
}

export interface QaStoryRun {
  id: string
  story_id: string
  status: string
  latency_ms: number | null
  started_at: string
  finished_at: string | null
  provider: string | null
  provider_session_url: string | null
  summary: string | null
  assertion_failures: Array<{ step: string; expected: string | null; actual: string | null }>
  error_message: string | null
  triggered_by: string | null
  created_at: string
}

export interface QaEvidence {
  id: string
  kind: 'screenshot' | 'console' | 'network' | 'video' | 'trace' | 'dom' | 'har'
  storage_path: string
  mime: string | null
  step_label: string | null
  captured_at: string
  signed_url: string | null
}

export const PROVIDER_BADGE: Record<string, string> = {
  local: CHIP_TONE.neutral,
  browserbase: CHIP_TONE.brandSubtle,
  firecrawl_actions: CHIP_TONE.okSubtle,
}

export const PROVIDER_LABEL: Record<string, string> = {
  local: 'Local',
  browserbase: 'Browserbase',
  firecrawl_actions: 'Firecrawl',
}

/** Text-only status labels (not chip chrome). AA foreground tokens. */
export const STATUS_TONE: Record<string, string> = {
  passed: 'text-ok-foreground',
  failed: 'text-danger-foreground',
  error: 'text-danger-foreground',
  timeout: 'text-warning-foreground',
  skipped: 'text-fg-faint',
  running: 'text-brand',
  pending: 'text-fg-secondary',
}

/** Chip chrome per run status — pending stays quiet (not lifecycle warn). */
export const STATUS_BG: Record<string, string> = {
  passed: runStatusChipTone('passed'),
  failed: runStatusChipTone('failed'),
  error: runStatusChipTone('error'),
  timeout: runStatusChipTone('timeout'),
  running: runStatusChipTone('running'),
  skipped: runStatusChipTone('skipped'),
  pending: CHIP_TONE.neutral,
}

export const EVIDENCE_BADGE: Record<string, string> = {
  screenshot: CHIP_TONE.brandSubtle,
  video: CHIP_TONE.brandSubtle,
  console: CHIP_TONE.neutral,
  network: CHIP_TONE.neutral,
  har: CHIP_TONE.neutral,
  trace: CHIP_TONE.neutral,
  dom: CHIP_TONE.neutral,
}

export const ACTIVE_STATUSES = new Set(['pending', 'running'])
