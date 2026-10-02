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
import { statusView } from './reporter-inbox';
import {
  reporterCopy,
  reporterTimelineText,
  type ReporterCopy,
  type ReporterTimelineKind,
} from '@mushi-mushi/core/reporter-ui';
import type { MushiLocale } from './i18n';
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
  emailState: 'idle' | 'saving' | 'saved' | 'error';
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
  switch (ctx.step) {
    case 'report': return reportView(ctx);
    case 'success': return successView(ctx);
    case 'reports': return reportsView(ctx);
    case 'report-detail': return detailView(ctx);
    case 'assistant': return assistantView(ctx);
    case 'roadmap': return roadmapView(ctx);
    case 'leaderboard': return leaderboardView(ctx);
    case 'account': return accountView(ctx);
    case 'cross-app-reports': return crossAppView(ctx);
  }
}

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
export function chipLabel(ctx: WidgetRenderCtx, id: string): string {
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
  return `<div class="mushi-beta-strip" role="note" aria-label="${esc(strip.ariaLabel)}"><p><span class="mushi-beta-tag">Beta</span> ${message}</p>${beta.contactEmail ? `<p class="mushi-note">${esc(strip.contactHint).replace('{email}', esc(beta.contactEmail))}</p>` : ''}${perks.length ? `<ul class="mushi-beta-perks">${perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${renderBetaChangelog(ctx)}</div>`;
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

/** Email + push opt-ins (§4.1). Never pre-ticked; shown only for configured channels. */
function renderOptIns(ctx: WidgetRenderCtx): string {
  const p = ctx.locale.panel;
  const out: string[] = [];
  if (ctx.channels.email && ctx.callbacks.onReporterEmailOptIn) {
    if (ctx.emailState === 'saved') out.push(`<p class="mushi-note" role="status">✉ ${esc(p.emailSaved)}</p>`);
    else {
      out.push(`<label class="mushi-check"><input type="checkbox" data-action="email-optin"${ctx.emailOptInOpen ? ' checked' : ''} /> ${esc(p.emailOptIn)}</label>`);
      if (ctx.emailOptInOpen) {
        out.push(`<div class="mushi-inline-form"><input type="email" class="mushi-input" data-role="optin-email" autocomplete="email" aria-label="${esc(p.emailLabel)}" placeholder="${esc(p.emailLabel)}" value="${esc(ctx.channels.emailPrefill)}" />${btn('save-email', esc(p.save), 'mushi-btn', ctx.emailState === 'saving' ? ' aria-busy="true"' : '')}</div>${ctx.emailState === 'error' ? `<p class="mushi-note mushi-error-inline" role="alert">${esc(ctx.rc.ui.sendFailed)}</p>` : ''}`);
      }
    }
  }
  if (ctx.channels.push && ctx.callbacks.onReporterPushSubscribe) {
    out.push(ctx.pushState === 'on'
      ? `<p class="mushi-note" role="status">🔔 ${esc(p.notifyOn)}</p>`
      : btn('notify-me', `🔔 ${esc(p.notifyMe)}`, 'mushi-btn', ctx.pushState === 'asking' ? ' aria-busy="true"' : ''));
    if (ctx.pushState === 'error') out.push(`<p class="mushi-note mushi-error-inline" role="alert">${esc(ctx.rc.ui.sendFailed)}</p>`);
  }
  return out.length ? `<div class="mushi-optins">${out.join('')}</div>` : '';
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
    body: `<div class="mushi-success"><div class="mushi-success-stamp" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/></svg><span class="mushi-success-stamp-label">受</span></div><time class="mushi-success-meta" datetime="${stamp.toISOString()}">${esc(formatReceiptTime(stamp, ctx.config.locale === 'auto' ? undefined : ctx.config.locale))}</time>${receipt(ctx)}${failure ? '' : renderOptIns(ctx)}${ctx.rewardsState ? renderSuccessRewards(ctx) : ''}</div>`,
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

// ─── Your reports (§2.2) ──────────────────────────────────────────

function statusPill(label: string, tone: string): string {
  return `<span class="mushi-pill mushi-tone-${tone}">${esc(label)}</span>`;
}

function reportTitle(r: MushiReporterReport): string {
  return r.title ?? r.summary ?? r.description ?? `#${r.id.slice(0, 8)}`;
}

/** Type label for a row: the reporter's own pick, never the internal category. */
function typeLabel(ctx: WidgetRenderCtx, userCategory: string | null | undefined): string {
  const id = (userCategory ?? '').toLowerCase();
  if (!id || id === 'other') return '';
  return chipLabel(ctx, id === 'feature_request' ? 'idea' : id);
}

function skeleton(label: string, rows = 3): string {
  return `<div class="mushi-skeleton" role="status" aria-label="${esc(label)}">${'<span></span>'.repeat(rows)}</div>`;
}

/** Unread first, then newest activity. */
export function orderReports(reports: MushiReporterReport[]): MushiReporterReport[] {
  const at = (r: MushiReporterReport) => Date.parse(r.last_event_at ?? r.created_at) || 0;
  return [...reports].sort((a, b) => Number((b.unread_count ?? 0) > 0) - Number((a.unread_count ?? 0) > 0) || at(b) - at(a));
}

function reportRow(ctx: WidgetRenderCtx, r: MushiReporterReport): string {
  const st = statusView(r, ctx.lang);
  if (st.hidden) return '';
  const unread = (r.unread_count ?? 0) > 0;
  const meta = [typeLabel(ctx, r.user_category), r.page, st.othersNote].filter(Boolean).map((x) => esc(String(x))).join(' · ');
  // Line 3 is the news itself, never a repeat of the pill: the developer's
  // words, or what to do about a fix.
  const news = r.last_event_preview && (unread || st.key === 'waiting')
    ? ctx.rc.ui.developerReplied.replace('{text}', r.last_event_preview)
    : st.canVerify && st.key !== 'fixed_next' ? st.detail : '';
  const title = reportTitle(r);
  return `<button type="button" class="mushi-report-row${unread ? ' unread' : ''}" data-report-id="${esc(r.id)}" aria-label="${esc(`${st.label}: ${title}`)}"><span class="mushi-row-top">${statusPill(st.label, st.tone)}<span class="mushi-row-title">${esc(title)}</span><span class="mushi-row-when">${esc(formatRelativeTime(r.last_event_at ?? r.created_at))}</span></span>${meta ? `<span class="mushi-row-meta">${meta}</span>` : ''}${news ? `<span class="mushi-row-news">${esc(news)}</span>` : ''}</button>`;
}

function reportsView(ctx: WidgetRenderCtx): ViewRegions {
  const rc = ctx.rc;
  const rows = orderReports(ctx.reporterReports).map((r) => reportRow(ctx, r)).join('');
  const body = ctx.reporterError
    ? `<p class="mushi-error-inline" role="alert">${esc(rc.ui.loadError)} ${btn('retry-list', esc(rc.ui.retry), 'mushi-link-btn')}</p>${rows}`
    : rows || (ctx.listLoading ? skeleton(ctx.locale.flows.reports.loading) : `<p class="mushi-empty">${esc(rc.ui.empty)}</p>`);
  return { header: renderHeader(ctx, ctx.locale.flows.reports.title, true), lead: '', body: `<div class="mushi-report-list">${body}</div>`, footer: '' };
}

// ─── Report detail: card, timeline, composer (§2.3) ──────────────

interface Entry { kind: ReporterTimelineKind; at: string; text: string; who?: string; pending?: PendingReply }

/** Merge the server timeline (or the comments, on older servers) with replies still in flight. */
export function buildTimeline(ctx: WidgetRenderCtx, report: MushiReporterReport | undefined): Entry[] {
  const rc = ctx.rc;
  const out: Entry[] = [];
  if (ctx.timeline) {
    for (const e of ctx.timeline) {
      out.push({
        kind: e.kind,
        at: e.at,
        text: reporterTimelineText(e.kind, { text: e.text, version: e.version, closed_reason: e.closed_reason }, ctx.lang),
        who: e.kind === 'comment' ? (e.author_name ?? rc.ui.developer) : e.kind === 'reporter_comment' ? rc.ui.you : undefined,
      });
    }
  } else {
    if (report) out.push({ kind: 'received', at: report.created_at, text: rc.timeline.received });
    for (const c of ctx.reporterComments) {
      const mine = c.author_kind === 'reporter';
      out.push({ kind: mine ? 'reporter_comment' : 'comment', at: c.created_at, text: c.body, who: mine ? rc.ui.you : (c.author_name ?? rc.ui.developer) });
    }
  }
  out.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  for (const r of ctx.pendingReplies) out.push({ kind: 'reporter_comment', at: '', text: r.body, who: rc.ui.you, pending: r });
  return out;
}

function entryHtml(ctx: WidgetRenderCtx, e: Entry): string {
  const when = e.at ? `<time datetime="${esc(e.at)}">${esc(formatRelativeTime(e.at))}</time>` : '';
  if (e.kind !== 'comment' && e.kind !== 'reporter_comment') {
    return `<li class="mushi-event"><span>${esc(e.text)}</span>${when}</li>`;
  }
  const mine = e.kind === 'reporter_comment';
  const state = e.pending
    ? e.pending.state === 'sending'
      ? `<span class="mushi-bubble-state">${esc(ctx.rc.ui.sending)}</span>`
      : `<span class="mushi-bubble-state mushi-error-inline">${esc(ctx.rc.ui.sendFailed)} · ${btn('retry-reply', esc(ctx.rc.ui.retry), 'mushi-link-btn', ` data-value="${e.pending.id}"`)}</span>`
    : when;
  return `<li class="mushi-bubble ${mine ? 'mine' : 'dev'}"><strong>${esc(e.who ?? '')}</strong><p>${esc(e.text)}</p>${state}</li>`;
}

function detailView(ctx: WidgetRenderCtx): ViewRegions {
  const rc = ctx.rc;
  const report = ctx.reporterReports.find((r) => r.id === ctx.selectedReportId);
  // Opened via "Track it" before the list caught up → it's new.
  const st = statusView(report ?? { status: 'new' }, ctx.lang);
  const meta = [report?.page, report?.app_version ? `v${report.app_version}` : '', report ? formatRelativeTime(report.created_at) : '']
    .filter(Boolean).map((x) => esc(String(x))).join(' · ');
  const lead = `<div class="mushi-thread-summary"><p class="mushi-card-status">${statusPill(st.label, st.tone)}</p><p class="mushi-note">${esc(st.detail)}${st.othersNote ? ` ${esc(st.othersNote)}.` : ''}</p><p class="mushi-summary-text">${esc(report ? (report.description ?? reportTitle(report)) : `#${(ctx.selectedReportId ?? '').slice(0, 8)}`)}</p>${report?.screenshot_thumb_url ? `<img class="mushi-card-thumb" src="${esc(report.screenshot_thumb_url)}" alt="" />` : ''}${meta ? `<p class="mushi-note">${meta}</p>` : ''}</div>`;

  const entries = buildTimeline(ctx, report);
  const hasDev = entries.some((e) => e.kind === 'comment');
  let body: string;
  if (ctx.threadLoading && entries.length <= 1 && !ctx.pendingReplies.length) {
    body = skeleton(ctx.locale.flows.thread.loading);
  } else {
    body = `${ctx.threadError ? `<p class="mushi-error-inline" role="alert">${esc(rc.ui.loadError)} ${btn('retry-thread', esc(rc.ui.retry), 'mushi-link-btn')}</p>` : ''}<ol class="mushi-timeline">${entries.map((e) => entryHtml(ctx, e)).join('')}</ol>${!hasDev && !ctx.threadError && !ctx.threadLoading ? `<p class="mushi-empty">${esc(rc.ui.noReplies)}</p>` : ''}`;
  }
  const busy = ctx.actionPending ? ' disabled aria-busy="true"' : '';
  const verify = st.canVerify
    ? `<div class="mushi-verify" role="group" aria-label="${esc(st.detail)}">${btn('reporter-confirms', esc(rc.ui.yes), 'mushi-btn', busy)}${btn('reporter-not-fixed', esc(rc.ui.notYet), 'mushi-btn', busy)}</div>`
    : '';
  return {
    header: renderHeader(ctx, ctx.locale.panel.reportTitle, true),
    lead,
    body: `<div class="mushi-thread">${body}</div>${renderOptIns(ctx)}`,
    footer: `${verify}${ctx.actionError ? `<p class="mushi-error-inline mushi-thread-action-error" role="alert">${esc(ctx.actionError)}</p>` : ''}<div class="mushi-thread-composer"><textarea class="mushi-input mushi-reply" data-role="reporter-reply" rows="1" maxlength="2000" placeholder="${esc(ctx.locale.flows.thread.replyPlaceholder)}" aria-label="${esc(ctx.locale.flows.thread.replyPlaceholder)}"></textarea>${btn('reporter-reply', '↑', 'mushi-submit mushi-send', ` aria-label="${esc(ctx.locale.panel.send)}"`)}</div>`,
  };
}

// ─── Secondary views (overflow menu) ──────────────────────────────

function assistantView(ctx: WidgetRenderCtx): ViewRegions {
  const t = ctx.locale.assistant;
  const greeting = ctx.callbacks.assistantGreeting || t.defaultGreeting;
  const chips = (opts: string[]) => opts.length
    ? `<div class="mushi-chips">${opts.map((s) => `<button type="button" class="mushi-chip mushi-chip-sm" data-action="assistant-suggest" data-value="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
    : '';
  const report = (label: string, cls = 'mushi-link-btn') => btn('assistant-report', esc(label), cls);
  const turns = ctx.assistantTurns.length === 0
    ? `<p class="mushi-assistant-greeting">${esc(greeting)}</p>${chips(ctx.callbacks.assistantSuggestions ?? [])}`
    : ctx.assistantTurns.map((turn) => `<div class="mushi-assistant-msg ${turn.role === 'user' ? 'mine' : 'dev'}">${esc(turn.text)}</div>${chips(turn.options ?? [])}${turn.offerReport ? report(t.fileReportCta, 'mushi-btn') : ''}`).join('');
  const thinking = ctx.assistantSending ? `<div class="mushi-assistant-msg dev" role="status" aria-live="polite">${esc(t.thinking)}</div>` : '';
  const error = ctx.assistantError ? `<p class="mushi-error-inline" role="alert">${esc(ctx.assistantError)} ${report(t.fileReportCta)}</p>` : '';
  const stuck = ctx.assistantTurns.length && !ctx.assistantSending && !ctx.assistantError ? report(t.stillStuckCta) : '';
  return {
    header: renderHeader(ctx, ctx.callbacks.assistantLabel || t.defaultLabel, true),
    lead: '',
    body: `<div class="mushi-assistant-log">${turns}${thinking}${error}${stuck}</div>`,
    footer: `<form class="mushi-thread-composer" data-action="assistant-send"><textarea class="mushi-input mushi-reply mushi-assistant-input" rows="1" placeholder="${esc(t.inputPlaceholder)}" aria-label="${esc(t.inputPlaceholder)}"${ctx.assistantSending ? ' disabled' : ''}></textarea><button type="submit" class="mushi-submit mushi-send" aria-label="${esc(t.sendAriaLabel)}"${ctx.assistantSending ? ' disabled' : ''}>↑</button></form>`,
  };
}

function roadmapView(ctx: WidgetRenderCtx): ViewRegions {
  const f = ctx.locale.flows.roadmap;
  const rows = ctx.featureBoard.map((ticket) => {
    const id = String(ticket.id ?? '');
    const voted = Boolean(ticket.my_vote);
    const status = ticket.shipped_at ? f.shipped : String(ticket.status_label ?? ticket.status ?? 'open');
    return `<div class="mushi-report-row mushi-roadmap-row"><span class="mushi-row-top"><span class="mushi-row-title">${esc(String(ticket.subject ?? f.untitled))}</span></span><span class="mushi-row-meta">${esc(status)} · ${esc(f.voteCount.replace('{n}', String(Number(ticket.vote_count ?? 0))))}</span>${ctx.callbacks.onFeatureBoardVote ? `<button type="button" class="mushi-btn" data-vote-id="${esc(id)}" aria-pressed="${voted}">${esc(voted ? f.voted : f.vote)}</button>` : ''}</div>`;
  }).join('');
  return {
    header: renderHeader(ctx, f.title, true),
    lead: '',
    body: `${ctx.reporterError ? `<p class="mushi-error-inline" role="alert">${esc(ctx.reporterError)}</p>` : ''}${rows || (ctx.listLoading ? skeleton(f.loading) : `<p class="mushi-empty">${esc(f.empty)}</p>`)}`,
    footer: '',
  };
}

function leaderboardView(ctx: WidgetRenderCtx): ViewRegions {
  const f = ctx.locale.flows.leaderboard;
  const isGlobal = ctx.globalLeaderboard !== null || ctx.globalLeaderboardLoading;
  const entries: Array<Partial<MushiLeaderboardEntry> & { display_name: string | null; points_30d: number; total_points: number }> = isGlobal
    ? (ctx.globalLeaderboard ?? [])
    : (ctx.leaderboardEntries ?? []);
  const loading = isGlobal ? ctx.globalLeaderboardLoading : ctx.leaderboardLoading;
  const rows = entries.map((e, i) => {
    const rank = e.rank || i + 1;
    const me = ctx.testerReputation && e.tester_id === ctx.testerReputation.tester_id;
    return `<li class="mushi-lb-row${me ? ' me' : ''}"><span>#${rank}</span><span class="mushi-row-title">${esc(e.public_handle ?? e.display_name ?? f.anon)}</span><span>${(e.points_30d ?? e.total_points).toLocaleString()} pts</span></li>`;
  }).join('');
  const myRank = ctx.testerReputation?.rank;
  return {
    header: renderHeader(ctx, f.title, true),
    lead: '',
    body: `${loading ? skeleton(f.loading) : ''}${!loading && !entries.length ? `<p class="mushi-empty">${esc(f.empty)}</p>` : ''}<ol class="mushi-lb">${rows}</ol>${myRank ? `<p class="mushi-note">${esc(f.myRank.replace('{rank}', String(myRank)))}</p>` : !ctx.testerJwt ? btn('open-account', esc(f.signInPrompt), 'mushi-link-btn') : ''}<p class="mushi-note">${esc(f.footer)}</p>`,
    footer: '',
  };
}

function accountView(ctx: WidgetRenderCtx): ViewRegions {
  const f = ctx.locale.flows.account;
  const tester = ctx.testerInfo;
  if (tester) {
    const handle = tester.public_handle ?? tester.display_name ?? ctx.locale.flows.leaderboard.anon;
    const rep = ctx.testerReputation;
    const rank = rep ? f.rankSummary.replace('{rank}', String(rep.rank ?? '—')).replace('{points}', (rep.points_30d ?? 0).toLocaleString()) : '';
    return {
      header: renderHeader(ctx, f.title, true),
      lead: '',
      body: `<div class="mushi-thread-summary"><p class="mushi-summary-text">${esc(handle)}</p>${rank ? `<p class="mushi-note">${esc(rank)}</p>` : ''}</div>${btn('open-cross-app-reports', esc(f.crossAppReports), 'mushi-menu-item')}${btn('open-global-leaderboard', esc(f.viewLeaderboard), 'mushi-menu-item')}${btn('sign-out-tester', esc(f.signOut), 'mushi-link-btn')}`,
      footer: '',
    };
  }
  if (ctx.magicLinkSent) {
    return {
      header: renderHeader(ctx, f.checkEmailTitle, true),
      lead: '',
      body: `<p class="mushi-note">${esc(f.magicLinkSent.replace('{email}', ctx.magicLinkEmail))}</p>${btn('resend-magic-link', esc(f.resendEmail), 'mushi-link-btn')}${ctx.magicLinkError ? `<p class="mushi-error-inline" role="alert">${esc(ctx.magicLinkError)}</p>` : ''}`,
      footer: '',
    };
  }
  return {
    header: renderHeader(ctx, f.joinTitle, true),
    lead: '',
    body: `<p class="mushi-note">${esc(f.signInPrompt)}</p><input type="email" class="mushi-input" data-role="magic-link-email" aria-label="${esc(f.emailLabel)}" placeholder="${esc(f.emailPlaceholder)}" autocomplete="email" value="${esc(ctx.magicLinkEmail)}" />${ctx.magicLinkError ? `<p class="mushi-error-inline" role="alert">${esc(ctx.magicLinkError)}</p>` : ''}`,
    footer: `<span></span>${btn('send-magic-link', esc(ctx.magicLinkSending ? f.sending : f.sendLink), 'mushi-submit', ctx.magicLinkSending ? ' aria-busy="true"' : '')}`,
  };
}

function crossAppView(ctx: WidgetRenderCtx): ViewRegions {
  const f = ctx.locale.flows.crossApp;
  const reports = ctx.crossAppReports ?? [];
  const groups = new Map<string, { name: string; slug: string | null; domain: string | null; reports: MushiCrossAppReport[] }>();
  for (const r of reports) {
    const key = r.project_id ?? 'unknown';
    if (!groups.has(key)) groups.set(key, { name: r.app_name ?? f.unknownApp, slug: r.app_slug ?? null, domain: r.app_domain ?? null, reports: [] });
    groups.get(key)!.reports.push(r);
  }
  const html = [...groups.entries()].map(([projectId, g]) => `<section class="mushi-xapp-group"><h3 class="mushi-xapp-app-name">${renderAppIconHtml({ projectId, appName: g.name, appSlug: g.slug, appDomain: g.domain })} ${esc(g.name)}</h3>${g.reports.map((r) => {
    const st = statusView(r, ctx.lang);
    // The internal category never reaches a reporter: untitled rows show their short id.
    return `<div class="mushi-report-row"><span class="mushi-row-top">${statusPill(st.label, st.tone)}<span class="mushi-row-title">${esc(r.title ?? `#${r.short_id ?? r.id.slice(0, 8)}`)}</span><span class="mushi-row-when">${esc(formatRelativeTime(r.created_at))}</span></span></div>`;
  }).join('')}</section>`).join('');
  return {
    header: renderHeader(ctx, f.title, true),
    lead: '',
    body: `${ctx.crossAppLoading ? skeleton(f.loading) : ''}${!ctx.crossAppLoading && !reports.length ? `<p class="mushi-empty">${esc(f.empty)}</p>` : ''}${html}`,
    footer: '',
  };
}

/** Reporter copy for a locale code; exported so the class resolves it once per locale change. */
export function resolveReporterCopy(lang: string): ReporterCopy {
  return reporterCopy(lang);
}
