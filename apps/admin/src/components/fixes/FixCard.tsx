/**
 * FILE: apps/admin/src/components/fixes/FixCard.tsx
 * PURPOSE: Single-fix card. Status, model + token cost, PR link, Langfuse
 *          trace, retry button, and an expandable PDCA timeline + rationale +
 *          file list. The page composes these in a list.
 */

import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, RelativeTime } from '../ui';
import { formatTokens } from '../charts';
import { PIPELINE_STATUS, pipelineStatusLabel } from '../../lib/tokens';
import { useRowFlash } from '../../lib/useRowFlash';
import { FixGitGraph, type FixTimelineEvent } from '../FixGitGraph';
import { PdcaReceipt } from './PdcaReceipt';
import { pluralizeWithCount } from '../../lib/format';
import { ciBadge, type FixAttempt } from './types';
import { FixAttemptFlow } from './FixAttemptFlow';
import { CursorAgentBadge } from './CursorAgentBadge';
import { CursorArtifactsGallery } from './CursorArtifactsGallery';

interface InventoryActionSummary {
  actionNodeId: string;
  actionLabel: string;
  actionDescription?: string | null;
  pagePath?: string | null;
  storyTitle?: string | null;
  expectedOutcome?: Record<string, unknown> | null;
  status?: string | null;
}

interface Props {
  fix: FixAttempt;
  isOpen: boolean;
  timeline: FixTimelineEvent[] | undefined;
  traceUrl: string | null;
  onToggle: () => void;
  onRetry: () => Promise<void>;
  inventoryAction?: InventoryActionSummary | null;
}

