/**
 * FILE: apps/admin/src/components/PrivacyPostureBadge.tsx
 * PURPOSE: Tiny sidebar chip that says whose AI key this app's diagnoses run
 *          on, in plain words (re-audit 2026-11-11: "All LLM calls run under
 *          your own API key ... All systems BYOK" was jargon, and an account
 *          with no key of its own is the normal free state, not a warning).
 *          Green = "AI runs on your own key" (a key saved for this app or its
 *          team). Blue = "AI runs on Mushi Mushi's key" (the hosted default,
 *          no key of your own). Grey = the key check failed, so the chip does
 *          not guess. The state is the server's (GET /privacy-status).
 *
 *          Clicking the chip opens a small popover with the detail (AI key,
 *          storage host, region, retention window, last audit). Its link
 *          goes to Settings → AI keys.
 */

import { useId, useRef } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageData } from '../lib/usePageData';
import { Tooltip } from './ui';
import { NavRailFlyout } from './sidebar/NavRailFlyout';
import { CHIP_TONE } from '../lib/chipTone';
import { useActiveProjectId } from './ProjectSwitcher';

interface PrivacyStatus {
  /** Null when the key check failed. False means the platform key is in use. */
  byok_configured: boolean | null;
  llm_provider?: 'byok' | 'platform' | 'unknown' | string;
  storage_provider: string | null;
  region: string | null;
  retention_days: number | null;
  last_audit_at: string | null;
  require_byok?: boolean;
}

interface Props {
  /** Collapse to icon-only when sidebar is collapsed */
  compact?: boolean;
}

