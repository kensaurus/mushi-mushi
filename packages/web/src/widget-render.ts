/**
 * FILE: packages/web/src/widget-render.ts
 * PURPOSE: Stateless view layer for the MushiWidget panel. `renderView(ctx)`
 *          returns one HTML string per panel region; the class patches only the
 *          regions whose string changed (Plan 018 §1.3, "patch, don't rebuild").
 *
 * OVERVIEW:
 * - Regions: `header` (title, Your reports pill, overflow menu, close), `lead`
 *   (the stable top of the scroll area — the report textarea, the detail
 *   card), `body` (everything else that scrolls) and `footer` (the sticky
 *   action row: Send, Done, the reply composer).
 * - Every interactive element carries `data-action` (+ `data-value`); the class
 *   handles them with one delegated listener, so a patched region needs no
 *   re-binding.
 * - Reporter-facing status, timeline and generic UI copy comes from
 *   `@mushi-mushi/core/reporter-ui` (shared with React Native); this file never
 *   shows an internal status, category or severity.
 *
 * DEPENDENCIES: @mushi-mushi/core (types + reporter-ui), ./i18n, ./widget-helpers.
 */
import type {
  MushiCrossAppReport,
  MushiCustomCategory,
  MushiLeaderboardEntry,
  MushiReporterComment,
  MushiReporterReport,
  MushiTesterReputation,
  MushiWidgetConfig,
} from '@mushi-mushi/core';
import {
  reporterCopy,
  type ReporterCopy,
} from '@mushi-mushi/core/reporter-ui';
import type { MushiLocale } from './i18n';
import type * as Views from './widget-views';
import {
  buildBrandFooterHref,
  DESCRIPTION_MAX_LENGTH,
  escapeHtml,
  formatReceiptTime,
  formatRelativeTime,
  readPlatform,
  renderAppIconHtml,
  submitShortcutKey,
} from './widget-helpers';
import type {
  AssistantTurn,
  PendingReply,
  ScreenshotErrorReason,
  WidgetCallbacks,
  WidgetRewardsState,
  WidgetStep,
  WidgetSubmitOutcome,
  WidgetTimelineEvent,
} from './widget-helpers';

