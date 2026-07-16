/**
 * FILE: packages/web/src/widget-render.ts
 * PURPOSE: Stateless view layer for the MushiWidget panel. Each function takes a
 *          WidgetRenderCtx snapshot (read-only state + bound helper closures the
 *          class builds once per render) and returns an HTML string.
 *
 * OVERVIEW:
 * - Extracted verbatim from widget.ts (the render*() methods) so that file can
 *   stay focused on DOM structure, state, lifecycle, and event wiring.
 * - WidgetRenderCtx is the contract between the class and this view layer. The
 *   class's renderCtx() builds it; tsc enforces both sides stay in sync.
 *
 * DEPENDENCIES:
 * - @mushi-mushi/core — report / reporter / leaderboard wire types.
 * - ./i18n — MushiLocale (string tables).
 * - ./widget-helpers — pure formatters, constants, and shared contracts.
 *
 * USAGE:
 * - renderStep / renderOutdatedBanner / renderBrandFooter are called by
 *   MushiWidget.render(); the rest are called transitively via ctx.
 *
 * NOTES:
 * - Behaviour-preserving move: bodies are identical to the pre-split methods,
 *   with `this.<member>` rewritten to `ctx.<member>` and inter-render calls to
 *   `render*(ctx, ...)`. No DOM/state mutation happens here.
 */
import type {
  MushiCrossAppReport,
  MushiCustomCategory,
  MushiLeaderboardEntry,
  MushiReportCategory,
  MushiReporterComment,
  MushiReporterReport,
  MushiTesterReputation,
  MushiWidgetConfig,
} from '@mushi-mushi/core';
import type { MushiLocale } from './i18n';
import {
  CATEGORY_ICONS,
  escapeHtml,
  formatRelativeTime,
  pad2,
  renderAppIconHtml,
  reporterStatusLabel,
  reporterStatusShort,
  reporterStatusTone,
  STEP_NUMBER,
  TOTAL_STEPS,
} from './widget-helpers';
import type { AssistantTurn, WidgetCallbacks, WidgetRewardsState, WidgetStep, WidgetSubmitOutcome } from './widget-helpers';

export interface WidgetRenderCtx {
  config: Required<MushiWidgetConfig>;
  rewardsState: WidgetRewardsState | null;
  lastReportId: string | null;
  reporterLoading: boolean;
  locale: MushiLocale;
  /**
   * Host-app user identity from `Mushi.identify()` or `identifyWithToken()`.
   * Shown as "Reporting as <name>" in the details step when present.
   * Distinct from the Mushi tester magic-link session.
   */
  identifiedUser: { name?: string; email?: string } | null;
  testerReputation: MushiTesterReputation | null;
  testerInfo: { id: string; public_handle: string | null; display_name: string | null } | null;
  screenshotCapturing: boolean;
  screenshotAttached: boolean;
  /** Data URL of the attached screenshot, rendered as a visible preview. */
  screenshotPreview: string | null;
  /** Resolved privacy caption shown beside the preview; null hides it. */
  screenshotHint: string | null;
  /** False hides the Attach Screenshot button (capture disabled/unavailable). */
  screenshotAvailable: boolean;
  /** False hides the Select Element button (selector disabled/unavailable). */
  elementAvailable: boolean;
  reporterError: string | null;
  magicLinkError: string;
  elementCapturing: boolean;
  submitting: boolean;
  sdkFreshness: { latest: string | null; current: string; deprecated: boolean; message?: string | null } | null;
  screenshotError: boolean;
  reporterReports: MushiReporterReport[];
  magicLinkSending: boolean;
  magicLinkEmail: string;
  globalLeaderboardLoading: boolean;
  globalLeaderboard: MushiLeaderboardEntry[] | null;
  elementSelected: boolean;
  /** True when the last element-selection attempt failed or was cancelled unexpectedly. */
  elementError: boolean;
  crossAppLoading: boolean;
  callbacks: WidgetCallbacks;
  testerJwt: string | null;
  submittedAt: Date | null;
  step: WidgetStep;
  selectedReportId: string | null;
  selectedCategory: string | null;
  sdkVersion: string;
  reporterComments: MushiReporterComment[];
  magicLinkSent: boolean;
  leaderboardLoading: boolean;
  leaderboardEntries: Array<{ display_name: string; tier_name: string | null; total_points: number; points_30d: number }> | null;
  lastSubmitQueuedOffline: boolean;
  lastSubmitFailureKind: WidgetSubmitOutcome['failureKind'];
  lastSubmitScreenshotDropped: boolean;
  featureBoard: Array<Record<string, unknown>>;
  crossAppReports: MushiCrossAppReport[] | null;
  allowScreenshotRemove: boolean;
  unreadCount: () => number;
  tierColor: (slug: string) => string;
  resolveCustomCategory: (id: string) => MushiCustomCategory | undefined;
  effectiveMinLength: () => number;
  categoryLabel: (id: string) => string;
  categoryIcon: (id: string) => string;
  // ─── Assistant tab (P5) ──────────────────────────────────────────
  assistantTurns: AssistantTurn[];
  assistantSending: boolean;
  assistantError: string | null;
  // ─── Progressive disclosure ──────────────────────────────────────
  showAllCategories: boolean;
  /** Secondary hub links (inbox, assistant, community) collapsed under "More". */
  showMoreNav: boolean;
  /** Host page favicon — shown in header during report flow when available. */
  pageFaviconHref: string | null;
}

export function renderStep(ctx: WidgetRenderCtx): string {
    switch (ctx.step) {
      case 'category': return renderCategoryStep(ctx);
      case 'intent': return renderIntentStep(ctx);
      case 'details': return renderDetailsStep(ctx);
      case 'success': return renderSuccessStep(ctx);
      case 'reports': return renderReportsStep(ctx);
      case 'report-detail': return renderReportDetailStep(ctx);
      case 'leaderboard': return renderLeaderboardStep(ctx);
      case 'roadmap': return renderRoadmapStep(ctx);
      case 'account': return renderAccountStep(ctx);
      case 'cross-app-reports': return renderCrossAppReportsStep(ctx);
      case 'assistant': return renderAssistantStep(ctx);
    }
  }

/**
 * Page-aware assistant tab. A simple chat transcript + composer that shares
 * the panel chrome. Replies (answer / clarify) are rendered as assistant
 * bubbles; clarify options become quick-reply chips. The greeting + starter
 * suggestions come from the assistant config (console-overridable).
 */
