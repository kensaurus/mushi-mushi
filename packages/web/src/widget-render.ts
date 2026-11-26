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
import { icon, TYPE_ICON_IDS, type WidgetIconName } from './widget-icons';
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
  /** Characters still needed before Send goes through (0 when ready). */
  charsNeeded: number;
  /** The minimum length, for the meter ring. */
  minLength: number;
  /** Send was pressed below the minimum: the meter turns red until it is met. */
  lengthNudge: boolean;
  /** Shake the meter once (the render right after the refused Send). */
  nudgeShake: boolean;
  /** The header BETA chip's disclosure is open. */
  betaOpen: boolean;
  submitting: boolean;
  screenshotCapturing: boolean;
  screenshotAttached: boolean;
  screenshotPreview: string | null;
  previewOpen: boolean;
  /** Send captured the screenshot just now; ask the reporter to check it and Send again. */
  screenshotReview: boolean;
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
  /** The last submit was stopped on the device; shown on the report step. */
  submitNotSent: 'blocked' | 'throttled' | null;
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
  /** A floating launcher is on screen and the host allows hiding it for the visit. */
  launcherDismissible: boolean;
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
  /** Report screen only: the length meter under the textarea (re-rendered per keystroke). */
  meter?: string;
  body: string;
  footer: string;
}

const esc = escapeHtml;
const BUILTIN_CHIPS = ['bug', 'slow', 'visual', 'confusing'] as const;
/** Ring circumference for r = 8 (the meter's SVG). */
const RING = 50.27;
/** For a custom locale object written before `widget.hideLauncher` existed. */
const HIDE_LAUNCHER_FALLBACK = 'Hide the bug button for this visit';

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
  // On the report screen the picked type's icon replaces the host favicon (ADR 0070).
  const typeBadge = ctx.step === 'report' && ctx.chip && TYPE_ICON_IDS.has(ctx.chip)
    ? `<span class="mushi-header-type" aria-hidden="true">${icon(ctx.chip as WidgetIconName)}</span>`
    : '';
  const lead = back
    ? btn('back', '←', 'mushi-icon-btn', ` aria-label="${esc(ctx.locale.widget.back)}"`)
    : typeBadge || (ctx.pageFaviconHref
      ? `<img class="mushi-header-host-icon" src="${esc(ctx.pageFaviconHref)}" alt="" referrerpolicy="no-referrer" width="20" height="20" />`
      : '');
  const beta = ctx.step === 'report' && ctx.config.betaMode?.enabled ? renderBetaChip(ctx) : '';
  return `${lead}<h2 id="mushi-title" class="mushi-title">${esc(title)}</h2>${beta}${pill}${menu}${btn('close', '✕', 'mushi-icon-btn', ` aria-label="${esc(ctx.locale.widget.close)}"`)}`;
}

/**
 * The beta notice as a header chip (ADR 0070): one word in the header, the
 * message, contact link, perks and changelog in a disclosure under it. A
 * button, not a hover tooltip, so touch and keyboard users can open it.
 */
function renderBetaChip(ctx: WidgetRenderCtx): string {
  const strip = ctx.locale.flows.betaStrip;
  const chip = btn('toggle-beta', 'Beta', 'mushi-beta-chip', ` aria-expanded="${ctx.betaOpen}" aria-controls="mushi-beta-pop" aria-label="${esc(strip.ariaLabel)}"`);
  return ctx.betaOpen ? `${chip}${renderBetaStrip(ctx)}` : chip;
}

export function renderOutdatedBanner(ctx: WidgetRenderCtx): string {
  if (!ctx.sdkFreshness) return '';
  if (ctx.config.outdatedBanner === 'off' || ctx.config.outdatedBanner === 'console-only') return '';
  const { latest, current, deprecated, message } = ctx.sdkFreshness;
  if (!latest && !deprecated) return '';
  return `<div class="mushi-outdated" role="status"><strong>Mushi SDK ${esc(current)}</strong> ${latest ? `latest is ${esc(latest)}.` : 'needs attention.'}${message ? ` <span>${esc(message)}</span>` : ''}</div>`;
}

/** "Bug reports by Mushi Mushi" mark (see MushiWidgetConfig.brandFooter); new-tab link, click wired via data-action. */
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
  if (id === 'other') return ctx.locale.step1.categories.other;
  return (ctx.rc.categories as Record<string, string>)[id] ?? '';
}

/**
 * One report-type tile (ADR 0070): its colour, its icon, its label. A radio in
 * a roving-tabindex radiogroup; the checked tile (or the first) is the one Tab stop.
 */