export function PrivacyPostureBadge({ compact = false }: Props) {
  // No project yet (a brand-new account) is a normal first-run state, not a
  // privacy failure: render nothing rather than a red "unavailable" chip. A
  // stale stored project id still gets the server's `no_projects` answer, so
  // that is treated the same way.
  const activeProjectId = useActiveProjectId();
  // The path names the app on screen. The hook's cache key is the path, and
  // the server prefers ?project_id= over the header, so two sessions looking
  // at one app ask for that app even when a stored header still names another.
  const { data, loading, error, errorMessage, reload } = usePageData<PrivacyStatus>(
    activeProjectId
      ? `/v1/admin/privacy-status?project_id=${encodeURIComponent(activeProjectId)}`
      : null,
    { deps: [activeProjectId] },
  );

  const [popoverOpen, setPopoverOpen] = useState(false);
  const badgeRef = useRef<HTMLButtonElement>(null);
  // Rail variant's screen-reader description; useId so it can never collide
  // with a NavRailLink's `rail-desc-*` id.
  const railDescId = useId();

  if (!activeProjectId || errorMessage === 'no_projects') return null;
  if (loading) return null;

  // Null is a failed check, not the platform key. A missing payload (no
  // error either) stays on the platform wording only when the server said so.
  const unknown =
    data != null && (data.llm_provider === 'unknown' || data.byok_configured === null);
  const isByok = data?.byok_configured === true;
  const label = error
    ? 'AI key not checked'
    : unknown
      ? 'AI key unknown'
      : isByok
        ? 'Your own AI key'
        : "Mushi Mushi's AI key";
  const labelLong = error
    ? 'Could not check the AI key'
    : unknown
      ? 'AI key unknown'
      : isByok
        ? 'AI runs on your own key'
        : "AI runs on Mushi Mushi's key";
  // Mushi Mushi's key is the hosted default, so it is information, not a warning.
  const dotClass = error ? 'bg-danger' : unknown ? 'bg-fg-faint' : isByok ? 'bg-ok' : 'bg-info';
  const textClass = error
    ? CHIP_TONE.dangerSubtle
    : unknown
      ? CHIP_TONE.neutral
      : isByok
        ? CHIP_TONE.okSubtle
        : CHIP_TONE.infoSubtle;

  // Base explanation, free of any click affordance — the two variants do
  // different things on click (the expanded badge opens a popover, the rail
  // item navigates to Settings), so each appends its own call to action.
  const postureExplanation = error
    ? 'Could not check which AI key this app uses. Retry, or open the AI key settings.'
    : unknown
      ? 'Could not check which AI key this app uses. Retry, or open the AI key settings.'
      : isByok
        ? "The AI that explains this app's bugs runs on an AI key saved for the app or its team, not on Mushi Mushi's key."
        : "The AI that explains this app's bugs runs on Mushi Mushi's key, at no cost to you. To run it on your own account instead, add your own AI key in Settings.";

  const tooltipContent =
    error || isByok ? postureExplanation : `${postureExplanation} Click for details.`;

  if (compact) {
    // Rail variant: same 44px `.nav-rail-item` hit area as every other rail
    // control, and the same title/description/status flyout — a bare coloured
    // dot with no label is exactly the kind of thing an icon rail must explain
    // on hover.
    const railDescription = error
      ? postureExplanation
      : `${postureExplanation} Opens the AI key settings.`;
    return (
      <Tooltip
        side="right"
        portal
        content={
          <NavRailFlyout
            title="AI key"
            description={railDescription}
            status={{
              // Mushi Mushi's key is the hosted default: no warning dot for it.
              tone: error ? 'danger' : isByok ? 'ok' : 'idle',
              label: labelLong,
            }}
          />
        }
      >
        <Link
          to="/settings?tab=byok"
          className="nav-rail-item"
          aria-label={`AI key: ${label}`}
          aria-describedby={railDescId}
        >
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
          {/* The flyout is portaled and only exists while hovered, so the
              explanation also lives here, in the DOM, as NavRailLink does. */}
          <span id={railDescId} className="sr-only">
            {railDescription} — {labelLong}
          </span>
        </Link>
      </Tooltip>
    );
  }

  return (
    <div className="relative">
      <Tooltip content={tooltipContent} side="right" portal>
        <button
          ref={badgeRef}
          type="button"
          className="flex items-center gap-1.5 w-full px-2 py-1 rounded-sm hover:bg-surface-raised transition-opacity"
          aria-label={`${labelLong} — click for details`}
          title={labelLong}
          onClick={() => setPopoverOpen((v) => !v)}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
          <span
            className={`inline-flex min-w-0 truncate rounded-sm px-1 py-px text-2xs font-medium ${textClass}`}
          >
            {label}
          </span>
        </button>
      </Tooltip>

      {popoverOpen && (
        <div
          className="absolute bottom-full left-0 mb-1 w-60 bg-surface-raised border border-edge rounded-md shadow-lg p-3 space-y-2 z-50 text-2xs"
          role="dialog"
          aria-label="AI key and data details"
        >
          <button
            type="button"
            className="absolute top-1.5 right-1.5 rounded-sm px-1 text-danger hover:bg-danger-muted/50 text-xs leading-none"
            onClick={() => setPopoverOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
          <p className="font-semibold text-fg text-xs">{labelLong}</p>

          {error ? (
            <p className="text-danger-foreground leading-snug">{error}</p>
          ) : (
            <div className="space-y-1 text-fg-muted">
              <div className="flex justify-between">
                <span>AI key</span>
                <span
                  className={`font-mono ${
                    unknown
                      ? 'text-fg-secondary'
                      : isByok
                        ? 'text-ok-foreground'
                        : 'text-fg-secondary'
                  }`}
                >
                  {unknown
                    ? 'unknown'
                    : data?.llm_provider === 'byok' || isByok
                      ? 'your own'
                      : "Mushi Mushi's"}
                </span>
              </div>
              {data?.storage_provider && (
                <div className="flex justify-between">
                  <span>Storage</span>
                  <span className="font-mono text-fg-secondary">{data.storage_provider}</span>
                </div>
              )}
              {data?.region && (
                <div className="flex justify-between">
                  <span>Region</span>
                  <span className="font-mono text-fg-secondary">{data.region}</span>
                </div>
              )}
              {data?.retention_days != null && (
                <div className="flex justify-between">
                  <span>Retention</span>
                  <span className="font-mono text-fg-secondary">{data.retention_days}d</span>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/settings?tab=byok"
              className="text-2xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity hover:no-underline"
              onClick={() => setPopoverOpen(false)}
            >
              {isByok || unknown ? 'Open AI key settings →' : 'Use your own AI key →'}
            </Link>
            {(error || unknown) && (
              <button
                type="button"
                className="text-2xs text-danger underline hover:no-underline"
                onClick={() => {
                  reload();
                  setPopoverOpen(false);
                }}
              >
                Retry
              </button>
            )}
          </div>

          {data?.last_audit_at && (
            <p className="text-fg-faint text-3xs">
              Last audited {new Date(data.last_audit_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
