/**
 * FILE: packages/web/src/widget-helpers.ts
 * PURPOSE: Stateless helpers, constants, and shared types for the bug-capture
 *          widget. Extracted verbatim from widget.ts to keep that file focused
 *          on the MushiWidget class (DOM structure, state, lifecycle).
 *
 * OVERVIEW:
 * - Pure functions: reporter-status copy mappers, relative-time formatting,
 *   the step-number padder, the submit-shortcut detector, and HTML escaping.
 * - Constants: category icon map, the feature-request intent wire string, the
 *   total step count, and the per-step ledger number.
 * - Shared types: WidgetStep, the reporter status tone union, and the public
 *   WidgetRewardsState / WidgetSubmitOutcome / WidgetCallbacks contracts (these
 *   three are re-exported from widget.ts so existing `./widget` import sites and
 *   the package barrel keep working unchanged).
 *
 * DEPENDENCIES:
 * - @mushi-mushi/core — report / reporter wire types referenced by the contracts.
 *
 * USAGE:
 * - Imported by widget.ts (the MushiWidget class) and widget-render.ts (the
 *   stateless view layer). No DOM/browser state lives here.
 *
 * NOTES:
 * - Behaviour-preserving move: bodies are identical to the pre-split widget.ts.
 */
import type {
  MushiAssistantReply,
  MushiReportCategory,
  MushiReporterComment,
  MushiReporterReport,
} from '@mushi-mushi/core';
import {
  isLikelyGenericFavicon,
  projectFaviconUrlCandidates,
  projectInitials,
  resolveProjectDomain,
} from '@mushi-mushi/core';

/** One rendered turn in the in-widget assistant thread. */
export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
  /** For clarify replies — present on assistant turns only. */
  options?: string[];
  /**
   * When true, render a primary "File a report" recovery CTA under this
   * turn (clarify / unsure paths). Login is never required for Ask.
   */
  offerReport?: boolean;
}

/** sessionStorage key for same-tab Ask transcript resume (UX only — not auth). */
export const ASSISTANT_SESSION_STORAGE_KEY = 'mushi-assistant-session-v1';

export type AssistantSessionSnapshot = {
  turns: AssistantTurn[];
  threadId: string | null;
};

export function loadAssistantSession(): AssistantSessionSnapshot | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(ASSISTANT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const turns = Array.isArray(record.turns) ? record.turns : null;
    if (!turns) return null;
    const normalized: AssistantTurn[] = [];
    for (const item of turns) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      if (t.role !== 'user' && t.role !== 'assistant') continue;
      if (typeof t.text !== 'string') continue;
      const turn: AssistantTurn = { role: t.role, text: t.text };
      if (Array.isArray(t.options)) {
        const options = t.options.filter((o): o is string => typeof o === 'string');
        if (options.length) turn.options = options;
      }
      if (t.offerReport === true) turn.offerReport = true;
      normalized.push(turn);
    }
    const threadId =
      typeof record.threadId === 'string' && record.threadId.length > 0
        ? record.threadId
        : null;
    return { turns: normalized, threadId };
  } catch {
    return null;
  }
}

