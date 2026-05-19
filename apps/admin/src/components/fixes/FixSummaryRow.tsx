/**
 * FILE: apps/admin/src/components/fixes/FixSummaryRow.tsx
 * PURPOSE: 5-tile KPI strip + 30-day daily-volume sparkline for the auto-fix
 *          pipeline. Pure presentation — accepts a pre-computed FixSummary.
 */

import { useMemo } from 'react';
import { KpiRow, KpiTile, type KpiDelta, type Tone } from '../charts';
import type { FixSummary } from './types';

interface Props {
  summary: FixSummary;
  successRate: number | null;
}

function pctDelta(values: number[], opts: { invert?: boolean } = {}): KpiDelta | null {
  if (values.length < 14) return null;
  const half = Math.floor(values.length / 2);
  const last = values.slice(-half).reduce((a, n) => a + n, 0);
  const prev = values.slice(0, values.length - half).reduce((a, n) => a + n, 0);
  if (last === 0 && prev === 0) return null;
  if (prev === 0) return { value: 'new', direction: 'up', tone: opts.invert ? 'warn' : 'ok' };
  const pct = Math.round(((last - prev) / prev) * 100);
  if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted' };
  return {
    value: `${Math.abs(pct)}%`,
    direction: pct > 0 ? 'up' : 'down',
    tone: opts.invert ? (pct > 0 ? 'warn' : 'ok') : pct > 0 ? 'ok' : 'warn',
  };
}

export function FixSummaryRow({ summary, successRate }: Props) {
  // Build per-tile sparklines from the same `days` array so each KPI shows
  // both the count and the trajectory. Completed = good when up; failed =
  // bad when up; total = neutral but informative.
  const totals = useMemo(() => summary.days.map((d) => d.total), [summary.days]);
  const completed = useMemo(() => summary.days.map((d) => d.completed), [summary.days]);
  const failed = useMemo(() => summary.days.map((d) => d.failed), [summary.days]);

  // Loop-closure: surface the spec-validation soft-warning count as a sixth
  // tile, but only when the gate has actually fired in the trailing 30d.
  // Hiding the tile when zero keeps the row at its original 5-column shape
  // for projects that haven't onboarded inventory yet — adding a perpetual
  // "0 spec warnings" tile would just be visual noise.
  const specWarnings = summary.specWarnings ?? 0;
  const showSpec = specWarnings > 0;

  // Loop-closure: when there are *any* failures with a categorised reason
  // in the trailing 30d, show a "Why fixes failed" tile that names the
  // dominant cause. Without this, a project with 16 failures has no clue
  // whether it's a model issue (llm_no_object), an infra issue
  // (sandbox_timeout), or a config issue (scope_blocked).
  const breakdown = summary.failureBreakdown ?? [];
  const showBreakdown = breakdown.length > 0;
  const cols = (5 + (showSpec ? 1 : 0) + (showBreakdown ? 1 : 0)) as 5 | 6 | 7;
  const topFailure = breakdown[0];
  const breakdownTitle = breakdown
    .map((b) => `${b.count}× ${b.category}`)
    .join('\n');

  return (
    <KpiRow cols={cols}>
      <KpiTile
        label="Attempts (30d)"
        value={summary.total}
        sublabel="dispatched in last 30 days"
        series={totals}
        delta={pctDelta(totals)}
        seriesAriaLabel="Daily fix attempts, last 30 days"
        meaning="Every time Mushi handed a report to the auto-fix agent. Includes successes, failures, and runs still in flight."
      />
      <KpiTile
        label="Completed"
        value={summary.completed}
        accent={summary.completed > 0 ? 'ok' : 'muted'}
        sublabel={
          successRate != null ? `${(successRate * 100).toFixed(0)}% success` : 'no finished runs'
        }
        series={completed}
        delta={pctDelta(completed)}
        seriesAriaLabel="Daily completed fixes, last 30 days"
        meaning="Runs that produced a merged or merge-ready PR. The success-rate figure compares completed vs failed only — in-flight runs don't count yet."
      />
      <KpiTile
        label="Failed"
        value={summary.failed}
        accent={summary.failed > 0 ? 'danger' : 'muted'}
        sublabel="needs prompt or scope tuning"
        series={failed}
        delta={pctDelta(failed, { invert: true })}
        seriesAriaLabel="Daily failed fixes, last 30 days"
        meaning="Runs that hit a non-recoverable error: agent crash, CI failure, or scope rejection. Investigate before retrying."
      />
      <KpiTile
        label="In flight"
        value={summary.inProgress}
        accent={summary.inProgress > 0 ? 'info' : 'muted'}
        sublabel="queued or running"
        meaning="Runs currently being attempted or sitting in the dispatch queue. Watch for ones idling > 10 minutes."
      />
      <KpiTile
        label="PRs open"
        value={summary.prsOpen}
        accent={(summary.prsOpen > 0 ? 'brand' : 'muted') as Tone}
        sublabel={summary.prsOpen > 0 ? 'awaiting review or merge' : 'no open PRs'}
        meaning="GitHub PRs Mushi has opened that haven't been merged or closed yet. Each one is a closable PDCA loop waiting for a human reviewer."
      />
      {showSpec && (
        <KpiTile
          label="Spec warnings"
          value={specWarnings}
          accent="warn"
          sublabel="diff didn't touch the contract"
          meaning="Fix attempts whose validateAgainstSpec gate raised at least one soft warning — the diff parsed but didn't visibly reference the inventory contract's table or page route. Review these before merging; a sustained spike usually means an inventory contract drifted."
        />
      )}
      {showBreakdown && topFailure && (
        <KpiTile
          label="Why fixes failed"
          value={topFailure.count}
          accent="danger"
          sublabel={`top: ${topFailure.category}`}
          meaning={`30d failure breakdown by category, dominant cause first.\n${breakdownTitle}\n\nCategories come from categorizeFailure() in fix-worker. "unknown" means the categorizer didn't match any pattern — investigate and extend the enum if a new failure mode is emerging.`}
        />
      )}
    </KpiRow>
  );
}