export interface WidgetRenderCtx {
  /** Lazily loaded Your reports + overflow views; null until the chunk arrives. */
  views: typeof Views | null;
  config: Required<MushiWidgetConfig>;
  locale: MushiLocale;
  /** Reporter-facing copy from core, already resolved to the widget locale. */
  rc: ReporterCopy;
  /** Base locale code (`en`, `ja`…) for core's reporter helpers. */
  lang: string;
  step: WidgetStep;
  callbacks: WidgetCallbacks;
  // ─── Report screen ─────────────────────────────────────────────
  /** Selected type chip: a built-in id, `idea`, a custom category id, or null. */
  chip: string | null;
  intent: string | null;
  /** Host custom categories are revealed under "More…". */
  showAllCategories: boolean;
  /** Current description text (kept in sync on input). */
  draftLength: number;
  canSend: boolean;
  submitting: boolean;
  screenshotCapturing: boolean;
  screenshotAttached: boolean;
  screenshotPreview: string | null;
  previewOpen: boolean;
  screenshotHint: string | null;
  screenshotAvailable: boolean;
  elementAvailable: boolean;
  screenshotError: boolean;
  screenshotErrorReason: ScreenshotErrorReason | null;
  elementSelected: boolean;
  elementCapturing: boolean;
  elementError: boolean;
  allowScreenshotRemove: boolean;
  identifiedUser: { name?: string; email?: string } | null;
  // ─── Receipt ───────────────────────────────────────────────────
  lastReportId: string | null;
  submittedAt: Date | null;
  lastSubmitQueuedOffline: boolean;
  lastSubmitFailureKind: WidgetSubmitOutcome['failureKind'];
  lastSubmitScreenshotDropped: boolean;
  /** Reporter channels the host enabled and the server has configured. */
  channels: { email: boolean; push: boolean; emailPrefill: string };
  emailOptInOpen: boolean;
  emailState: 'idle' | 'saving' | 'saved' | 'invalid' | 'error';
  pushState: 'idle' | 'asking' | 'on' | 'error';
  // ─── Your reports ──────────────────────────────────────────────
  reporterReports: MushiReporterReport[];
  listLoading: boolean;
  reporterError: string | null;
  selectedReportId: string | null;
  reporterComments: MushiReporterComment[];
  timeline: WidgetTimelineEvent[] | null;
  pendingReplies: PendingReply[];
  threadLoading: boolean;
  threadError: string | null;
  actionPending: boolean;
  actionError: string | null;
  unreadCount: number;
  // ─── Header ────────────────────────────────────────────────────
  showMoreNav: boolean;
  pageFaviconHref: string | null;
  sdkFreshness: { latest: string | null; current: string; deprecated: boolean; message?: string | null } | null;
  brandRef: string | null;
  // ─── Secondary views (behind the overflow menu) ────────────────
  rewardsState: WidgetRewardsState | null;
  testerReputation: MushiTesterReputation | null;
  testerInfo: { id: string; public_handle: string | null; display_name: string | null } | null;
  testerJwt: string | null;
  magicLinkError: string;
  magicLinkSending: boolean;
  magicLinkEmail: string;
  magicLinkSent: boolean;
  globalLeaderboardLoading: boolean;
  globalLeaderboard: MushiLeaderboardEntry[] | null;
  leaderboardLoading: boolean;
  leaderboardEntries: Array<{ display_name: string; tier_name: string | null; total_points: number; points_30d: number }> | null;
  crossAppLoading: boolean;
  crossAppReports: MushiCrossAppReport[] | null;
  featureBoard: Array<Record<string, unknown>>;
  assistantTurns: AssistantTurn[];
  assistantSending: boolean;
  assistantError: string | null;
  tierColor: (slug: string) => string;
  resolveCustomCategory: (id: string) => MushiCustomCategory | undefined;
}

/** The HTML of every panel region for the current view. */
export interface ViewRegions {
  header: string;
  lead: string;
  body: string;
  footer: string;
}

const esc = escapeHtml;
const BUILTIN_CHIPS = ['bug', 'slow', 'visual', 'confusing'] as const;

function btn(action: string, label: string, cls = '', extra = ''): string {
  return `<button type="button" class="${cls}" data-action="${action}"${extra}>${label}</button>`;
}

export function renderView(ctx: WidgetRenderCtx): ViewRegions {
  if (ctx.step === 'report') return reportView(ctx);
  if (ctx.step === 'success') return successView(ctx);
  const v = ctx.views;
  if (!v) return loadingView(ctx);
  switch (ctx.step) {
    case 'reports': return v.reportsView(ctx);
    case 'report-detail': return v.detailView(ctx);
    case 'assistant': return v.assistantView(ctx);
    case 'roadmap': return v.roadmapView(ctx);
    case 'leaderboard': return v.leaderboardView(ctx);
    case 'account': return v.accountView(ctx);
    case 'cross-app-reports': return v.crossAppView(ctx);
  }
}

/** Steps whose views load on demand (dist/chunks/widget-views-*.js). */
export const LAZY_STEPS: ReadonlySet<WidgetStep> = new Set(['reports', 'report-detail', 'assistant', 'roadmap', 'leaderboard', 'account', 'cross-app-reports']);

/** Header + skeleton while the views chunk loads (one round trip, once per page). */
function loadingView(ctx: WidgetRenderCtx): ViewRegions {
  const f = ctx.locale.flows;
  const title = ctx.step === 'report-detail' ? ctx.locale.panel.reportTitle : ctx.step === 'reports' ? f.reports.title : '';
  return { header: renderHeader(ctx, title, true), lead: '', body: skeleton(f.reports.loading), footer: '' };
}

