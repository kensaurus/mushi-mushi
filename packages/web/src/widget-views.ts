/**
 * FILE: packages/web/src/widget-views.ts
 * PURPOSE: The panel views most visits never open — Your reports (list, detail,
 *          timeline, composer), the email / push opt-ins, the update-toast text
 *          and the overflow views (Ask, Community ideas, leaderboard, account,
 *          cross-app reports). Loaded on demand into dist/chunks/ so a host
 *          whose users never open them pays no bytes for them.
 *
 * Runtime imports are limited to the external `@mushi-mushi/core/reporter-ui`:
 * the shared render helpers arrive through `initViews(renderKit)`, so esbuild
 * never hoists main-entry code into a shared chunk.
 */
import type {
  MushiCrossAppReport,
  MushiLeaderboardEntry,
  MushiReporterReport,
} from '@mushi-mushi/core';
import {
  fillReporterTemplate,
  isReporterConversation,
  reporterCopy,
  reporterStatus,
  reporterTimelineEntryText,
} from '@mushi-mushi/core/reporter-ui';
import type { PendingReply } from './widget-helpers';
import type { RenderKit, ViewRegions, WidgetRenderCtx } from './widget-render';

let esc: RenderKit['esc'];
let btn: RenderKit['btn'];
let renderHeader: RenderKit['renderHeader'];
let chipLabel: RenderKit['chipLabel'];
let skeleton: RenderKit['skeleton'];
let formatRelativeTime: RenderKit['formatRelativeTime'];
let renderAppIconHtml: RenderKit['renderAppIconHtml'];

/** Called once by the widget right after the chunk loads. */
export function initViews(kit: RenderKit): void {
  ({ esc, btn, renderHeader, chipLabel, skeleton, formatRelativeTime, renderAppIconHtml } = kit);
}

/**
 * The toast for unread updates, or null when there are none. One report:
 * what happened to it ("Fixed in v1.4", "The developer replied…"). Several:
 * "3 updates on your reports".
 */
export function pickUpdateToast(
  reports: MushiReporterReport[],
  lang: string,
  repliedText: string,
): { text: string; reportId: string | null; detail?: string } | null {
  const unread = reports.filter((r) => (r.unread_count ?? 0) > 0 && !reporterStatus(r, lang).hidden);
  const total = unread.reduce((n, r) => n + (r.unread_count ?? 0), 0);
  if (!total) return null;
  if (unread.length > 1) return { text: fillReporterTemplate(reporterCopy(lang).ui.updates, { n: total }), reportId: null };
  const report = unread[0]!;
  const status = reporterStatus(report, lang);
  // A fix (or work on one) is the news; a question or any other update is the
  // developer talking. The report's own title says which report it is.
  const statusNews = status.key === 'fixing' || status.canVerify || (!report.last_admin_reply_at && status.key !== 'waiting');
  const detail = report.title ?? report.summary ?? undefined;
  return { text: statusNews ? status.label : repliedText, reportId: report.id, ...(detail ? { detail } : {}) };
}