export function renderAssistantStep(ctx: WidgetRenderCtx): string {
  const t = ctx.locale;
  const label = ctx.callbacks.assistantLabel || t.assistant.defaultLabel;
  const greeting = ctx.callbacks.assistantGreeting || t.assistant.defaultGreeting;
  const suggestions = ctx.callbacks.assistantSuggestions ?? [];
  const empty = ctx.assistantTurns.length === 0;

  const transcript = empty
    ? `<div class="mushi-assistant-greeting">${escapeHtml(greeting)}</div>
       ${suggestions.length ? `<div class="mushi-assistant-suggestions">${suggestions
         .map((s) => `<button type="button" class="mushi-assistant-chip" data-action="assistant-suggest" data-value="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
         .join('')}</div>` : ''}`
    : ctx.assistantTurns
        .map((turn) => {
          const cls = turn.role === 'user' ? 'mushi-assistant-msg-user' : 'mushi-assistant-msg-bot';
          const opts = turn.options && turn.options.length
            ? `<div class="mushi-assistant-suggestions">${turn.options
                .map((o) => `<button type="button" class="mushi-assistant-chip" data-action="assistant-suggest" data-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`)
                .join('')}</div>`
            : '';
          const reportCta = turn.offerReport
            ? `<div class="mushi-assistant-recovery">
                 <button type="button" class="mushi-assistant-report-cta" data-action="assistant-report">${escapeHtml(t.assistant.fileReportCta)}</button>
               </div>`
            : '';
          return `<div class="mushi-assistant-msg ${cls}">${escapeHtml(turn.text)}</div>${opts}${reportCta}`;
        })
        .join('');

  const thinking = ctx.assistantSending
    ? `<div class="mushi-assistant-msg mushi-assistant-msg-bot mushi-assistant-thinking" role="status" aria-live="polite">${escapeHtml(t.assistant.thinking)}</div>`
    : '';
  const error = ctx.assistantError
    ? `<div class="mushi-assistant-error" role="alert">${escapeHtml(ctx.assistantError)}
         <button type="button" class="mushi-assistant-report-cta" data-action="assistant-report">${escapeHtml(t.assistant.fileReportCta)}</button>
       </div>`
    : '';
  const stillStuck =
    !empty && !ctx.assistantSending && !ctx.assistantError
      ? `<div class="mushi-assistant-recovery mushi-assistant-recovery-footer">
           <button type="button" class="mushi-assistant-report-link" data-action="assistant-report">${escapeHtml(t.assistant.stillStuckCta)}</button>
         </div>`
      : '';

  return `
    ${renderHeader(ctx, { title: label, showBack: true })}
    <div class="mushi-assistant">
      <div class="mushi-assistant-log">
        ${transcript}
        ${thinking}
        ${error}
        ${stillStuck}
      </div>
      <form class="mushi-assistant-form" data-action="assistant-send">
        <textarea
          class="mushi-assistant-input"
          rows="1"
          placeholder="${escapeHtml(t.assistant.inputPlaceholder)}"
          ${ctx.assistantSending ? 'disabled' : ''}
        ></textarea>
        <button type="submit" class="mushi-assistant-submit" ${ctx.assistantSending ? 'disabled' : ''} aria-label="${escapeHtml(t.assistant.sendAriaLabel)}">\u2191</button>
      </form>
    </div>
  `;
}
export function renderOutdatedBanner(ctx: WidgetRenderCtx): string {
    if (!ctx.sdkFreshness) return '';
    if (ctx.config.outdatedBanner === 'off' || ctx.config.outdatedBanner === 'console-only') return '';
    const { latest, current, deprecated, message } = ctx.sdkFreshness;
    if (!latest && !deprecated) return '';
    return `
      <div class="mushi-outdated" role="status">
        <strong>Mushi SDK ${escapeHtml(current)}</strong>
        ${latest ? `latest is ${escapeHtml(latest)}.` : 'needs attention.'}
        ${message ? `<span>${escapeHtml(message)}</span>` : ''}
      </div>
    `;
  }
export function renderBrandFooter(ctx: WidgetRenderCtx): string {
    if (ctx.config.brandFooter === false) return '';
    return `<div class="mushi-brand-footer">${escapeHtml(ctx.locale.flows.poweredBy.replace('{version}', ctx.sdkVersion))}</div>`;
  }

  /**
   * Editorial masthead. Always carries:
   *   • the brand mark (虫 kanji on vermillion, "MUSHI" in mono above)
   *   • the page title (serif display)
   *   • the close affordance
   *
   * On sub-steps it additionally renders a back button (replacing the
   * "MUSHI" eyebrow with a "← BACK" mono link) and a step counter
   * ledger ("02 / 03") on the far right.
   */
export function renderHeader(ctx: WidgetRenderCtx, opts: {
    title: string;
    showBack?: boolean;
    step?: number;
    eyebrow?: string;
  }): string {
    const t = ctx.locale;
    const { title, showBack = false, step, eyebrow } = opts;

    const eyebrowHtml = showBack
      ? `<button type="button" class="mushi-back" data-action="back" aria-label="${escapeHtml(t.widget.back)}">\u2190 ${escapeHtml(t.widget.back)}</button>`
      : `<span class="mushi-header-eyebrow">${escapeHtml(eyebrow ?? 'Mushi \u00B7 Report')}</span>`;

    const counterHtml = step
      ? `<span class="mushi-step-counter" aria-label="Step ${step} of ${TOTAL_STEPS}"><b>${pad2(step)}</b> / ${pad2(TOTAL_STEPS)}</span>`
      : '';

    return `
      <div class="mushi-header">
        <div class="mushi-header-mark" aria-hidden="true">${ctx.pageFaviconHref
          ? `<img class="mushi-header-host-icon" src="${escapeHtml(ctx.pageFaviconHref)}" alt="" referrerpolicy="no-referrer" width="20" height="20" />`
          : '\u866B'}</div>
        <div class="mushi-header-titles">
          ${eyebrowHtml}
          <h3>${title}</h3>
        </div>
        <div class="mushi-header-meta">
          ${counterHtml}
          <button type="button" class="mushi-close" data-action="close" aria-label="${escapeHtml(t.widget.close)}">\u2715</button>
        </div>
      </div>
    `;
  }

  /**
   * Numeral step indicator: "01 — 02 — 03", with the active step in
   * vermillion serif and completed steps struck through in mono.
   * Replaces the original three-dot indicator (a generic SaaS pattern).
   */
export function renderStepIndicator(_ctx: WidgetRenderCtx, currentStep: number): string {
    const segments: string[] = [];
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const cls =
        i < currentStep ? 'mushi-step-num done' :
        i === currentStep ? 'mushi-step-num active' :
        'mushi-step-num';
      segments.push(`<span class="${cls}">${pad2(i)}</span>`);
      if (i < TOTAL_STEPS) segments.push('<span class="mushi-step-sep" aria-hidden="true"></span>');
    }
    return `<div class="mushi-step-indicator" aria-hidden="true">${segments.join('')}</div>`;
  }

/**
 * Secondary hub destinations (inbox, roadmap, assistant, account) live behind
 * a single "More" disclosure so the report path stays visually primary.
 */
function countMoreNavItems(ctx: WidgetRenderCtx): number {
  let n = 1; // Your reports — always present
  if (ctx.callbacks.onFeatureBoardRequest) n += 1;
  if (ctx.callbacks.assistantEnabled) n += 1;
  if (ctx.rewardsState) n += 1; // leaderboard
  n += 1; // account / community
  return n;
}

function renderMoreNavSection(ctx: WidgetRenderCtx): string {
  const t = ctx.locale;
  const mn = t.step1.moreNav;
  const count = countMoreNavItems(ctx);
  const toggleLabel = `${t.step1.moreNavLabel} (${count})`;
  const unread = ctx.unreadCount();
  const reportsLabel = unread
    ? `${mn.yourReports} (${unread} ${mn.unreadNew})`
    : mn.yourReports;

  const panelItems: string[] = [
    `<button type="button" class="mushi-option-btn mushi-reports-entry" data-action="reports">
      <span class="mushi-option-icon" aria-hidden="true">\uD83D\uDCEC</span>
      <div class="mushi-option-text">
        <span class="mushi-option-label">${escapeHtml(reportsLabel)}</span>
        <span class="mushi-option-desc">${escapeHtml(mn.yourReportsDesc)}</span>
      </div>
      <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
    </button>`,
  ];

  if (ctx.callbacks.onFeatureBoardRequest) {
    panelItems.push(`
      <button type="button" class="mushi-option-btn" data-action="roadmap">
        <span class="mushi-option-icon" aria-hidden="true">\uD83D\uDDF3\uFE0F</span>
        <div class="mushi-option-text">
          <span class="mushi-option-label">${escapeHtml(mn.communityIdeas)}</span>
          <span class="mushi-option-desc">${escapeHtml(mn.communityIdeasDesc)}</span>
        </div>
        <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
      </button>`);
  }

  if (ctx.callbacks.assistantEnabled) {
    panelItems.push(`
      <button type="button" class="mushi-option-btn" data-action="assistant">
        <span class="mushi-option-icon" aria-hidden="true">\uD83D\uDCAC</span>
        <div class="mushi-option-text">
          <span class="mushi-option-label">${escapeHtml(ctx.callbacks.assistantLabel || t.assistant.defaultLabel)}</span>
          <span class="mushi-option-desc">${escapeHtml(t.assistant.hubDescription)}</span>
        </div>
        <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
      </button>`);
  }

  if (ctx.rewardsState) {
    panelItems.push(`
      <button type="button" class="mushi-link-btn mushi-more-nav-link" data-action="open-leaderboard">\uD83C\uDFC6 ${escapeHtml(mn.leaderboard)}</button>`);
  }

  panelItems.push(`
    <button type="button" class="mushi-link-btn mushi-more-nav-link" data-action="open-account">
      ${ctx.testerInfo
        ? `\uD83D\uDC64 ${escapeHtml(ctx.testerInfo.public_handle ?? ctx.testerInfo.display_name ?? mn.myAccount)}`
        : `\uD83C\uDF10 ${escapeHtml(mn.joinCommunity)}`}
    </button>`);

  const panelHtml = ctx.showMoreNav
    ? `<div class="mushi-more-nav-panel">${panelItems.join('')}</div>`
    : '';

  return `
    <div class="mushi-more-nav">
      <button
        type="button"
        class="mushi-more-toggle mushi-more-nav-toggle"
        data-action="toggle-more-nav"
        aria-expanded="${ctx.showMoreNav ? 'true' : 'false'}"
      >
        <span class="mushi-more-toggle-text">${escapeHtml(toggleLabel)}</span>
        <span class="mushi-more-toggle-arrow" aria-hidden="true">${ctx.showMoreNav ? '\u25BE' : '\u25B8'}</span>
      </button>
      ${panelHtml}
    </div>
  `;
}

export function renderCategoryStep(ctx: WidgetRenderCtx): string {
    const t = ctx.locale;
    // When the host supplies custom categories, render those instead of the
    // built-in five. The feature-request shortcut is still shown above them
    // unless explicitly disabled (consistent UX regardless of category set).
    const categoryEntries: Array<{ id: string; icon: string; label: string; desc: string }> =
      ctx.config.categories && ctx.config.categories.length > 0
        ? ctx.config.categories.map((c) => ({
            id: c.id,
            icon: c.icon ?? '💬',
            label: c.label,
            desc: c.description ?? '',
          }))
        : (['bug', 'slow', 'visual', 'confusing', 'other'] as MushiReportCategory[]).map((id) => ({
            id,
            icon: CATEGORY_ICONS[id],
            label: t.step1.categories[id],
            desc: t.step1.categoryDescriptions[id],
          }));

    const renderEntry = ({ id, icon, label, desc }: typeof categoryEntries[0]) => `
      <button type="button" class="mushi-option-btn" data-category="${escapeHtml(id)}" role="radio" aria-checked="false">
        <span class="mushi-option-icon" aria-hidden="true">${escapeHtml(icon)}</span>
        <div class="mushi-option-text">
          <span class="mushi-option-label">${escapeHtml(label)}</span>
          ${desc ? `<span class="mushi-option-desc">${escapeHtml(desc)}</span>` : ''}
        </div>
        <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
      </button>
    `;

    // Progressive disclosure: for the default built-in set, always show 'bug'
    // (the most common) and hide slower/rarer categories behind a toggle.
    // Custom category sets are shown in full (host knows which are primary).
    const isCustom = ctx.config.categories && ctx.config.categories.length > 0;
    const PRIMARY_LIMIT = 1; // show only 'bug' (index 0) by default
    const primaryEntries = isCustom ? categoryEntries : categoryEntries.slice(0, PRIMARY_LIMIT);
    const secondaryEntries = isCustom ? [] : categoryEntries.slice(PRIMARY_LIMIT);
    const hasMore = secondaryEntries.length > 0;

    const primaryCategories = primaryEntries.map(renderEntry).join('');
    const secondaryCategories = secondaryEntries.map(renderEntry).join('');

    const secondaryHtml = hasMore
      ? ctx.showAllCategories
        ? `<div class="mushi-categories-expanded">${secondaryCategories}</div>`
        : `<button type="button" class="mushi-more-toggle" data-action="show-all-categories">
             <span class="mushi-more-toggle-text">More issue types</span>
             <span class="mushi-more-toggle-count">${secondaryEntries.length} more</span>
             <span class="mushi-more-toggle-arrow" aria-hidden="true">\u2192</span>
           </button>`
      : '';

    return `
      ${renderHeader(ctx, { title: t.step1.heading, step: STEP_NUMBER.category })}
      ${ctx.config.betaMode?.enabled ? renderBetaStrip(ctx) : ''}
      <div class="mushi-body" role="radiogroup" aria-label="${escapeHtml(t.step1.heading)}">
        <p class="mushi-section-label">${escapeHtml(t.step1.reportSectionLabel)}</p>
        ${renderFeatureRequestEntry(ctx)}
        ${primaryCategories}
        ${secondaryHtml}
        ${ctx.rewardsState ? renderRewardsNudge(ctx) : ''}
        ${renderMoreNavSection(ctx)}
      </div>
    `;
  }

export function renderFeatureRequestEntry(ctx: WidgetRenderCtx): string {
    const enabled = ctx.config.featureRequestCard !== false;
    if (!enabled) return '';
    const f = ctx.locale.flows.featureRequest;
    const label = ctx.config.featureRequestLabel || f.label;
    const desc = ctx.config.featureRequestDescription || f.description;
    return `
      <button
        type="button"
        class="mushi-option-btn mushi-feature-entry"
        data-action="feature-request"
        aria-label="${escapeHtml(label)}"
      >
        <span class="mushi-option-icon" aria-hidden="true">\u2728</span>
        <div class="mushi-option-text">
          <span class="mushi-option-label">${escapeHtml(label)}</span>
          <span class="mushi-option-desc">${escapeHtml(desc)}</span>
        </div>
        <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
      </button>
    `;
  }

  /** Collapsible "What's new" changelog row. Closes the reporter feedback loop. */
export function renderBetaChangelog(ctx: WidgetRenderCtx): string {
    const entries = ctx.config.betaMode?.changelogItems;
    if (!entries?.length) return '';
    const latest = entries[0];
    const items = latest.items.map((item) => `<li>\u2022 ${escapeHtml(item)}</li>`).join('');
    const label = latest.date
      ? `What\u2019s new in ${escapeHtml(latest.version)} \u00B7 ${escapeHtml(latest.date)}`
      : `What\u2019s new in ${escapeHtml(latest.version)}`;
    return `
      <details class="mushi-changelog">
        <summary class="mushi-changelog-summary">${label}</summary>
        <ul class="mushi-changelog-list">${items}</ul>
      </details>
    `;
  }

  /**
   * Discreet beta status strip: communicates "work in progress", invites
   * feedback, and sets expectations — reducing user frustration while
   * nudging the reciprocity instinct ("your reports help us build this").
   */
export function renderBetaStrip(ctx: WidgetRenderCtx): string {
    const beta = ctx.config.betaMode!;
    const appName = escapeHtml(beta.appName ?? 'This app');
    const message = beta.message
      ? escapeHtml(beta.message)
      : `${appName} is in early development`;
    const email = beta.contactEmail ? escapeHtml(beta.contactEmail) : null;
    const perks = beta.perks ?? [];

    return `
      <div class="mushi-beta-strip" role="note" aria-label="Beta status">
        <div class="mushi-beta-strip-row">
          <span class="mushi-beta-tag" aria-hidden="true">BETA</span>
          <span class="mushi-beta-msg">${message}</span>
        </div>
        ${email ? `<div class="mushi-beta-contact-hint">Reports go to ${email} · reviewed by the team</div>` : ''}
        ${perks.length > 0 ? `
          <ul class="mushi-beta-perks" aria-label="Beta tester perks">
            ${perks.map((p) => `<li>\u2713 ${escapeHtml(p)}</li>`).join('')}
          </ul>
        ` : ''}
        ${renderBetaChangelog(ctx)}
      </div>
    `;
  }
export function renderReportsStep(ctx: WidgetRenderCtx): string {
    const f = ctx.locale.flows;
    const reports = ctx.reporterReports.map((report) => {
      const title = report.summary ?? report.description ?? `Report ${report.id.slice(0, 8)}`;
      const tone = reporterStatusTone(report.status);
      const when = formatRelativeTime(report.created_at);
      const unread = report.unread_count && report.unread_count > 0
        ? `<span class="mushi-unread-badge" aria-label="${report.unread_count} unread">${report.unread_count}</span>`
        : '';
      return `
      <button type="button" class="mushi-report-row" data-report-id="${escapeHtml(report.id)}" aria-label="View report: ${escapeHtml(title)}">
        <div class="mushi-report-main">
          <span class="mushi-report-title">${escapeHtml(title)}</span>
          <span class="mushi-report-meta">
            <span class="mushi-report-status mushi-status-${tone}">${escapeHtml(reporterStatusShort(report.status))}</span>
            ${when ? `<span class="mushi-report-when">${escapeHtml(when)}</span>` : ''}
            ${unread}
          </span>
        </div>
        <span class="mushi-report-chevron" aria-hidden="true">\u203A</span>
      </button>`;
    }).join('');
    const leaderboardBtn = ctx.rewardsState
      ? `<button type="button" class="mushi-leaderboard-link" data-action="open-leaderboard">\uD83C\uDFC6 ${escapeHtml(f.reports.leaderboardLink)}</button>`
      : '';
    return `
      ${renderHeader(ctx, { title: f.reports.title, showBack: true, eyebrow: f.eyebrows.inbox })}
      <div class="mushi-body">
        ${ctx.reporterLoading ? `<p class="mushi-muted">${escapeHtml(f.reports.loading)}</p>` : ''}
        ${ctx.reporterError ? `<p class="mushi-error-inline">${escapeHtml(ctx.reporterError)}</p>` : ''}
        ${reports || (!ctx.reporterLoading ? `<p class="mushi-muted">${escapeHtml(f.reports.empty)}</p>` : '')}
        ${leaderboardBtn}
      </div>
    `;
  }
export function renderRoadmapStep(ctx: WidgetRenderCtx): string {
    const f = ctx.locale.flows;
    const rows = ctx.featureBoard.map((ticket) => {
      const id = String(ticket.id ?? '');
      const subject = escapeHtml(String(ticket.subject ?? f.roadmap.untitled));
      const votes = Number(ticket.vote_count ?? 0);
      const shipped = Boolean(ticket.shipped_at);
      const voted = Boolean(ticket.my_vote);
      const status = shipped ? f.roadmap.shipped : String(ticket.status_label ?? ticket.status ?? 'open');
      const voteLabel = f.roadmap.voteCount.replace('{n}', String(votes));
      return `
        <div class="mushi-report-row mushi-roadmap-row">
          <div class="mushi-report-main">
            <span class="mushi-report-title">${subject}</span>
            <span class="mushi-report-meta">
              <span class="mushi-report-status">${escapeHtml(status)}</span>
              <span class="mushi-report-when">${escapeHtml(voteLabel)}</span>
            </span>
          </div>
          ${ctx.callbacks.onFeatureBoardVote ? `
            <button type="button" class="mushi-vote-btn" data-vote-id="${escapeHtml(id)}" aria-pressed="${voted}">
              ${voted ? escapeHtml(f.roadmap.voted) : escapeHtml(f.roadmap.vote)}
            </button>` : ''}
        </div>`;
    }).join('');

    return `
      ${renderHeader(ctx, { title: f.roadmap.title, showBack: true, eyebrow: f.eyebrows.roadmap })}
      <div class="mushi-body">
        ${ctx.reporterLoading ? `<p class="mushi-muted">${escapeHtml(f.roadmap.loading)}</p>` : ''}
        ${ctx.reporterError ? `<p class="mushi-error-inline">${escapeHtml(ctx.reporterError)}</p>` : ''}
        ${rows || (!ctx.reporterLoading ? `<p class="mushi-muted">${escapeHtml(f.roadmap.empty)}</p>` : '')}
      </div>
    `;
  }
export function renderLeaderboardStep(ctx: WidgetRenderCtx): string {
    const f = ctx.locale.flows;
    // Show global leaderboard (cross-app) when available, fall back to org scope
    const isGlobal = ctx.globalLeaderboard !== null || ctx.globalLeaderboardLoading;
    const entries = isGlobal
      ? (ctx.globalLeaderboard ?? [])
      : (ctx.leaderboardEntries ?? []).map(e => ({
          tester_id: '',
          public_handle: null,
          display_name: e.display_name,
          rank: 0,
          points_30d: e.points_30d,
          total_points: e.total_points,
        }));
    const loading = isGlobal ? ctx.globalLeaderboardLoading : ctx.leaderboardLoading;

    // Find caller's rank
    const myRank = ctx.testerReputation?.rank ?? null;

    const rows = entries.map((e, i) => {
      const rank = (e as MushiLeaderboardEntry).rank || (i + 1);
      const isMe = ctx.testerReputation && (e as MushiLeaderboardEntry).tester_id === ctx.testerReputation.tester_id;
      return `
        <div class="mushi-lb-row ${rank === 1 ? 'mushi-lb-top' : ''}${isMe ? ' mushi-lb-me' : ''}">
          <span class="mushi-lb-rank">#${rank}</span>
          <span class="mushi-lb-name">${escapeHtml((e as MushiLeaderboardEntry).public_handle ?? e.display_name ?? f.leaderboard.anon)}</span>
          <span class="mushi-lb-pts">${(e.points_30d ?? e.total_points).toLocaleString()} pts</span>
        </div>
      `;
    }).join('');

    const myRankBadge = myRank
      ? `<div class="mushi-lb-myrank">${escapeHtml(f.leaderboard.myRank.replace('{rank}', String(myRank)))}</div>`
      : (!ctx.testerJwt ? `<button type="button" class="mushi-link-btn" data-action="open-account">${escapeHtml(f.leaderboard.signInPrompt)}</button>` : '');

    return `
      ${renderHeader(ctx, { title: f.leaderboard.title, showBack: true, eyebrow: f.eyebrows.community })}
      <div class="mushi-body">
        ${loading ? `<p class="mushi-muted">${escapeHtml(f.leaderboard.loading)}</p>` : ''}
        ${!loading && !entries.length ? `<p class="mushi-muted">${escapeHtml(f.leaderboard.empty)}</p>` : ''}
        <div class="mushi-lb-list">${rows}</div>
        ${myRankBadge}
        <p class="mushi-lb-note">${escapeHtml(f.leaderboard.footer)}</p>
      </div>
    `;
  }
export function renderAccountStep(ctx: WidgetRenderCtx): string {
    const f = ctx.locale.flows;
    const tester = ctx.testerInfo;
    if (tester) {
      // Signed in — show account info + cross-app link
      const handle = tester.public_handle ?? tester.display_name ?? f.leaderboard.anon;
      const rep = ctx.testerReputation;
      const rankLine = rep
        ? f.account.rankSummary
            .replace('{rank}', String(rep.rank ?? '—'))
            .replace('{points}', (rep.points_30d ?? 0).toLocaleString())
        : '';
      return `
        ${renderHeader(ctx, { title: f.account.title, showBack: true, eyebrow: f.eyebrows.identity })}
        <div class="mushi-body">
          <div class="mushi-account-card">
            <div class="mushi-account-avatar">${escapeHtml(handle.charAt(0).toUpperCase())}</div>
            <div class="mushi-account-info">
              <strong>${escapeHtml(handle)}</strong>
              ${rep ? `<span class="mushi-account-rank">${escapeHtml(rankLine)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="mushi-nav-item" data-action="open-cross-app-reports">
            ${escapeHtml(f.account.crossAppReports)}
          </button>
          <button type="button" class="mushi-nav-item" data-action="open-global-leaderboard">
            ${escapeHtml(f.account.viewLeaderboard)}
          </button>
          <button type="button" class="mushi-link-btn" data-action="sign-out-tester">${escapeHtml(f.account.signOut)}</button>
        </div>
      `;
    }

    // Not signed in — magic-link form
    if (ctx.magicLinkSent) {
      return `
        ${renderHeader(ctx, { title: f.account.checkEmailTitle, showBack: true, eyebrow: f.eyebrows.signIn })}
        <div class="mushi-body">
          <p class="mushi-muted">${escapeHtml(f.account.magicLinkSent.replace('{email}', ctx.magicLinkEmail))}</p>
          <button type="button" class="mushi-link-btn" data-action="resend-magic-link">${escapeHtml(f.account.resendEmail)}</button>
          ${ctx.magicLinkError ? `<p class="mushi-error">${escapeHtml(ctx.magicLinkError)}</p>` : ''}
        </div>
      `;
    }

    return `
      ${renderHeader(ctx, { title: f.account.joinTitle, showBack: true, eyebrow: f.eyebrows.signIn })}
      <div class="mushi-body">
        <p class="mushi-muted">${escapeHtml(f.account.signInPrompt)}</p>
        <label class="mushi-label" for="mushi-email-input">${escapeHtml(f.account.emailLabel)}</label>
        <input
          id="mushi-email-input"
          type="email"
          class="mushi-textarea"
          data-role="magic-link-email"
          placeholder="${escapeHtml(f.account.emailPlaceholder)}"
          autocomplete="email"
          value="${escapeHtml(ctx.magicLinkEmail)}"
          style="padding: 10px 12px; height: auto; resize: none;"
        />
        ${ctx.magicLinkError ? `<p class="mushi-error">${escapeHtml(ctx.magicLinkError)}</p>` : ''}
        <button type="button" class="mushi-submit" data-action="send-magic-link"${ctx.magicLinkSending ? ' disabled aria-disabled="true"' : ''}>
          <span>${ctx.magicLinkSending ? escapeHtml(f.account.sending) : escapeHtml(f.account.sendLink)}</span><span class="mushi-submit-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    `;
  }
export function renderCrossAppReportsStep(ctx: WidgetRenderCtx): string {
    const f = ctx.locale.flows;
    const reports = ctx.crossAppReports ?? [];
    const grouped = new Map<string, { name: string; slug: string | null; domain: string | null; reports: MushiCrossAppReport[] }>();
    for (const r of reports) {
      const key = r.project_id ?? 'unknown';
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: r.app_name ?? f.crossApp.unknownApp,
          slug: r.app_slug ?? null,
          domain: r.app_domain ?? null,
          reports: [],
        });
      }
      grouped.get(key)!.reports.push(r);
    }

    const rows = [...grouped.entries()].map(([projectId, group]) => {
      const icon = renderAppIconHtml({
        projectId,
        appName: group.name,
        appSlug: group.slug,
        appDomain: group.domain,
      });
      return `
      <div class="mushi-xapp-group">
        <div class="mushi-xapp-app-head">
          ${icon}
          <h4 class="mushi-xapp-app-name">${escapeHtml(group.name)}</h4>
        </div>
        ${group.reports.map(r => {
          const tone = reporterStatusTone(r.status);
          return `
            <div class="mushi-report-row" data-report-id="${escapeHtml(r.id)}" tabindex="0" role="button">
              <span class="mushi-report-status mushi-status-${tone}">${escapeHtml(reporterStatusShort(r.status))}</span>
              <span class="mushi-report-title">${escapeHtml(r.title ?? r.category)}</span>
              <span class="mushi-report-when">${escapeHtml(formatRelativeTime(r.created_at))}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
    }).join('');

    return `
      ${renderHeader(ctx, { title: f.crossApp.title, showBack: true, eyebrow: f.eyebrows.allApps })}
      <div class="mushi-body">
        ${ctx.crossAppLoading ? `<p class="mushi-muted">${escapeHtml(f.crossApp.loading)}</p>` : ''}
        ${!ctx.crossAppLoading && !reports.length ? `<p class="mushi-muted">${escapeHtml(f.crossApp.empty)}</p>` : ''}
        ${rows}
      </div>
    `;
  }