/** Render helpers the lazy views share with this module, passed in so the chunk never imports runtime code from the main entry. */
export const renderKit = {
  esc: escapeHtml,
  btn,
  renderHeader,
  chipLabel,
  skeleton,
  formatRelativeTime,
  renderAppIconHtml,
};
export type RenderKit = typeof renderKit;

// ─── Header ────────────────────────────────────────────────────────

/** Overflow destinations, shown only when the host enabled them. */
function menuItems(ctx: WidgetRenderCtx): string[] {
  const mn = ctx.locale.step1.moreNav;
  const items: string[] = [];
  if (ctx.callbacks.assistantEnabled) items.push(btn('assistant', esc(ctx.callbacks.assistantLabel || ctx.locale.assistant.defaultLabel), 'mushi-menu-item', ' role="menuitem"'));
  if (ctx.callbacks.onFeatureBoardRequest) items.push(btn('roadmap', esc(mn.communityIdeas), 'mushi-menu-item', ' role="menuitem"'));
  if (ctx.rewardsState) items.push(btn('open-leaderboard', esc(mn.leaderboard), 'mushi-menu-item', ' role="menuitem"'));
  if (ctx.rewardsState || ctx.testerInfo) {
    items.push(btn('open-account', esc(ctx.testerInfo ? (ctx.testerInfo.public_handle ?? ctx.testerInfo.display_name ?? mn.myAccount) : mn.joinCommunity), 'mushi-menu-item', ' role="menuitem"'));
  }
  return items;
}

function renderHeader(ctx: WidgetRenderCtx, title: string, back = false): string {
  const p = ctx.locale.panel;
  const home = ctx.step === 'report' || ctx.step === 'success';
  const n = ctx.unreadCount;
  const pill = home && ctx.callbacks.onReporterReportsRequest
    ? btn('reports', `${esc(p.yourReports)}${n ? ` <span class="mushi-badge">${esc(p.newCount.replace('{n}', String(n)))}</span>` : ''}`, 'mushi-pill-btn')
    : '';
  const items = home ? menuItems(ctx) : [];
  const menu = items.length
    ? `<div class="mushi-menu-wrap">${btn('toggle-more-nav', '⋯', 'mushi-icon-btn', ` aria-haspopup="menu" aria-expanded="${ctx.showMoreNav}" aria-label="${esc(p.moreOptions)}"`)}${ctx.showMoreNav ? `<div class="mushi-menu" role="menu">${items.join('')}</div>` : ''}</div>`
    : '';
  const lead = back
    ? btn('back', '←', 'mushi-icon-btn', ` aria-label="${esc(ctx.locale.widget.back)}"`)
    : ctx.pageFaviconHref
      ? `<img class="mushi-header-host-icon" src="${esc(ctx.pageFaviconHref)}" alt="" referrerpolicy="no-referrer" width="20" height="20" />`
      : '';
  return `${lead}<h2 id="mushi-title" class="mushi-title">${esc(title)}</h2>${pill}${menu}${btn('close', '✕', 'mushi-icon-btn', ` aria-label="${esc(ctx.locale.widget.close)}"`)}`;
}

export function renderOutdatedBanner(ctx: WidgetRenderCtx): string {
  if (!ctx.sdkFreshness) return '';
  if (ctx.config.outdatedBanner === 'off' || ctx.config.outdatedBanner === 'console-only') return '';
  const { latest, current, deprecated, message } = ctx.sdkFreshness;
  if (!latest && !deprecated) return '';
  return `<div class="mushi-outdated" role="status"><strong>Mushi SDK ${esc(current)}</strong> ${latest ? `latest is ${esc(latest)}.` : 'needs attention.'}${message ? ` <span>${esc(message)}</span>` : ''}</div>`;
}