function tile(ctx: WidgetRenderCtx, id: string, index: number, selected: string | null): string {
  const on = selected === id;
  const tab = on || (selected === null && index === 0) ? '0' : '-1';
  const custom = TYPE_ICON_IDS.has(id) ? undefined : ctx.resolveCustomCategory(id);
  const glyph = custom
    ? custom.icon ? `<span class="mushi-tile-emoji" aria-hidden="true">${esc(custom.icon)}</span>` : icon('other')
    : icon((TYPE_ICON_IDS.has(id) ? id : 'other') as WidgetIconName);
  return `<button type="button" class="mushi-tile" role="radio" aria-checked="${on}" tabindex="${tab}" data-action="chip" data-category="${esc(id)}"><span class="mushi-tile-ico">${glyph}</span><span class="mushi-tile-label">${esc(chipLabel(ctx, id))}</span><span class="mushi-tile-check" aria-hidden="true">${icon('check')}</span></button>`;
}

/** Textarea prompt for the picked type: the host's idea text, the locale's per-type prompt, then the old placeholders. */
function promptFor(ctx: WidgetRenderCtx): string {
  const s3 = ctx.locale.step3;
  const prompts = ctx.locale.panel.prompts ?? {};
  const id = ctx.chip;
  if (id === 'idea') return ctx.config.featureRequestDescription || prompts.idea || s3.featurePlaceholder;
  if (id && id in prompts) return prompts[id as keyof typeof prompts] || s3.descriptionPlaceholder;
  return prompts.other || s3.descriptionPlaceholder;
}

/** The ring + "N more" under the textarea; a check and the shortcut once Send can go. */
function renderMeter(ctx: WidgetRenderCtx): string {
  const p = ctx.locale.panel;
  const max = ctx.draftLength > DESCRIPTION_MAX_LENGTH - 400
    ? `<span class="mushi-count-max">${ctx.draftLength}/${DESCRIPTION_MAX_LENGTH}</span>`
    : '';
  if (!ctx.charsNeeded) {
    const hint = esc(ctx.locale.step3.submitHint.replace('{key}', submitShortcutKey(readPlatform())));
    return `<span class="mushi-count ok" id="mushi-hint" data-role="hint">${icon('check')}<span>${hint}</span>${max}</span>`;
  }
  const done = ctx.minLength > 0 ? Math.min(1, (ctx.minLength - ctx.charsNeeded) / ctx.minLength) : 0;
  const offset = (RING * (1 - done)).toFixed(2);
  const left = (p.charsLeft ?? '{n} more characters').replace('{n}', String(ctx.charsNeeded));
  return `<span class="mushi-count${ctx.lengthNudge ? ' nudge' : ''}${ctx.nudgeShake ? ' shake' : ''}" id="mushi-hint" data-role="hint"><svg class="mushi-ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="mushi-ring-track" cx="10" cy="10" r="8"/><circle class="mushi-ring-fill" cx="10" cy="10" r="8" stroke-dasharray="${RING}" stroke-dashoffset="${offset}"/></svg><span>${esc(left)}</span>${max}</span>`;
}

function intentOptions(ctx: WidgetRenderCtx): string[] {
  const id = ctx.chip;
  if (!id || id === 'idea' || id === 'other') return [];
  const custom = ctx.resolveCustomCategory(id);
  if (custom) return custom.intents ?? [];
  const list = (ctx.locale.step2.intents as Record<string, string[] | undefined>)[id] ?? [];
  return list.slice(0, -1).slice(0, 4);
}

/**
 * The report-type chip ids, merged by id. Built-ins (and Idea) come first; a
 * host category whose id matches one of them overrides that slot in place
 * (chipLabel shows its label), so it is not listed again. The rest are the
 * host's own types, behind "More…", in first-seen order (the first definition
 * of an id wins, as resolveCustomCategory's `find` does).
 */
function reportTypeIds(config: WidgetRenderCtx['config']): { primary: string[]; more: string[] } {
  const primary: string[] = [...BUILTIN_CHIPS];
  if (config.featureRequestCard !== false) primary.push('idea');
  // "Other" closes the 3×2 grid: an explicit "none of these" (ADR 0070).
  primary.push('other');
  const seen = new Set(primary);
  const more: string[] = [];
  for (const { id } of config.categories ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    more.push(id);
  }
  return { primary, more };
}