export function renderReportDetailStep(ctx: WidgetRenderCtx): string {
    const f = ctx.locale.flows;
    const report = ctx.reporterReports.find((r) => r.id === ctx.selectedReportId);
    const status = report?.status ?? 'unknown';
    const tone = reporterStatusTone(status);
    const when = report?.created_at ? formatRelativeTime(report.created_at) : '';
    const comments = ctx.reporterComments.map((comment) => `
      <div class="mushi-thread-comment ${comment.author_kind}">
        <strong>${escapeHtml(comment.author_kind === 'reporter' ? 'You' : (comment.author_name ?? 'Developer'))}</strong>
        <p>${escapeHtml(comment.body)}</p>
      </div>
    `).join('');
    return `
      ${renderHeader(ctx, { title: f.thread.title, showBack: true, eyebrow: f.eyebrows.thread })}
      <div class="mushi-body">
        <div class="mushi-thread-summary">
          <div class="mushi-thread-summary-meta">
            <span class="mushi-report-status mushi-status-${tone}">${escapeHtml(reporterStatusLabel(status))}</span>
            ${when ? `<span class="mushi-report-when">Reported ${escapeHtml(when)}</span>` : ''}
          </div>
          <p>${escapeHtml(report?.summary ?? report?.description ?? 'Report details')}</p>
        </div>
        <div class="mushi-thread">
          ${ctx.reporterLoading ? `<p class="mushi-muted">${escapeHtml(f.thread.loading)}</p>` : comments || `<p class="mushi-muted">${escapeHtml(f.thread.empty)}</p>`}
        </div>
        ${['fixed', 'resolved', 'verified'].includes(status) ? `
          <div class="mushi-verify-actions" role="group" aria-label="Fix verification">
            <button type="button" class="mushi-option-btn" data-action="reporter-confirms">${escapeHtml(f.thread.confirmFixed)}</button>
            <button type="button" class="mushi-option-btn" data-action="reporter-not-fixed">${escapeHtml(f.thread.notFixed)}</button>
          </div>
        ` : ''}
        <textarea class="mushi-textarea" data-role="reporter-reply" rows="3" placeholder="Reply to the developer…"></textarea>
        <button type="button" class="mushi-submit" data-action="reporter-reply">
          <span>Reply</span><span class="mushi-submit-arrow" aria-hidden="true">\u2192</span>
        </button>
      </div>
    `;
  }