/** "Bug reports by Mushi" mark (see MushiWidgetConfig.brandFooter); new-tab link, click wired via data-action. */
export function renderBrandFooter(ctx: WidgetRenderCtx): string {
  if (ctx.config.brandFooter !== true) return '';
  return `<div class="mushi-brand-footer"><a class="mushi-brand-link" href="${esc(buildBrandFooterHref(ctx.brandRef))}" target="_blank" rel="noopener noreferrer" data-action="brand-footer">${esc(ctx.locale.flows.poweredBy)}<span aria-hidden="true"> ↗</span></a></div>`;
}

// ─── Report screen (§1.1) ─────────────────────────────────────────

/** Label of a type id — built-in, idea, or the host's custom category. */
function chipLabel(ctx: WidgetRenderCtx, id: string): string {
  if (id === 'idea' || id === 'feature') return ctx.config.featureRequestLabel || ctx.rc.categories.idea;
  const custom = ctx.resolveCustomCategory(id);
  if (custom) return custom.label;
  return (ctx.rc.categories as Record<string, string>)[id] ?? '';
}

function chip(ctx: WidgetRenderCtx, id: string, index: number, selected: string | null): string {
  const on = selected === id;
  // Roving tabindex: the checked chip (or the first) is the one Tab stop.
  const tab = on || (selected === null && index === 0) ? '0' : '-1';
  return `<button type="button" class="mushi-chip" role="radio" aria-checked="${on}" tabindex="${tab}" data-action="chip" data-category="${esc(id)}">${esc(chipLabel(ctx, id))}</button>`;
}

function intentOptions(ctx: WidgetRenderCtx): string[] {
  const id = ctx.chip;
  if (!id || id === 'idea') return [];
  const custom = ctx.resolveCustomCategory(id);
  if (custom) return custom.intents ?? [];
  const list = (ctx.locale.step2.intents as Record<string, string[] | undefined>)[id] ?? [];
  return list.slice(0, -1).slice(0, 4);
}

