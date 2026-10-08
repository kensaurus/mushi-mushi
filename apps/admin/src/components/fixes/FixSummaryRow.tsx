/**
 * FILE: apps/admin/src/components/fixes/FixSummaryRow.tsx
 * PURPOSE: 5-tile KPI strip + 30-day daily-volume sparkline for the auto-fix
 *          pipeline. Pure presentation — accepts a pre-computed FixSummary.
 */

import { fixCauseLabel } from '../../lib/fixReportTruth'
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
  // Under 5 in the earlier half, a percentage is noise ("↑1500%" on 1 → 16).
  if (prev < 5) return null;
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
    .map((b) => `${b.count}× ${fixCauseLabel(b.category)}`)
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
        label="Reports fixed"
        value={summary.completed}
        accent={summary.completed > 0 ? 'ok' : 'muted'}
        sublabel={
          successRate != null ? `${(successRate * 100).toFixed(0)}% success` : 'no finished runs'
        }
        series={completed}
        delta={pctDelta(completed)}
        seriesAriaLabel="Daily completed fix attempts, last 30 days"
        meaning="Reports that are fixed now (a fix PR merged, or the report was marked fixed), each counted once. The success rate compares fixed vs still-unfixed reports; the sparkline shows completed attempts per day."
      />
      <KpiTile
        label="Auto-fix stopped"
        value={summary.failed}
        accent={summary.failed > 0 ? 'danger' : 'muted'}
        sublabel={summary.failed > 0 ? 'reports still unfixed' : 'nothing waiting'}
        series={failed}
        delta={pctDelta(failed, { invert: true })}
        seriesAriaLabel="Daily stopped fix attempts, last 30 days"
        meaning="Reports still unfixed whose latest attempt failed, was skipped, or whose PR closed or went red — each counted once. A report a later PR fixed is never counted. The sparkline shows stopped attempts per day."
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
        sublabel={summary.prsOpen > 0 ? 'fix attempts with an open PR' : 'no open PRs'}
        meaning="Fix attempts whose GitHub PR is still open, whatever CI says: the same count as Pull requests. A red-CI PR also counts as auto-fix stopped."
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
          label="Why auto-fix stopped"
          value={topFailure.count}
          accent="danger"
          sublabel={fixCauseLabel(topFailure.category)}
          meaning={`Why the last attempt stopped on each still-unfixed report, most common first.
${breakdownTitle}

A rejected AI key is listed by provider; otherwise the cause comes from the fix worker. "Unrecognised error" means no rule matched — open the attempt to read it.`}
        />
      )}
    </KpiRow>
  );
}