/** Email + push opt-ins (§4.1). Never pre-ticked; shown only for configured channels. */
export function renderOptIns(ctx: WidgetRenderCtx): string {
  const p = ctx.locale.panel;
  const out: string[] = [];
  if (ctx.channels.email && ctx.callbacks.onReporterEmailOptIn) {
    const ui = ctx.rc.ui;
    if (ctx.emailState === 'saved') out.push(`<p class="mushi-note" role="status">✉ ${esc(ui.emailCheckInbox)}</p>`);
    else {
      out.push(`<label class="mushi-check"><input type="checkbox" data-action="email-optin"${ctx.emailOptInOpen ? ' checked' : ''} /> ${esc(ui.emailOptIn)}</label>`);
      if (ctx.emailOptInOpen) {
        out.push(`<div class="mushi-inline-form"><input type="email" class="mushi-input" data-role="optin-email" autocomplete="email" aria-label="${esc(ui.emailOptIn)}" placeholder="${esc(ui.emailPlaceholder)}" value="${esc(ctx.channels.emailPrefill)}" />${btn('save-email', esc(ui.emailSubmit), 'mushi-btn', ctx.emailState === 'saving' ? ' aria-busy="true"' : '')}</div>${ctx.emailState === 'invalid' || ctx.emailState === 'error' ? `<p class="mushi-note mushi-error-inline" role="alert">${esc(ctx.emailState === 'invalid' ? ui.emailInvalid : ui.emailFailed)}</p>` : ''}`);
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

/** Unread first, then newest activity. */
function orderReports(reports: MushiReporterReport[]): MushiReporterReport[] {
  const at = (r: MushiReporterReport) => Date.parse(r.last_event_at ?? r.created_at) || 0;
  return [...reports].sort((a, b) => Number((b.unread_count ?? 0) > 0) - Number((a.unread_count ?? 0) > 0) || at(b) - at(a));
}

function reportRow(ctx: WidgetRenderCtx, r: MushiReporterReport): string {
  const st = reporterStatus(r, ctx.lang);
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

export function reportsView(ctx: WidgetRenderCtx): ViewRegions {
  const rc = ctx.rc;
  const rows = orderReports(ctx.reporterReports).map((r) => reportRow(ctx, r)).join('');
  const body = ctx.reporterError
    ? `<p class="mushi-error-inline" role="alert">${esc(rc.ui.loadError)} ${btn('retry-list', esc(rc.ui.retry), 'mushi-link-btn')}</p>${rows}`
    : rows || (ctx.listLoading ? skeleton(ctx.locale.flows.reports.loading) : `<p class="mushi-empty">${esc(rc.ui.empty)}</p>`);
  return { header: renderHeader(ctx, ctx.locale.flows.reports.title, true), lead: '', body: `<div class="mushi-report-list">${body}</div>`, footer: '' };
}

// ─── Report detail: card, timeline, composer (§2.3) ──────────────

interface Entry { kind: string; at: string; text: string; who?: string; mine?: boolean; talk?: boolean; pending?: PendingReply }

/** Merge the server timeline (or the comments, on older servers) with replies still in flight. */
function buildTimeline(ctx: WidgetRenderCtx, report: MushiReporterReport | undefined): Entry[] {
  const rc = ctx.rc;
  const out: Entry[] = [];
  if (ctx.timeline) {
    for (const e of ctx.timeline) {
      const mine = e.kind === 'reporter_comment';
      out.push({
        kind: e.kind,
        at: e.at,
        // Pipeline events re-render from the template in the reporter's
        // language; developer and reporter words are shown as written.
        text: isReporterConversation(e) ? (e.body ?? e.text) : reporterTimelineEntryText(e, ctx.lang),
        talk: isReporterConversation(e),
        mine,
        who: mine ? rc.ui.you : rc.ui.developer,
      });
    }
  } else {
    if (report) out.push({ kind: 'received', at: report.created_at, text: rc.timeline.received });
    for (const c of ctx.reporterComments) {
      const mine = c.author_kind === 'reporter';
      out.push({ kind: mine ? 'reporter_comment' : 'comment', at: c.created_at, text: c.body, talk: true, mine, who: mine ? rc.ui.you : (c.author_name ?? rc.ui.developer) });
    }
  }
  out.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  for (const r of ctx.pendingReplies) out.push({ kind: 'reporter_comment', at: '', text: r.body, who: rc.ui.you, talk: true, mine: true, pending: r });
  return out;
}

function entryHtml(ctx: WidgetRenderCtx, e: Entry): string {
  const when = e.at ? `<time datetime="${esc(e.at)}">${esc(formatRelativeTime(e.at))}</time>` : '';
  if (!e.talk) return `<li class="mushi-event"><span>${esc(e.text)}</span>${when}</li>`;
  const mine = Boolean(e.mine);
  const state = e.pending
    ? e.pending.state === 'sending'
      ? `<span class="mushi-bubble-state">${esc(ctx.rc.ui.sending)}</span>`
      : `<span class="mushi-bubble-state mushi-error-inline">${esc(ctx.rc.ui.sendFailed)} · ${btn('retry-reply', esc(ctx.rc.ui.retry), 'mushi-link-btn', ` data-value="${e.pending.id}"`)}</span>`
    : when;
  return `<li class="mushi-bubble ${mine ? 'mine' : 'dev'}"><strong>${esc(e.who ?? '')}</strong><p>${esc(e.text)}</p>${state}</li>`;
}

export function detailView(ctx: WidgetRenderCtx): ViewRegions {
  const rc = ctx.rc;
  const report = ctx.reporterReports.find((r) => r.id === ctx.selectedReportId);
  // Opened via "Track it" before the list caught up → it's new.
  const st = reporterStatus(report ?? { status: 'new' }, ctx.lang);
  const meta = [report?.page, report?.app_version ? `v${report.app_version}` : '', report ? formatRelativeTime(report.created_at) : '']
    .filter(Boolean).map((x) => esc(String(x))).join(' · ');
  const lead = `<div class="mushi-thread-summary"><p class="mushi-card-status">${statusPill(st.label, st.tone)}</p><p class="mushi-note">${esc(st.detail)}${st.othersNote ? ` ${esc(st.othersNote)}.` : ''}</p><p class="mushi-summary-text">${esc(report ? (report.description ?? reportTitle(report)) : `#${(ctx.selectedReportId ?? '').slice(0, 8)}`)}</p>${report?.screenshot_thumb_url ? `<img class="mushi-card-thumb" src="${esc(report.screenshot_thumb_url)}" alt="" />` : ''}${meta ? `<p class="mushi-note">${meta}</p>` : ''}</div>`;

  const entries = buildTimeline(ctx, report);
  const hasDev = entries.some((e) => e.talk && !e.mine);
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

export function assistantView(ctx: WidgetRenderCtx): ViewRegions {
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

export function roadmapView(ctx: WidgetRenderCtx): ViewRegions {
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

export function leaderboardView(ctx: WidgetRenderCtx): ViewRegions {
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

export function accountView(ctx: WidgetRenderCtx): ViewRegions {
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

export function crossAppView(ctx: WidgetRenderCtx): ViewRegions {
  const f = ctx.locale.flows.crossApp;
  const reports = ctx.crossAppReports ?? [];
  const groups = new Map<string, { name: string; slug: string | null; domain: string | null; reports: MushiCrossAppReport[] }>();
  for (const r of reports) {
    const key = r.project_id ?? 'unknown';
    if (!groups.has(key)) groups.set(key, { name: r.app_name ?? f.unknownApp, slug: r.app_slug ?? null, domain: r.app_domain ?? null, reports: [] });
    groups.get(key)!.reports.push(r);
  }
  const html = [...groups.entries()].map(([projectId, g]) => `<section class="mushi-xapp-group"><h3 class="mushi-xapp-app-name">${renderAppIconHtml({ projectId, appName: g.name, appSlug: g.slug, appDomain: g.domain })} ${esc(g.name)}</h3>${g.reports.map((r) => {
    const st = reporterStatus(r, ctx.lang);
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