export function renderIntentStep(ctx: WidgetRenderCtx): string {
    const t = ctx.locale;
    const catId = ctx.selectedCategory!;
    // For custom categories, use their declared intents; for built-in categories
    // use the i18n-localised intent list.
    const customEntry = ctx.resolveCustomCategory(catId);
    const intents: string[] = customEntry?.intents
      ?? (t.step2.intents[catId as MushiReportCategory] || []);

    const options = intents.map((intent) => `
      <button type="button" class="mushi-option-btn" data-intent="${escapeHtml(intent)}">
        <span class="mushi-option-text"><span class="mushi-option-label">${escapeHtml(intent)}</span></span>
        <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
      </button>
    `).join('');

    const icon = ctx.categoryIcon(catId);
    const label = ctx.categoryLabel(catId);

    return `
      ${renderHeader(ctx, { title: t.step2.heading, showBack: true, step: STEP_NUMBER.intent })}
      <div class="mushi-body">
        <div class="mushi-selected-category">
          <span aria-hidden="true">${escapeHtml(icon)}</span>
          <span>${escapeHtml(label)}</span>
        </div>
        <div class="mushi-intents">
          ${options}
        </div>
      </div>
    `;
  }

export function renderDetailsStep(ctx: WidgetRenderCtx): string {
    const t = ctx.locale;
    const minLen = ctx.effectiveMinLength();

    const screenshotLabel = ctx.screenshotCapturing
      ? t.step3.screenshotCapturing
      : ctx.screenshotError
        ? t.step3.screenshotFailed
        : ctx.screenshotAttached
          ? t.step3.screenshotAttached
          : t.step3.screenshotButton;

    const screenshotClass = [
      'mushi-attach-btn',
      ctx.screenshotAttached ? 'active' : '',
      ctx.screenshotError ? 'error' : '',
      ctx.screenshotCapturing ? 'loading' : '',
    ].filter(Boolean).join(' ');

    const elementLabel = ctx.elementCapturing
      ? t.step3.elementCapturing
      : ctx.elementError
        ? t.step3.elementFailed
        : ctx.elementSelected
          ? t.step3.elementSelected
          : t.step3.elementButton;

    const elementClass = [
      'mushi-attach-btn',
      ctx.elementSelected ? 'active' : '',
      ctx.elementError ? 'error' : '',
      ctx.elementCapturing ? 'loading' : '',
    ].filter(Boolean).join(' ');

    const exampleChips = t.step3.examplePrompts
      .map((p) => `<button type="button" class="mushi-example-chip" data-example="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
      .join('');

    return `
      ${renderHeader(ctx, { title: t.step3.heading, showBack: true, step: STEP_NUMBER.details })}
      <div class="mushi-body">
        <div class="mushi-example-chips" aria-label="Example prompts">${exampleChips}</div>
        <div class="mushi-textarea-wrap">
          <textarea
            class="mushi-textarea"
            placeholder="${escapeHtml(t.step3.descriptionPlaceholder)}"
            rows="4"
            maxlength="4000"
            aria-label="${escapeHtml(t.step3.heading)}"
            autofocus
          ></textarea>
          <div class="mushi-char-counter" data-role="char-counter" aria-hidden="true">
            <span data-role="char-current">0</span>/<span data-role="char-min">${minLen}</span>
          </div>
        </div>
        <div class="mushi-attachments">
          ${ctx.screenshotAvailable
            ? `<button type="button" class="${screenshotClass}"
            data-action="screenshot"
            ${ctx.screenshotCapturing ? 'disabled' : ''}
            aria-label="${escapeHtml(screenshotLabel)}"
          >
            ${ctx.screenshotCapturing ? '<span class="mushi-spinner" aria-hidden="true"></span>' : '\uD83D\uDCF8'}
            ${escapeHtml(screenshotLabel)}
          </button>`
            : ''}
          ${ctx.screenshotAttached && ctx.allowScreenshotRemove
            ? '<button type="button" class="mushi-attach-btn danger" data-action="remove-screenshot" aria-label="Remove screenshot">\u2715 Remove</button>'
            : ''}
          ${ctx.screenshotAttached
            ? '<button type="button" class="mushi-attach-btn" data-action="annotate-screenshot" aria-label="Mark up screenshot">\u270F Mark up</button><div class="mushi-annotate-host" data-role="annotate-host"></div>'
            : ''}
          ${ctx.elementAvailable
            ? `<button type="button" class="${elementClass}"
            data-action="element"
            ${ctx.elementCapturing ? 'disabled' : ''}
            aria-label="${escapeHtml(elementLabel)}"
          >
            ${ctx.elementCapturing ? '<span class="mushi-spinner" aria-hidden="true"></span>' : '\uD83C\uDFAF'}
            ${escapeHtml(elementLabel)}
          </button>`
            : ''}
        </div>
        ${ctx.screenshotAttached && ctx.screenshotPreview
          ? `<figure class="mushi-screenshot-preview">
              <img src="${escapeHtml(ctx.screenshotPreview)}" alt="${escapeHtml(t.step3.screenshotPreviewAlt)}" />
              ${ctx.screenshotHint
                ? `<figcaption class="mushi-screenshot-hint">\u26A0 ${escapeHtml(ctx.screenshotHint)}</figcaption>`
                : ''}
            </figure>`
          : ''}
        <div class="mushi-error" style="display:none" role="alert"></div>
        ${ctx.identifiedUser
          ? `<p class="mushi-identified-user" aria-label="Reporting as ${escapeHtml(ctx.identifiedUser.name ?? ctx.identifiedUser.email ?? '')}">\uD83D\uDC64 Reporting as <strong>${escapeHtml(ctx.identifiedUser.name ?? ctx.identifiedUser.email ?? 'you')}</strong></p>`
          : ''}
      </div>
      <div class="mushi-footer">
        <span class="mushi-footer-hint" aria-hidden="true">\u2318 + ENTER \u2192 send</span>
        <button type="button" class="mushi-submit" data-action="submit"${ctx.submitting ? ' disabled' : ''}>
          <span>${ctx.submitting ? t.widget.submitting : t.widget.submit}</span>
          <span class="mushi-submit-arrow" aria-hidden="true">\u2192</span>
        </button>
      </div>
    `;
  }

  /**
   * Editorial success state: 朱印-style red stamp ring with the kanji
   * 受 ("received") at its centre, the localised "thank you" string
   * in serif below, and a mono ledger receipt ("REPORT · HH:MM:SS").
   * The ring + label animations are defined in styles.ts so this stays
   * pure markup and `prefers-reduced-motion` flips them to the final
   * frame instantly.
   */
export function renderSuccessStep(ctx: WidgetRenderCtx): string {
    const t = ctx.locale;
    const stamp = ctx.submittedAt ?? new Date();
    const time = stamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    return `
      ${renderHeader(ctx, { title: t.widget.title, showBack: true, eyebrow: 'Mushi \u00B7 Receipt' })}
      <div class="mushi-body">
        <div class="mushi-success">
          <div class="mushi-success-stamp" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><circle cx="50" cy="50" r="44"/></svg>
            <span class="mushi-success-stamp-label">\u53D7</span>
          </div>
          <div class="mushi-success-headline">${t.widget.submitted}</div>
          <div class="mushi-success-meta">REPORT \u00B7 ${time}</div>
          ${renderSuccessReceipt(ctx)}
          ${ctx.rewardsState ? renderSuccessRewards(ctx) : ''}
          ${ctx.config.betaMode?.enabled ? renderBetaSuccessFooter(ctx) : ''}
          <button type="button" class="mushi-link-btn mushi-success-my-reports" data-action="view-my-reports">
            ${escapeHtml(ctx.locale.flows.success.trackReport)}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Two-way receipt block. Until the host's `onSubmit` resolves with a
   * server-confirmed report id, we show a discreet "delivering..." pill so
   * the user knows their submission is still in flight. Once we have the
   * id, we surface a short monospaced id + a copy button + an optional
   * "Track on Mushi" deep link to `dashboardUrl/reports/<id>` so the user
   * can watch the status walk through queued -> classified -> fixed in
   * real time (Peak-End rule: the last impression sticks). If we never
   * get an id (offline retry queue), we say so explicitly rather than
   * pretending everything is fine.
   */
export function renderSuccessReceipt(ctx: WidgetRenderCtx): string {
    const s = ctx.locale.flows.success;
    const failureKind = ctx.lastSubmitFailureKind;
    if (failureKind === 'rate_limited' || failureKind === 'quota' || failureKind === 'permanent' || failureKind === 'retrying' || ctx.lastSubmitQueuedOffline) {
      const label =
        failureKind === 'rate_limited' ? s.rateLimited
        : failureKind === 'quota' ? s.quotaBlocked
        : failureKind === 'permanent' ? s.permanentFailed
        : failureKind === 'retrying' ? s.retrying
        : s.queuedOffline;
      const hint =
        failureKind === 'rate_limited' ? s.rateLimitedHint
        : failureKind === 'quota' ? s.quotaBlockedHint
        : failureKind === 'permanent' ? s.permanentFailedHint
        : failureKind === 'retrying' ? s.retryingHint
        : s.queuedHint;
      return `
        <div class="mushi-success-receipt" role="status">
          <div class="mushi-success-receipt-row mushi-success-receipt-warn">
            <span class="mushi-success-receipt-label">${escapeHtml(label)}</span>
            <span class="mushi-success-receipt-hint">${escapeHtml(hint)}</span>
          </div>
        </div>
      `;
    }

    if (!ctx.lastReportId) {
      return `
        <div class="mushi-success-receipt" role="status">
          <div class="mushi-success-receipt-row">
            <span class="mushi-success-receipt-spinner" aria-hidden="true"></span>
            <span class="mushi-success-receipt-hint">${escapeHtml(s.delivering)}</span>
          </div>
          ${renderSlaLine(ctx)}
        </div>
      `;
    }

    const idShort = `#${ctx.lastReportId.slice(0, 8)}`;
    const dashboard = (ctx.config.dashboardUrl ?? '').replace(/\/$/, '');
    const trackHref = dashboard ? `${dashboard}/reports/${encodeURIComponent(ctx.lastReportId)}` : '';
    const screenshotDroppedNote = ctx.lastSubmitScreenshotDropped
      ? `
        <div class="mushi-success-receipt-row mushi-success-receipt-warn">
          <span class="mushi-success-receipt-hint">${escapeHtml(s.screenshotDropped)}</span>
        </div>
      `
      : '';

    return `
      <div class="mushi-success-receipt" role="status">
        <div class="mushi-success-receipt-row">
          <span class="mushi-success-receipt-label">${escapeHtml(s.receipt)}</span>
          <button
            type="button"
            class="mushi-success-receipt-id"
            data-action="copy-report-id"
            data-copy-id="${escapeHtml(ctx.lastReportId)}"
            title="Copy report id ${escapeHtml(ctx.lastReportId)}"
            aria-label="Copy report id ${escapeHtml(ctx.lastReportId)}"
          >${escapeHtml(idShort)}<span class="mushi-success-receipt-copy" aria-hidden="true">\u2398</span></button>
        </div>
        ${trackHref ? `
          <a
            class="mushi-success-receipt-track"
            href="${escapeHtml(trackHref)}"
            target="_blank"
            rel="noopener noreferrer"
          >${escapeHtml(s.trackOnMushi)} <span aria-hidden="true">\u2197</span></a>
        ` : ''}
        ${screenshotDroppedNote}
        ${renderSlaLine(ctx)}
      </div>
    `;
  }
export function renderSlaLine(ctx: WidgetRenderCtx): string {
    const sla = (ctx.config.responseSlaLabel ?? '').trim();
    if (sla) {
      return `<div class="mushi-success-sla">${escapeHtml(sla)}</div>`;
    }
    return `<div class="mushi-success-sla mushi-success-sla-default">${escapeHtml(ctx.locale.flows.success.slaDefault)}</div>`;
  }

  /**
   * Reciprocity footer on the success step: closes the feedback loop by
   * attributing where the report goes, sets a response expectation, and
   * reinforces the "beta tester" identity (Peak-End Rule — the last thing
   * the user sees shapes their entire impression of the interaction).
   */
export function renderBetaSuccessFooter(ctx: WidgetRenderCtx): string {
    const beta = ctx.config.betaMode!;
    const email = beta.contactEmail ? escapeHtml(beta.contactEmail) : null;
    const appName = escapeHtml(beta.appName ?? 'the team');
    return `
      <div class="mushi-beta-success-footer" role="note" aria-label="Beta feedback acknowledgement">
        ${email
          ? `<div class="mushi-beta-success-line">\uD83D\uDCEC Sent to ${email}</div>`
          : `<div class="mushi-beta-success-line">\uD83D\uDCEC Sent to ${appName}</div>`
        }
      </div>
    `;
  }

  /** Compact rewards nudge rendered at the bottom of the category-step body. */
export function renderRewardsNudge(ctx: WidgetRenderCtx): string {
    const { tier, nextTier, totalPoints, pointsForReport } = ctx.rewardsState!;
    const tierName = tier?.displayName ?? 'Free';
    const tierSlug = tier?.slug ?? 'free';
    const color = ctx.tierColor(tierSlug);

    let pct = 100;
    let nextLabel = '';
    if (nextTier) {
      const base = tier?.pointsThreshold ?? 0;
      const ceiling = nextTier.pointsThreshold;
      pct = ceiling > base ? Math.round(Math.min(1, (totalPoints - base) / (ceiling - base)) * 100) : 100;
      const remaining = Math.max(0, ceiling - totalPoints);
      nextLabel = `${remaining.toLocaleString()} pts to ${escapeHtml(nextTier.displayName)}`;
    }

    return `
      <div class="mushi-rewards-nudge" aria-label="Rewards progress">
        <div class="mushi-rewards-row">
          <span class="mushi-tier-pip" style="background:${color}" aria-hidden="true"></span>
          <span class="mushi-rewards-tier-name">${escapeHtml(tierName)}</span>
          <span class="mushi-rewards-pts-count">${totalPoints.toLocaleString()} pts</span>
          <span class="mushi-rewards-pts-earn">+${pointsForReport} pts for a report</span>
        </div>
        ${nextTier ? `
          <div class="mushi-tier-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${escapeHtml(nextTier.displayName)}">
            <div class="mushi-tier-bar-fill" style="--mushi-tier-pct:${pct / 100}"></div>
          </div>
          <div class="mushi-rewards-next-label">${nextLabel}</div>
        ` : ''}
      </div>
    `;
  }

  /** Points earned + tier progress shown on the success step. */
export function renderSuccessRewards(ctx: WidgetRenderCtx): string {
    const { tier, nextTier, totalPoints, pointsForReport } = ctx.rewardsState!;
    const projected = totalPoints + pointsForReport;

    let pctAfter = 100;
    let nextLabel = '';
    if (nextTier) {
      const base = tier?.pointsThreshold ?? 0;
      const ceiling = nextTier.pointsThreshold;
      pctAfter = ceiling > base ? Math.round(Math.min(1, (projected - base) / (ceiling - base)) * 100) : 100;
      const remaining = Math.max(0, ceiling - projected);
      nextLabel = remaining > 0
        ? `${remaining.toLocaleString()} pts to ${escapeHtml(nextTier.displayName)}`
        : `\uD83C\uDF89 ${escapeHtml(nextTier.displayName)} reached!`;
    }

    return `
      <div class="mushi-success-rewards">
        <div class="mushi-success-pts-award">+${pointsForReport} pts</div>
        ${nextTier ? `
          <div class="mushi-tier-bar-track success-bar" role="progressbar" aria-valuenow="${pctAfter}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${escapeHtml(nextTier.displayName)}">
            <div class="mushi-tier-bar-fill" style="--mushi-tier-pct:${pctAfter / 100}"></div>
          </div>
          <div class="mushi-rewards-next-label">${nextLabel}</div>
        ` : ''}
      </div>
    `;
  }