function reportView(ctx: WidgetRenderCtx): ViewRegions {
  const t = ctx.locale;
  const p = t.panel;
  const s3 = t.step3;
  const ids: string[] = [...BUILTIN_CHIPS];
  if (ctx.config.featureRequestCard !== false) ids.push('idea');
  const custom = ctx.config.categories ?? [];
  if (ctx.showAllCategories) ids.push(...custom.map((c) => c.id));
  const chips = ids.map((id, i) => chip(ctx, id, i, ids.includes(ctx.chip ?? '') ? ctx.chip : null)).join('');
  const more = custom.length && !ctx.showAllCategories ? btn('show-all-categories', esc(p.more), 'mushi-chip mushi-chip-more') : '';
  const intents = intentOptions(ctx);
  const intentRow = intents.length
    ? `<div class="mushi-chips mushi-intents" role="radiogroup" aria-label="${esc(chipLabel(ctx, ctx.chip!))}">${intents
        .map((it, i) => `<button type="button" class="mushi-chip mushi-chip-sm" role="radio" aria-checked="${ctx.intent === it}" tabindex="${ctx.intent === it || (!ctx.intent && i === 0) ? '0' : '-1'}" data-action="intent" data-intent="${esc(it)}">${esc(it)}</button>`)
        .join('')}</div>`
    : '';

  const shotLabel = ctx.screenshotCapturing ? s3.screenshotCapturing : ctx.screenshotError ? s3.screenshotRetry : s3.screenshotButton;
  const elLabel = ctx.elementCapturing ? s3.elementCapturing : ctx.elementError ? s3.elementFailed : ctx.elementSelected ? s3.elementSelected : p.pointAt;
  const spin = '<span class="mushi-spinner" aria-hidden="true"></span>';
  const shot = ctx.screenshotAttached && ctx.screenshotPreview
    ? `<figure class="mushi-screenshot-preview${ctx.previewOpen ? ' open' : ''}"><button type="button" class="mushi-thumb" data-action="toggle-preview" aria-expanded="${ctx.previewOpen}"><img src="${esc(ctx.screenshotPreview)}" alt="${esc(s3.screenshotPreviewAlt)}" /></button><figcaption><span class="mushi-attach-name">${esc(s3.screenshotAttached)}</span>${ctx.screenshotHint ? `<span class="mushi-screenshot-hint">${esc(ctx.screenshotHint)}</span>` : ''}<span class="mushi-attach-actions">${ctx.callbacks.onScreenshotAnnotateRequest ? btn('annotate-screenshot', esc(p.markUp), 'mushi-link-btn') : ''}${ctx.allowScreenshotRemove ? btn('remove-screenshot', esc(p.remove), 'mushi-link-btn') : ''}</span></figcaption></figure><div class="mushi-annotate-host" data-role="annotate-host"></div>`
    : ctx.screenshotAvailable
      ? btn('screenshot', `${ctx.screenshotCapturing ? spin : '<span aria-hidden="true">📷</span>'}${esc(shotLabel)}`, `mushi-attach-btn${ctx.screenshotError ? ' error' : ''}`, `${ctx.screenshotCapturing ? ' disabled' : ''} aria-label="${esc(shotLabel)}"`)
      : '';
  const element = ctx.elementAvailable
    ? btn('element', `${ctx.elementCapturing ? spin : '<span aria-hidden="true">⌖</span>'}${esc(elLabel)}`, `mushi-attach-btn${ctx.elementSelected ? ' active' : ''}${ctx.elementError ? ' error' : ''}`, `${ctx.elementCapturing ? ' disabled' : ''} aria-label="${esc(elLabel)}"`)
    : '';
  const reason = ctx.screenshotError && ctx.screenshotErrorReason
    ? `<p class="mushi-note mushi-error-inline" role="status" data-role="screenshot-reason">${esc(s3.screenshotErrors[ctx.screenshotErrorReason])}${ctx.callbacks.onScreenshotShareTabRequest ? ` ${btn('screenshot-share-tab', esc(s3.screenshotShareTab), 'mushi-link-btn')}` : ''}</p>`
    : '';
  const who = ctx.identifiedUser?.name ?? ctx.identifiedUser?.email;
  const feature = ctx.chip === 'idea';

  const hint = ctx.canSend
    ? esc(s3.submitHint.replace('{key}', submitShortcutKey(readPlatform())))
    : esc(ctx.rc.ui.addWords);
  return {
    header: renderHeader(ctx, ctx.config.expandedTitle || p.title),
    lead: `<textarea class="mushi-textarea" data-role="description" rows="3" maxlength="${DESCRIPTION_MAX_LENGTH}" placeholder="${esc(feature ? s3.featurePlaceholder : s3.descriptionPlaceholder)}" aria-label="${esc(p.title)}" aria-describedby="mushi-hint"></textarea>`,
    body: `${ctx.config.betaMode?.enabled ? renderBetaStrip(ctx) : ''}<div class="mushi-chips"><div class="mushi-chip-group" role="radiogroup" aria-label="${esc(p.title)}">${chips}</div>${more}</div>${intentRow}<div class="mushi-attachments">${shot}${element}</div>${reason}<p class="mushi-note">🔒 ${esc(p.privacy)}</p>${who ? `<p class="mushi-note">👤 ${esc(who)}</p>` : ''}${ctx.draftLength > DESCRIPTION_MAX_LENGTH - 400 ? `<p class="mushi-note" aria-live="polite">${ctx.draftLength}/${DESCRIPTION_MAX_LENGTH}</p>` : ''}`,
    footer: `<span class="mushi-footer-hint" id="mushi-hint" data-role="hint">${hint}</span><button type="button" class="mushi-submit" data-action="submit" aria-disabled="${!ctx.canSend || ctx.submitting}"${ctx.submitting ? ' aria-busy="true"' : ''}>${esc(ctx.submitting ? t.widget.submitting : p.send)}</button>`,
  };
}