export function FixCard({ fix, isOpen, timeline, traceUrl, onToggle, onRetry, inventoryAction }: Props) {
  const ci = ciBadge(fix);
  const totalTokens = (fix.llm_input_tokens ?? 0) + (fix.llm_output_tokens ?? 0);
  // Spec-traceability soft warnings (e.g. "diff didn't touch the contract's
  // table" / "no changed file references the action's page route"). The
  // dispatch passed all hard gates but reviewers should still eyeball the
  // diff before merging — surface a count chip so it's impossible to miss.
  const specWarnings = fix.spec_validation_warnings ?? [];

  // Wave T.2.5: one-shot background wash on realtime status transitions so
  // a live dispatch `queued → running → completed` flashes in-card. Tone
  // follows the status's semantic colour so green = good, red = failed.
  const flashToneFor = useCallback((s: FixAttempt['status']) => {
    switch (s) {
      case 'completed':
      case 'merged':
        return 'var(--color-ok)';
      case 'failed':
      case 'cancelled':
        return 'var(--color-danger)';
      case 'running':
      case 'dispatched':
      case 'queued':
        return 'var(--color-info)';
      default:
        return 'var(--color-brand)';
    }
  }, []);
  const flash = useRowFlash({
    rowKey: fix.id,
    value: fix.status,
    toneFor: flashToneFor,
  });

  return (
    <div
      className={`rounded-md ${flash.className}`}
      style={flash.style}
      onAnimationEnd={flash.onAnimationEnd}
    >
      <Card className="p-3 space-y-1.5">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={PIPELINE_STATUS[fix.status] ?? 'bg-surface-overlay text-fg-muted'}>
              {pipelineStatusLabel(fix.status)}
            </Badge>
            <span className="text-2xs text-fg-muted">via {fix.agent}</span>
            {fix.agent === 'cursor_cloud' && fix.cursor_agent_id && (
              <CursorAgentBadge agentId={fix.cursor_agent_id} />
            )}
            {fix.llm_model && (
              <span className="text-2xs font-mono text-fg-faint" title="LLM model used">
                {fix.llm_model}
              </span>
            )}
            {ci && <Badge className={ci.className}>{ci.label}</Badge>}
            {fix.review_passed === false && (
              <Badge
                className="bg-warn-muted text-warn"
                title="The agent flagged this for extra human review."
              >
                Needs review
              </Badge>
            )}
            {specWarnings.length > 0 && (
              <Badge
                className="bg-warn-muted text-warn"
                title={`Spec gate raised ${specWarnings.length} soft warning${specWarnings.length === 1 ? '' : 's'}: ${specWarnings.map((w) => w.code).join(', ')}. Expand details to inspect.`}
              >
                {`Spec ${specWarnings.length}`}
              </Badge>
            )}
            {fix.status === 'failed' && fix.failure_category && (
              <Badge
                className="bg-danger-subtle text-danger font-mono"
                title={`Categorised by fix-worker.categorizeFailure(). Aggregated into the "Why fixes failed" tile on the Fixes summary so trends are visible at a glance.`}
              >
                {fix.failure_category}
              </Badge>
            )}
            {fix.inventory_action_node_id && !inventoryAction && (
              <Badge
                className="bg-info-subtle text-info font-mono"
                title="This fix is linked to an inventory action. Expand to see the origin contract."
              >
                spec-linked
              </Badge>
            )}
          </div>
          <span className="text-2xs text-fg-muted tabular-nums">
            <RelativeTime value={fix.started_at} />
          </span>
        </div>

        {fix.summary && <p className="text-xs text-fg-secondary">{fix.summary}</p>}

        <FixAttemptFlow fix={fix} className="mt-1" />

        <PdcaReceipt fix={fix} timeline={timeline} className="pt-1" />

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted font-mono">
          <Link
            to={`/reports/${fix.report_id}`}
            className="hover:text-fg-secondary underline-offset-2 hover:underline"
          >
            Report: {fix.report_id.slice(0, 8)}…
          </Link>
          {fix.branch && (
            <span title={fix.branch}>
              Branch: {fix.branch.length > 32 ? `${fix.branch.slice(0, 32)}…` : fix.branch}
            </span>
          )}
          {fix.lines_changed != null && (
            <span>{pluralizeWithCount(fix.lines_changed, 'line')}</span>
          )}
          {fix.files_changed && <span>{pluralizeWithCount(fix.files_changed.length, 'file')}</span>}
          {totalTokens > 0 && (
            <span title={`Input: ${fix.llm_input_tokens} · Output: ${fix.llm_output_tokens}`}>
              {formatTokens(totalTokens)} tok
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {fix.pr_url && (
            <a
              href={fix.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover underline"
            >
              View PR{fix.pr_number ? ` #${fix.pr_number}` : ''}
            </a>
          )}
          {traceUrl && (
            <a
              href={traceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-muted hover:text-accent underline-offset-2 hover:underline"
              title="Inspect this fix's LLM call in Langfuse — prompts, output, token cost"
            >
              Langfuse trace
            </a>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="text-fg-muted hover:text-fg underline-offset-2 hover:underline"
          >
            {isOpen ? 'Hide details' : 'Show details'}
          </button>
          {fix.status === 'failed' && (
            <button
              type="button"
              onClick={() => void onRetry()}
              className="text-warn hover:text-warn underline-offset-2 hover:underline"
            >
              Retry
            </button>
          )}
        </div>

        {isOpen && (
          <div className="mt-1 pt-2 border-t border-edge space-y-2">
            {timeline ? (
              <div>
                <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-1">
                  PDCA timeline
                </h4>
                <FixGitGraph
                  events={timeline}
                  prUrl={fix.pr_url}
                  prNumber={fix.pr_number}
                  prState={fix.pr_state}
                  branchName={fix.branch}
                  commitSha={fix.commit_sha}
                  agentModel={fix.llm_model ?? fix.agent}
                  filesChanged={fix.files_changed}
                  linesChanged={fix.lines_changed}
                />
              </div>
            ) : (
              <p className="text-2xs text-fg-faint">Loading timeline…</p>
            )}
            {fix.rationale && (
              <div>
                <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">Rationale</h4>
                <p className="text-xs text-fg-secondary whitespace-pre-wrap">{fix.rationale}</p>
              </div>
            )}
            {fix.files_changed && fix.files_changed.length > 0 && (
              <div>
                <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">
                  Files changed
                </h4>
                <ul className="text-2xs font-mono text-fg-muted space-y-0.5">
                  {fix.files_changed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {specWarnings.length > 0 && (
              <div>
                <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">
                  Spec validation warnings
                </h4>
                <ul className="text-2xs text-fg-secondary space-y-1">
                  {specWarnings.map((w, i) => (
                    <li
                      key={`${w.code}-${i}`}
                      className="rounded border border-warn/40 bg-warn-muted/20 px-2 py-1"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-warn">{w.code}</span>
                        <span>{w.message}</span>
                      </div>
                      {w.hint && <p className="text-fg-muted mt-0.5">Hint: {w.hint}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {fix.agent === 'cursor_cloud' && fix.cursor_artifacts && fix.cursor_artifacts.length > 0 && (
              <CursorArtifactsGallery artifacts={fix.cursor_artifacts} />
            )}
            {inventoryAction && (
              <div>
                <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-1">
                  Origin — Inventory action
                </h4>
                <div className="rounded border border-edge bg-surface-overlay px-2 py-1.5 space-y-0.5 text-2xs">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-accent">{inventoryAction.actionLabel}</span>
                    {inventoryAction.status && (
                      <span
                        className={
                          inventoryAction.status === 'verified'
                            ? 'text-ok'
                            : inventoryAction.status === 'regressed'
                            ? 'text-danger'
                            : 'text-fg-muted'
                        }
                      >
                        {inventoryAction.status}
                      </span>
                    )}
                  </div>
                  {inventoryAction.actionDescription && (
                    <p className="text-fg-secondary">{inventoryAction.actionDescription}</p>
                  )}
                  {inventoryAction.pagePath && (
                    <p className="text-fg-muted font-mono">{inventoryAction.pagePath}</p>
                  )}
                  {inventoryAction.storyTitle && (
                    <p className="text-fg-faint">Story: {inventoryAction.storyTitle}</p>
                  )}
                  {inventoryAction.expectedOutcome && (
                    <p className="text-ok/80 mt-0.5">
                      ✓ expected_outcome contract attached — synthetic monitor will probe after merge
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {fix.error && (
          <div className="rounded bg-danger-muted/40 px-2 py-1.5 text-2xs text-danger">
            <span className="font-mono uppercase tracking-wide">Error · </span>
            <span className="font-mono">{fix.error}</span>
          </div>
        )}
      </Card>
    </div>
  );
}