export function saveAssistantSession(snapshot: AssistantSessionSnapshot): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (!snapshot.turns.length && !snapshot.threadId) {
      sessionStorage.removeItem(ASSISTANT_SESSION_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(ASSISTANT_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // private browsing / quota — Ask still works in-memory
  }
}

export function clearAssistantSession(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(ASSISTANT_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export type WidgetStep =
  | 'category'
  | 'intent'
  | 'details'
  | 'success'
  | 'reports'
  | 'report-detail'
  | 'leaderboard'
  | 'roadmap'
  | 'account'
  | 'cross-app-reports'
  | 'assistant';

export const CATEGORY_ICONS: Record<MushiReportCategory, string> = {
  bug: '\u26A0\uFE0F',
  slow: '\uD83D\uDC0C',
  visual: '\uD83C\uDFA8',
  confusing: '\uD83D\uDE15',
  other: '\uD83D\uDCDD',
};

/**
 * Wire-format "feature request" intent string. Always written into the
 * report's `user_category` field (not `category`) so we don't have to
 * widen the DB CHECK constraint on `reports.category`. The widget UI
 * presents it as a first-class card alongside the five real categories
 * because beta apps live or die by how easy it is to file a feature
 * request — burying it as an intent under "Other" suppresses signal.
 */
export const FEATURE_REQUEST_INTENT = 'Feature request';

export type ReporterStatusTone = 'sent' | 'review' | 'fixing' | 'fixed' | 'closed' | 'unknown';

/** Compact status pill copy for list rows. */
export function reporterStatusShort(status: string): string {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'Sent';
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'Review';
    case 'fixing':
      return 'Fixing';
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'Fixed';
    case 'dismissed':
      return 'Closed';
    default:
      return status.replace(/_/g, ' ').slice(0, 12);
  }
}

/** Map raw DB status to reporter-facing copy (detail views). */
export function reporterStatusLabel(status: string): string {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'Submitted';
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'In review';
    case 'fixing':
      return 'Fix in progress';
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'Fixed — confirm?';
    case 'verified':
      return 'Verified';
    case 'reopened':
      return 'Reopened';
    case 'dismissed':
      return 'Closed';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function reporterStatusTone(status: string): ReporterStatusTone {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'sent';
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'review';
    case 'fixing':
      return 'fixing';
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'fixed';
    case 'verified':
      return 'fixed';
    case 'reopened':
      return 'fixing';
    case 'dismissed':
      return 'closed';
    default:
      return 'unknown';
  }
}

/** Human-readable relative time, e.g. "2h ago". */
export function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The two-digit padded step number used in the header ledger ("01 / 03"). */
export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const TOTAL_STEPS = 3;
export const STEP_NUMBER: Record<Exclude<WidgetStep, 'success'>, number> = {
  category: 1,
  intent: 2,
  details: 3,
  reports: 1,
  'report-detail': 1,
  leaderboard: 1,
  roadmap: 1,
  account: 1,
  'cross-app-reports': 1,
  assistant: 1,
};

/** Detects modifier-key presses for the Ctrl/Cmd+Enter submit shortcut.
 *  metaKey covers macOS, ctrlKey covers Windows/Linux/ChromeOS. */
export function isSubmitShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WidgetRewardsState {
  tier: { slug: string; displayName: string; pointsThreshold: number } | null;
  nextTier: { displayName: string; pointsThreshold: number } | null;
  totalPoints: number;
  /** Expected base points for a `report_submit` action (default 50). */
  pointsForReport: number;
}

export interface WidgetSubmitOutcome {
  /** Server-confirmed report id. When `null` the report was queued
   *  offline / failed-and-queued for retry; the success step degrades
   *  gracefully (no "track on console" link, just the receipt stamp). */
  reportId: string | null;
  /** Convenience flag for the widget to decide whether to render the
   *  optimistic copy ("queued offline, we'll send it when you're back")
   *  versus the confirmed copy ("received — track at #abc12345"). */
  queuedOffline?: boolean;
  /**
   * Distinguishes why a submit did not confirm immediately. Lets the
   * receipt tell the truth instead of always saying "queued offline":
   *   - offline: navigator says offline, will flush on reconnect
   *   - retrying: transient network/5xx — queued for automatic retry
   *   - rate_limited: 429 — user should wait before sending more
   *   - quota: 403 entitlement/quota — will not succeed on retry
   *   - permanent: validation / payload too large — dropped, not queued
   */
  failureKind?: 'offline' | 'retrying' | 'rate_limited' | 'quota' | 'permanent';
  /** The report went through but its screenshot had to be shed (couldn't
   *  compress under the wire budget, or the server said PAYLOAD_TOO_LARGE).
   *  The success receipt says so instead of implying the image landed. */
  screenshotDropped?: boolean;
}

export interface WidgetCallbacks {
  /**
   * Returns the outcome of the submission so the widget can render a
   * real receipt (report id, deep link). Older callers that return
   * `void` still work — the widget falls back to the legacy stamp.
   */
  onSubmit(
    data: {
      category: MushiReportCategory;
      /** Set when the host configured `widget.categories` — the raw custom id chosen by the user. */
      userCategory?: string;
      description: string;
      intent?: string;
    },
  ): void | Promise<WidgetSubmitOutcome | void>;
  onOpen(): void;
  onClose(): void;
  onScreenshotRequest(): void;
  onScreenshotRemove?(): void;
  /** Optional markup pass (highlight / blur / arrow) before submit. */
  onScreenshotAnnotateRequest?(container: HTMLElement): void | Promise<void>;
  onElementSelectorRequest?(): void;
  onReporterReportsRequest?(): Promise<MushiReporterReport[]>;
  onReporterCommentsRequest?(reportId: string): Promise<MushiReporterComment[]>;
  onReporterReply?(reportId: string, body: string): Promise<void>;
  onReporterFeedback?(reportId: string, signal: string, note?: string): Promise<Record<string, unknown> | null>;
  onReporterReopen?(reportId: string, note?: string): Promise<Record<string, unknown> | null>;
  onFeatureBoardRequest?(): Promise<Array<Record<string, unknown>>>;
  onFeatureBoardVote?(requestId: string): Promise<{ voted: boolean; action: string }>;
  onLeaderboardOpen?(): void;
  /** Request a magic-link sign-in for the in-widget Mushi community. */
  onMushiSignIn?(email: string): Promise<{ ok: boolean; error?: string }>;
  /** Fetch the global public leaderboard for the in-widget Mushi community. */
  onGlobalLeaderboardOpen?(): void;
  /** Fetch cross-app reports for the signed-in tester. */
  onCrossAppReportsOpen?(): void;
  /** Called when the user signs out of the in-widget community session.
   *  Host should clear any persisted tester JWT. */
  onTesterSignOut?(): void;

  // ─── Assistant tab (P5) ──────────────────────────────────────────
  /** Whether the assistant tab should be shown at all. */
  assistantEnabled?: boolean;
  /** Tab label + greeting + starter suggestions for the empty thread. */
  assistantLabel?: string;
  assistantGreeting?: string;
  assistantSuggestions?: string[];
  /** Send one assistant turn; resolves with the structured reply. */
  onAssistantAsk?(message: string, threadId: string | null): Promise<MushiAssistantReply | null>;
}

/** HTML for a project/app icon chip with CDN fallback wired post-render. */
export function renderAppIconHtml(opts: {
  projectId: string;
  appName: string;
  appSlug?: string | null;
  appDomain?: string | null;
}): string {
  const domain =
    opts.appDomain ??
    resolveProjectDomain({
      project_id: opts.projectId,
      project_name: opts.appName,
      project_slug: opts.appSlug ?? '',
    });
  const initials = escapeHtml(projectInitials(opts.appName));
  const candidates = projectFaviconUrlCandidates({
    project_id: opts.projectId,
    project_name: opts.appName,
    project_slug: opts.appSlug ?? '',
    sdk_origin: opts.appDomain ? `https://${opts.appDomain}` : null,
  });
  if (!candidates.length) {
    return `<span class="mushi-app-icon mushi-app-icon-initials-only" aria-hidden="true">${initials}</span>`;
  }
  const encoded = escapeHtml(JSON.stringify(candidates));
  return `<span class="mushi-app-icon" data-mushi-favicon data-candidates="${encoded}" data-initials="${initials}" aria-hidden="true" title="${escapeHtml(domain ?? opts.appName)}">
    <img class="mushi-app-icon-img" src="${escapeHtml(candidates[0]!)}" alt="" referrerpolicy="no-referrer" width="16" height="16" />
    <span class="mushi-app-icon-initials" hidden>${initials}</span>
  </span>`;
}

/** Wire favicon fallback chain for icons rendered by {@link renderAppIconHtml}. */
export function bindFaviconFallbacks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-mushi-favicon]').forEach((wrap) => {
    const img = wrap.querySelector<HTMLImageElement>('.mushi-app-icon-img');
    const fallback = wrap.querySelector<HTMLElement>('.mushi-app-icon-initials');
    if (!img || !fallback) return;
    let candidates: string[] = [];
    try {
      candidates = JSON.parse(wrap.dataset.candidates ?? '[]') as string[];
    } catch {
      candidates = [];
    }
    let index = 0;
    const tryNext = () => {
      index += 1;
      if (index < candidates.length) {
        img.src = candidates[index]!;
      } else {
        img.remove();
        fallback.hidden = false;
        wrap.classList.add('mushi-app-icon-initials-only');
      }
    };
    img.onerror = tryNext;
    img.onload = () => {
      if (isLikelyGenericFavicon(img)) tryNext();
    };
  });
}