/** "Questions? {email}" as a mailto link — the report itself never goes by email. */
function betaContact(ctx: WidgetRenderCtx): string {
  const email = ctx.config.betaMode?.contactEmail?.trim();
  if (!email || !/^[^\s@<>"]+@[^\s@<>"]+$/.test(email)) return '';
  const link = `<a class="mushi-link-btn" href="mailto:${esc(encodeURIComponent(email).replace(/%40/g, '@'))}">${esc(email)}</a>`;
  return `<p class="mushi-note mushi-beta-contact">${esc(ctx.locale.flows.betaStrip.contactHint).replace(esc('{email}'), link)}</p>`;
}

/** Who will see the report (beta mode receipt). Truthful: it goes to the developer's queue. */
function betaReceipt(ctx: WidgetRenderCtx): string {
  const beta = ctx.config.betaMode;
  if (!beta?.enabled) return '';
  const strip = ctx.locale.flows.betaStrip;
  const sees = beta.appName ? strip.teamSees.replace('{appName}', beta.appName) : strip.teamSeesGeneric;
  return `<div class="mushi-beta-receipt"><p class="mushi-note">${esc(sees)}</p>${betaContact(ctx)}</div>`;
}

/** "What's new" changelog row (beta mode). */
function renderBetaChangelog(ctx: WidgetRenderCtx): string {
  const latest = ctx.config.betaMode?.changelogItems?.[0];
  if (!latest) return '';
  const whatsNew = esc(ctx.locale.flows.changelog.whatsNew.replace('{version}', latest.version));
  return `<details class="mushi-changelog"><summary>${latest.date ? `${whatsNew} · ${esc(latest.date)}` : whatsNew}</summary><ul>${latest.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></details>`;
}