function reportView(ctx: WidgetRenderCtx): ViewRegions {
  const t = ctx.locale;
  const p = t.panel;
  const s3 = t.step3;
  const { primary, more: extra } = reportTypeIds(ctx.config);
  const ids = ctx.showAllCategories ? [...primary, ...extra] : primary;
  const tiles = ids.map((id, i) => tile(ctx, id, i, ids.includes(ctx.chip ?? '') ? ctx.chip : null)).join('');
  const more = extra.length && !ctx.showAllCategories ? `<div class="mushi-more-row">${btn('show-all-categories', esc(p.more), 'mushi-chip mushi-chip-sm mushi-chip-more')}</div>` : '';
  const intents = intentOptions(ctx);
  const intentRow = intents.length
    ? `<div class="mushi-chips mushi-intents" role="radiogroup" aria-label="${esc(chipLabel(ctx, ctx.chip!))}">${intents
        .map((it, i) => `<button type="button" class="mushi-chip mushi-chip-sm" role="radio" aria-checked="${ctx.intent === it}" tabindex="${ctx.intent === it || (!ctx.intent && i === 0) ? '0' : '-1'}" data-action="intent" data-intent="${esc(it)}">${esc(it)}</button>`)
        .join('')}</div>`
    : '';

  const shotLabel = ctx.screenshotCapturing ? s3.screenshotCapturing : ctx.screenshotError ? s3.screenshotRetry : s3.screenshotButton;
  const elLabel = ctx.elementCapturing ? s3.elementCapturing : ctx.elementError ? s3.elementFailed : ctx.elementSelected ? s3.elementSelected : p.pointAt;
  const spin = '<span class="mushi-spinner" aria-hidden="true"></span>';
  // Attachments are icon tools (camera, crosshair) with the label as tooltip
  // and accessible name; an attached screenshot becomes its own thumbnail.
  const tool = (action: string, glyph: string, label: string, cls: string, busy: boolean, badge: boolean) =>
    btn(action, `${busy ? spin : glyph}${badge ? `<span class="mushi-tool-badge" aria-hidden="true">${icon('check')}</span>` : ''}`, `mushi-tool${cls}`, `${busy ? ' disabled' : ''} aria-label="${esc(label)}" title="${esc(label)}"`);
  const shotTools = `${ctx.callbacks.onScreenshotAnnotateRequest ? tool('annotate-screenshot', icon('pencil'), p.markUp, '', false, false) : ''}${ctx.allowScreenshotRemove ? tool('remove-screenshot', icon('close'), p.remove, '', false, false) : ''}`;
  const shot = ctx.screenshotAttached && ctx.screenshotPreview
    ? `<figure class="mushi-screenshot-preview${ctx.previewOpen ? ' open' : ''}"><button type="button" class="mushi-thumb" data-action="toggle-preview" aria-expanded="${ctx.previewOpen}" title="${esc(s3.screenshotAttached)}"><img src="${esc(ctx.screenshotPreview)}" alt="${esc(s3.screenshotPreviewAlt)}" /><span class="mushi-tool-badge" aria-hidden="true">${icon('check')}</span></button><figcaption><span class="mushi-shot-tools">${shotTools}</span>${ctx.screenshotHint ? `<span class="mushi-screenshot-hint">${esc(ctx.screenshotHint)}</span>` : ''}<span class="mushi-sr">${esc(s3.screenshotAttached)}</span></figcaption></figure><div class="mushi-annotate-host" data-role="annotate-host"></div>`
    : ctx.screenshotAvailable
      ? tool('screenshot', icon('camera'), shotLabel, ctx.screenshotError ? ' error' : '', ctx.screenshotCapturing, false)
      : '';
  const element = ctx.elementAvailable
    ? tool('element', icon('crosshair'), elLabel, `${ctx.elementSelected ? ' active' : ''}${ctx.elementError ? ' error' : ''}`, ctx.elementCapturing, ctx.elementSelected)
    : '';
  const reason = ctx.screenshotError && ctx.screenshotErrorReason
    ? `<p class="mushi-note mushi-error-inline" role="status" data-role="screenshot-reason">${esc(s3.screenshotErrors[ctx.screenshotErrorReason])}${ctx.callbacks.onScreenshotShareTabRequest ? ` ${btn('screenshot-share-tab', esc(s3.screenshotShareTab), 'mushi-link-btn')}` : ''}</p>`
    : '';
  const review = ctx.screenshotReview && ctx.screenshotAttached && ctx.screenshotPreview
    ? `<p class="mushi-note mushi-screenshot-review" role="status" data-role="screenshot-review">${esc(s3.screenshotReview)}</p>`
    : '';
  const notSent = ctx.submitNotSent
    ? `<p class="mushi-note mushi-error-inline" data-role="not-sent">${esc(ctx.submitNotSent === 'throttled' ? s3.notSentThrottled : s3.notSentBlocked)}</p>`
    : '';
  const who = ctx.identifiedUser?.name ?? ctx.identifiedUser?.email;
  const privacyShort = p.privacyShort ?? 'Only the developer sees this';
  // Footer: one 🔒 line (the full sentence is its tooltip and screen-reader
  // text) beside Send. Send is never disabled for length: the meter says why.
  const privacy = `<span class="mushi-privacy" title="${esc(p.privacy)}">${icon('lock')}<span class="mushi-privacy-text" aria-hidden="true">${esc(privacyShort)}${who ? ` · ${esc(who)}` : ''}</span><span class="mushi-sr">${esc(p.privacy)}${who ? ` ${esc(who)}` : ''}</span></span>`;
  return {
    header: renderHeader(ctx, ctx.config.expandedTitle || p.title),
    lead: `<div class="mushi-tiles" role="radiogroup" aria-label="${esc(p.typeQuestion ?? p.title)}">${tiles}</div>${more}${intentRow}<textarea class="mushi-textarea" data-role="description" rows="3" maxlength="${DESCRIPTION_MAX_LENGTH}" placeholder="${esc(promptFor(ctx))}" aria-label="${esc(promptFor(ctx))}" aria-describedby="mushi-hint"></textarea>`,
    meter: renderMeter(ctx),
    body: `${review}<div class="mushi-attachments">${shot}${element}</div>${reason}${notSent}${ctx.launcherDismissible ? `<p class="mushi-note">${btn('hide-launcher', esc(t.widget.hideLauncher ?? HIDE_LAUNCHER_FALLBACK), 'mushi-link-btn')}</p>` : ''}`,
    footer: `${privacy}<button type="button" class="mushi-submit" data-action="submit" data-ready="${ctx.canSend}" aria-disabled="${ctx.submitting}"${ctx.submitting ? ' aria-busy="true"' : ''}>${esc(ctx.submitting ? t.widget.submitting : p.send)}${ctx.submitting ? '' : icon('send')}</button>`,
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
  return `<div class="mushi-beta-strip mushi-beta-pop" id="mushi-beta-pop" role="note" aria-label="${esc(strip.ariaLabel)}"><p>${message}</p>${betaContact(ctx)}${perks.length ? `<ul class="mushi-beta-perks">${perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${renderBetaChangelog(ctx)}</div>`;
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
    return `<div class="mushi-success-receipt" role="status"><p class="mushi-success-sla">${icon('clock')}<span>${sla}</span></p><p class="mushi-note"><span class="mushi-spinner" aria-hidden="true"></span> ${esc(s.delivering)}</p></div>`;
  }
  const id = esc(ctx.lastReportId);
  const dashboard = (ctx.config.dashboardUrl ?? '').replace(/\/$/, '');
  return `<div class="mushi-success-receipt" role="status"><p class="mushi-success-sla">${icon('clock')}<span>${sla}</span></p><p class="mushi-note">${esc(s.receipt)} <button type="button" class="mushi-success-receipt-id" data-action="copy-report-id" data-copy-id="${id}" aria-label="Copy report id ${id}">#${esc(ctx.lastReportId.slice(0, 8))}</button>${dashboard ? ` · <a class="mushi-link-btn" href="${esc(`${dashboard}/reports/${encodeURIComponent(ctx.lastReportId)}`)}" target="_blank" rel="noopener noreferrer">${esc(s.trackOnMushi)} ↗</a>` : ''}</p>${ctx.lastSubmitScreenshotDropped ? `<p class="mushi-note mushi-warn">${esc(s.screenshotDropped)}</p>` : ''}</div>`;
}

/**
 * The success mark (ADR 0070): a ring that draws itself, then a check and
 * "Got it" once the server confirmed the report (until then, the ring only).
 */
function successMark(ctx: WidgetRenderCtx): string {
  const got = Boolean(ctx.lastReportId);
  const check = got ? '<path class="mushi-success-check" d="M31 51l13 13 26-27"/>' : '';
  const title = got ? `<p class="mushi-success-title">${esc(ctx.locale.panel.delivered ?? 'Got it')}</p>` : '';
  return `<div class="mushi-success-stamp" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/>${check}</svg></div>${title}`;
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
    body: `<div class="mushi-success">${failure ? '' : successMark(ctx)}<time class="mushi-success-meta" datetime="${stamp.toISOString()}">${esc(formatReceiptTime(stamp, ctx.config.locale === 'auto' ? undefined : ctx.config.locale))}</time>${receipt(ctx)}${failure ? '' : betaReceipt(ctx) + (ctx.views?.renderOptIns(ctx) ?? '')}${ctx.rewardsState ? renderSuccessRewards(ctx) : ''}</div>`,
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
