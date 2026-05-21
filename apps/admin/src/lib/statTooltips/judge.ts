/**
 * FILE: apps/admin/src/lib/statTooltips/judge.ts
 * PURPOSE: Human-readable StatCard tooltips for the Judge snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { JudgeStats } from '../../components/judge/JudgeStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function weekTooltip(stats: JudgeStats): MetricTooltipData {
  const scorePct =
    stats.latestWeekScore != null ? `${Math.round(stats.latestWeekScore * 100)}%` : '—'
  const takeaway =
    stats.latestWeekEvalCount === 0
      ? 'No judge evaluations this week yet — run judge-batch or wait for cron to grade recent classifications.'
      : `This week averaged ${scorePct} across ${stats.latestWeekEvalCount} evaluation${stats.latestWeekEvalCount === 1 ? '' : 's'}.`

  return metricTip(
    'Average classifier quality score for the current ISO week (0–100% scale).',
    'Calls weekly_judge_scores RPC for the active project; latest week avg_score and eval_count.',
    takeaway,
    stats.latestWeekScore != null && stats.latestWeekScore < 0.6
      ? { tone: 'warn', text: 'Low weekly score — review disagreements and prompt versions.' }
      : undefined,
  )
}

export function weekDetail(stats: JudgeStats): string {
  return `${stats.latestWeekEvalCount} evals`
}

export function totalTooltip(stats: JudgeStats): MetricTooltipData {
  const takeaway =
    stats.totalEvaluations > 0
      ? `${stats.totalEvaluations.toLocaleString()} classification evaluation${stats.totalEvaluations === 1 ? '' : 's'} logged all time${stats.lastEvalAt ? ` — last ${new Date(stats.lastEvalAt).toLocaleString()}.` : '.'}`
      : 'No evaluations yet — classified reports become judge input after triage.'

  return metricTip(
    'Total LLM judge evaluations recorded for the active project.',
    'Counts classification_evaluations rows for the active project.',
    takeaway,
    stats.staleHours != null && stats.staleHours > 48
      ? { tone: 'info', text: `Last eval ${stats.staleHours}h ago — judge may be stale.` }
      : undefined,
  )
}

export function totalDetail(): string {
  return 'All time on project'
}

export function disagreeTooltip(stats: JudgeStats): MetricTooltipData {
  const takeaway =
    stats.disagreementCount > 0
      ? `${stats.disagreementCount} evaluation${stats.disagreementCount === 1 ? '' : 's'} where the judge disagreed with the classifier${stats.disagreementRatePct != null ? ` (${stats.disagreementRatePct}% rate).` : '.'}`
      : 'No classifier vs judge disagreements recorded — labels align so far.'

  return metricTip(
    'Evaluations where classification_agreed is false — judge score diverged from the classifier label.',
    'Counts classification_evaluations rows where classification_agreed equals false for the active project.',
    takeaway,
    stats.disagreementCount > 0
      ? { tone: 'warn', text: 'Disagreements signal prompt drift — review Evaluations tab.' }
      : undefined,
  )
}

export function disagreeDetail(stats: JudgeStats): string {
  return stats.disagreementRatePct != null ? `${stats.disagreementRatePct}% rate` : 'classifier vs user'
}

export function driftTooltip(stats: JudgeStats): MetricTooltipData {
  const takeaway =
    stats.weekOverWeekDriftPct != null
      ? `Week-over-week score change is ${stats.weekOverWeekDriftPct}%${stats.weekOverWeekDriftPct >= 5 ? ' — investigate prompt or intake shifts.' : '.'}`
      : 'Not enough weekly history yet — need two weeks of evaluations to compute drift.'

  return metricTip(
    'Percentage change in average judge score vs the prior ISO week.',
    'Compares the two most recent rows from weekly_judge_scores: (latest − previous) / previous × 100.',
    takeaway,
    stats.weekOverWeekDriftPct != null && stats.weekOverWeekDriftPct >= 5
      ? { tone: 'warn', text: 'Score drifting week-over-week — check Trend tab and active prompts.' }
      : undefined,
  )
}

export function driftDetail(): string {
  return 'Week-over-week score change'
}

export function classifiedTooltip(stats: JudgeStats): MetricTooltipData {
  const takeaway =
    stats.classifiedReports > 0
      ? `${stats.classifiedReports} report${stats.classifiedReports === 1 ? '' : 's'} past triage and ready for judge evaluation${stats.totalEvaluations === 0 ? ' — run judge to establish a baseline score.' : '.'}`
      : 'No classified reports waiting — triage new intake on Reports first.'

  return metricTip(
    'Reports in classified, triaged, grouped, or dispatched status — eligible for judge grading.',
    'Counts reports rows where status is in classified/triaged/grouped/dispatched for the active project.',
    takeaway,
    stats.classifiedReports > 0 && stats.totalEvaluations === 0
      ? { tone: 'info', text: 'Classified backlog with zero evals — trigger judge-batch to start scoring.' }
      : undefined,
  )
}

export function classifiedDetail(): string {
  return 'Ready for judge'
}

export function promptsTooltip(stats: JudgeStats): MetricTooltipData {
  const takeaway =
    stats.promptVersionCount > 0
      ? `${stats.promptVersionCount} prompt version${stats.promptVersionCount === 1 ? '' : 's'} tracked; ${stats.activePromptCount} active for classification/judge pipelines.`
      : 'No custom prompt versions — system defaults apply until you fork a prompt on Prompts tab.'

  return metricTip(
    'Prompt versions available for judge and classifier pipelines.',
    'Counts prompt_versions rows scoped to the project or global (project_id null). activePromptCount filters is_active.',
    takeaway,
    stats.activePromptCount === 0 && stats.promptVersionCount > 0
      ? { tone: 'info', text: 'Prompt versions exist but none active — activate one on Prompts tab.' }
      : undefined,
  )
}

export function promptsDetail(stats: JudgeStats): string {
  return `${stats.activePromptCount} active`
}