function renderBetaStrip(ctx: WidgetRenderCtx): string {
  const beta = ctx.config.betaMode!;
  const strip = ctx.locale.flows.betaStrip;
  const appName = esc(beta.appName ?? 'This app');
  const message = beta.message ? esc(beta.message) : esc(strip.defaultMessage).replace('{appName}', appName);
  const perks = beta.perks ?? [];
  return `<div class="mushi-beta-strip" role="note" aria-label="${esc(strip.ariaLabel)}"><p><span class="mushi-beta-tag">Beta</span> ${message}</p>${betaContact(ctx)}${perks.length ? `<ul class="mushi-beta-perks">${perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${renderBetaChangelog(ctx)}</div>`;
}

// ─── Receipt (§1.1 Success) ───────────────────────────────────────

function submitFailureLabel(ctx: WidgetRenderCtx): string | null {
  const s = ctx.locale.flows.success;
  switch (ctx.lastSubmitFailureKind) {
    case 'rate_limited': return s.rateLimited;
    case 'quota': return s.quotaBlocked;
    case 'permanent': return s.permanentFailed;
    case 'retrying': return s.retrying;
  }
  return ctx.lastSubmitQueuedOffline ? s.queuedOffline : null;
}

function receipt(ctx: WidgetRenderCtx): string {
  const s = ctx.locale.flows.success;
  const kind = ctx.lastSubmitFailureKind;
  if (submitFailureLabel(ctx)) {
    const hint = kind === 'rate_limited' ? s.rateLimitedHint
      : kind === 'quota' ? s.quotaBlockedHint
      : kind === 'permanent' ? s.permanentFailedHint
      : kind === 'retrying' ? s.retryingHint
      : s.queuedHint;
    return `<p class="mushi-note mushi-success-receipt mushi-warn" role="status">${esc(hint)}</p>`;
  }
  const sla = esc((ctx.config.responseSlaLabel ?? '').trim() || s.slaDefault);
  if (!ctx.lastReportId) {
    return `<div class="mushi-success-receipt" role="status"><p class="mushi-success-sla">${sla}</p><p class="mushi-note"><span class="mushi-spinner" aria-hidden="true"></span> ${esc(s.delivering)}</p></div>`;
  }
  const id = esc(ctx.lastReportId);
  const dashboard = (ctx.config.dashboardUrl ?? '').replace(/\/$/, '');
  return `<div class="mushi-success-receipt" role="status"><p class="mushi-success-sla">${sla}</p><p class="mushi-note">${esc(s.receipt)} <button type="button" class="mushi-success-receipt-id" data-action="copy-report-id" data-copy-id="${id}" aria-label="Copy report id ${id}">#${esc(ctx.lastReportId.slice(0, 8))}</button>${dashboard ? ` · <a class="mushi-link-btn" href="${esc(`${dashboard}/reports/${encodeURIComponent(ctx.lastReportId)}`)}" target="_blank" rel="noopener noreferrer">${esc(s.trackOnMushi)} ↗</a>` : ''}</p>${ctx.lastSubmitScreenshotDropped ? `<p class="mushi-note mushi-warn">${esc(s.screenshotDropped)}</p>` : ''}</div>`;
}

function skeleton(label: string, rows = 3): string {
  return `<div class="mushi-skeleton" role="status" aria-label="${esc(label)}">${'<span></span>'.repeat(rows)}</div>`;
}

function successView(ctx: WidgetRenderCtx): ViewRegions {
  const s = ctx.locale.flows.success;
  const stamp = ctx.submittedAt ?? new Date();
  const failure = submitFailureLabel(ctx);
  // In-widget tracking needs a server id and the reporter inbox.
  const canTrack = !failure && ctx.lastReportId && ctx.callbacks.onReporterReportsRequest;
  return {
    header: renderHeader(ctx, failure ?? ctx.rc.ui.sent),
    lead: '',
    body: `<div class="mushi-success"><div class="mushi-success-stamp" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/></svg><span class="mushi-success-stamp-label">受</span></div><time class="mushi-success-meta" datetime="${stamp.toISOString()}">${esc(formatReceiptTime(stamp, ctx.config.locale === 'auto' ? undefined : ctx.config.locale))}</time>${receipt(ctx)}${failure ? '' : betaReceipt(ctx) + (ctx.views?.renderOptIns(ctx) ?? '')}${ctx.rewardsState ? renderSuccessRewards(ctx) : ''}</div>`,
    footer: `${canTrack ? btn('track-report', esc(s.trackReport), 'mushi-btn') : '<span></span>'}${btn('done', esc(s.done), 'mushi-submit')}`,
  };
}

/** Points earned + tier progress on the receipt. */
function renderSuccessRewards(ctx: WidgetRenderCtx): string {
  const { tier, nextTier, totalPoints, pointsForReport } = ctx.rewardsState!;
  const projected = totalPoints + pointsForReport;
  let pct = 100;
  let next = '';
  if (nextTier) {
    const base = tier?.pointsThreshold ?? 0;
    const ceiling = nextTier.pointsThreshold;
    pct = ceiling > base ? Math.round(Math.min(1, (projected - base) / (ceiling - base)) * 100) : 100;
    const remaining = Math.max(0, ceiling - projected);
    next = remaining > 0 ? `${remaining.toLocaleString()} pts to ${esc(nextTier.displayName)}` : `🎉 ${esc(nextTier.displayName)}`;
  }
  return `<div class="mushi-success-rewards"><div class="mushi-success-pts-award">+${pointsForReport} pts</div>${nextTier ? `<div class="mushi-tier-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(nextTier.displayName)}"><div class="mushi-tier-bar-fill" style="--mushi-tier-pct:${pct / 100}"></div></div><p class="mushi-note">${next}</p>` : ''}</div>`;
}

/** Reporter copy for a locale code; exported so the class resolves it once per locale change. */
export function resolveReporterCopy(lang: string): ReporterCopy {
  return reporterCopy(lang);
}
