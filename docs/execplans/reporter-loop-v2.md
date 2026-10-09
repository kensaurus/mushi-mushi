# Reporter Loop v2 — one widget, a status the reporter understands, a loop that closes

> Status: `PLANNED` (design spec, no code yet). Researched and audited 2026-10-02.
> To be registered as Plan 018 in [PLANS.md](./PLANS.md).
> Scope: `@mushi-mushi/core`, `@mushi-mushi/web`, `@mushi-mushi/react-native`, `packages/server` (api, `_shared`, migrations), `apps/admin`, dogfood host apps.

## Goal

The end user of a vibe-coder's app can file a bug in under 20 s on one screen, see it in "Your reports" with a status they understand, hear back when the developer replies or the fix ships, and answer back. Web and RN present the same structure and vocabulary. The widget looks like part of the host app, not like a neon Mushi product.

Positioning check (the VISION.md / AGENTS.md drift test): telling a reporter "fixed in v1.4, does it work for you?" produces a verification signal. That signal closes the fix loop without the developer leaving the editor — replies and statuses come from the console, Slack or MCP. None of it needs a monitoring stack.

## Success criteria

1. **Fast first report.** A first-time reporter submits in **one screen plus one tap** on web and RN. Measured on the `report:opened → report:sent` funnel in `product_events`; the median must be under 20 s.
2. **One vocabulary.** All 14 `reports.status` values render the same end-user label on web and RN. The mapping lives in one table in core, tested against the DB's `reports_status_check` list.
3. **One real round trip in production.**
   - The admin replies from the console.
   - The reporter sees a badge, then a toast on the next visit, then the reply in the thread.
   - The reporter answers, and the admin sees the answer in the console and in Slack.
   - Admin replies ever sent today: **0**.
4. **Fix and release reach the reporter.**
   - A merged fix shows "Fixed — coming in the next update".
   - A published release that lists the report in `fixed_report_ids` shows "Fixed in vX".
   - The reporter is notified exactly once per channel they opted into.
5. **Unread counts go down when the reporter reads.** Today all 23 `reporter_notifications` rows are unread forever.
6. **"Loading thread…" can never persist.** A slow load shows a skeleton; a failed load shows Retry. Covered by a web unit test and an RN component test.

---

## Part B — what exists today (internal audit, 2026-10-02)

### B1. The widgets

**Report flow**

| Area | Web (`packages/web/src`) | React Native (`packages/react-native/src`) |
|---|---|---|
| Steps | 3 steps: category → intent → details (`widget-render.ts:442`, `:823`, `STEP_NUMBER`; the "01/03" header) | 1 screen: 5 emoji cards, a textarea, a screenshot (`components/MushiBottomSheet.tsx:540-640`) |
| Categories | i18n `step1.categories` plus the host's `categories` | Hard-coded `['bug','slow','visual','confusing','other']` (`MushiBottomSheet.tsx:73`) |
| Minimum description | `minDescriptionLength ?? 20` (`widget.ts:223`, `:1783`) | Hard-coded `>= 20` (`MushiBottomSheet.tsx:352`) |

**Theme and banner**

| Area | Web | React Native |
|---|---|---|
| Theme | `theme` is `auto` / `light` / `dark` / `inherit`. `inherit` resolves light or dark only, never the host accent or font (`widget.ts:1250-1280`). `accent` and `accentText` exist (`build-widget-theme.ts:96-119`). | Light/dark via `useColorScheme`. The accent is hard-coded to `MUSHI_BANNER_NEON.bg #0FFF50` (`MushiBottomSheet.tsx:345-346`). No theme prop. |
| Neon | The banner default is `brand` (`widget.ts:1079`). Neon is opt-in; **the-wanting-mind opts in** (`the-wanting-mind/src/lib/mushi.ts:158`). | The header is **always** neon, with a literal "MUSHI · BETA" (`MushiBottomSheet.tsx:382-383`). |
| Banner | `bannerConfig` (`core/src/types.ts:373-400`) | `MushiBanner.tsx`; hosts draw their own (yen-yen: `MushiFeedbackBand`) |

**Your reports**

| Area | Web | React Native |
|---|---|---|
| Status labels | Three functions with **three vocabularies**: short ("Sent / Review / Fixing / Fixed / Closed"), long ("Submitted / In review / Fix in progress / Fixed — confirm? / Verified / Reopened") and tone (`widget-helpers.ts:151`, `:177`, `:206`). `in_progress` falls through to the raw string. | `reporterStatusShort` returns "Received / In review / Fixing / Fixed / Closed" (`reporter-status.ts:7`). `in_progress`, `verified` and `reopened` fall through to raw strings. Handles `dispatched` / `completed`, which the DB can never contain. |
| Your reports | List, detail, reply, "Yes, fixed / Not fixed", reopen (`widget.ts:2383-2462`, `widget-render.ts:762-797`) | List, thread, reply (`MushiBottomSheet.tsx:150-197`, `:480-530`). **The thread has no loading or error state**; `sendReply` has no try/catch. |
| Unread | The badge is the sum of `unread_count` (`widget.ts:2301`); polls every 60 s while the page is visible (`mushi.ts:567-575`) | Optional `inboxPollIntervalMs` while the inbox tab is open |
| Mark read | **Never.** No SDK calls `listNotifications` or `markNotificationRead` (both exist at `core/src/api-client.ts:441-460`). | Same |

**Accessibility, layout and rendering**

| Area | Web | React Native |
|---|---|---|
| Accessibility | `role=dialog`, `aria-modal`, focus trap (`widget.ts:1453`, `:1336`). Four `prefers-reduced-motion` blocks (`styles.ts:229`, `:303`, `:1771`, `:1840`). | No `accessibilityRole` / `accessibilityState` on category buttons. No `accessibilityViewIsModal`. No reduce-motion handling. |
| Layout bugs | The Reply button sits below a 3-row textarea in a fixed-height body and gets clipped. | Five `flex:1` cards share one row (`MushiBottomSheet.tsx:726-734`), about 65 pt each at 375 pt, so "Confus-ing" wraps mid-word. |
| Rendering | Every `render()` wipes and rebuilds the whole shadow DOM (`widget.ts:1362-1370`). | React state |

### B2. Core API client (reporter surface)

Every reporter call goes through `requestForReporter` (`core/src/api-client.ts:307`). It signs `X-Reporter-Token-Hash`, `X-Reporter-Ts` and `X-Reporter-Hmac`; the HMAC covers `projectId.ts.tokenHash` and is keyed by the API key.

| Method | Route | Server |
|---|---|---|
| `listReporterReports` | `GET /v1/reporter/reports` | `api/routes/public.ts:1111` |
| `listReporterComments` | `GET /v1/reporter/reports/:id/comments` | `public.ts:1156` |
| `replyToReporterReport` | `POST /v1/reporter/reports/:id/reply` (body and/or `feedback_signal`) | `public.ts:1187` |
| `reopenReporterReport` | `POST /v1/reporter/reports/:id/reopen` | `public.ts:1308` |
| `listNotifications` / `markNotificationRead` | `GET /v1/notifications`, `POST /v1/notifications/:id/read` | `public.ts:1380`, `:1543` |
| Feature board | `/v1/reporter/feature-board[/:id/vote]` | `reporter-feature-board.ts:20`, `:54` |
| `getCrossAppReports` | `/v1/tester/cross-app-reports` (JWT), backed by RPC `mushi_get_my_cross_app_reports` | |

The main `request()` (`api-client.ts:156`) has a timeout, retries and circuit-breaker accounting. `requestForReporter` has none of them:

- no timeout or AbortController;
- no try/catch, so a network error rejects instead of returning `{ok:false}`;
- no retry;
- no circuit-breaker accounting.

### B3. Server: status, replies, notifications, releases

**Statuses and status notifications**

- `reports_status_check` allows 14 values: `new, pending, submitted, queued, classified, grouped, fixing, fixed, dismissed, triaged, in_progress, resolved, verified, reopened` (`_shared/report-status.ts:6`).
- `notifyReportStatusTransition` (`_shared/report-status-notify.ts:45`) runs from `fix-merge.ts:154` (merge → `fixed`), `fix-worker/index.ts:1040` and `report-transition.ts:76`.
- It goes through `createNotification` (`_shared/notifications.ts`): a delivery ledger (`notification_deliveries`, UNIQUE on report, type, channel); in-app, Resend email and Web Push branches; per-reporter prefs defaulting to `{in_app:true, email:false, push:false}`. The payload always carries `reportId`.
- The `classified` notification says "classified as bug/high" (`notifications.ts:43-45`). That leaks internal category and severity to end users; 18 have been sent.

**Admin replies to reporters**

- Admin comments are written in three ways, each inserting `report_comments` with `visible_to_reporter=true`:
  - `postReporterReply` (`_shared/reporter-comms.ts:30`, `:67`), used by the console API at `reports.ts:858`;
  - MCP/CLI via `sync.ts:435`;
  - **the admin console directly through supabase-js** (`apps/admin/src/lib/reportComments.ts:98`; `visibleToReporter` defaults to false).
- Reporter comments are written only by `public.ts:1285`. No SQL function inserts into `report_comments` (checked in `pg_proc`).
- Admin → reporter: trigger `report_comments_fanout_to_reporter` (`migrations/20260430000000_two_way_reply.sql:33-86`) inserts an **in-app-only** `reporter_notifications` row directly. It bypasses `createNotification`, so replies never reach email, push or the ledger.
- Reporter → admin: the trigger only stamps `last_reporter_reply_at`. The admin gets no Slack message, plugin event, push or email.

**Release publish** (`api/routes/releases.ts:365-440`)

- Resolves `support_tickets`.
- Stamps `release_credits.notified_at` **without sending anything** — the repo's silent fail-open pattern.
- Never touches `releases.fixed_report_ids`, so "fixed in vX" never reaches a reporter.

**Dead notification channels**

- `reporter_notification_prefs` and `reporter_push_subscriptions` are read by `notifications.ts:74-90, 244-276`, but **no route writes them**; both have 0 rows. Reporter email and push can never fire.
- Admin Web Push (`api/routes/push.ts:161-230`, `user_push_subscriptions`, ADR 0012) is JWT-only.

**Reporter-facing payloads**

- `/v1/reporter/reports` (`public.ts:1123`) **leaks `severity`** and lacks `title`, `user_category`, `app_version`, the screenshot, the page and the group size.
- `/v1/notifications` selects `id, notification_type, payload, read_at, created_at` (`public.ts:1400`). No `report_id` column, but `payload.reportId` is present.

**CORS and history**

- No `Access-Control-Max-Age` (by grep). The custom headers force a preflight, so every 60 s badge poll is an OPTIONS plus a GET. Edge logs: OPTIONS 300–900 ms, GET 400–1200 ms.
- No report status history. The `status_history` table holds inventory nodes; the only reporter-visible event record is `reporter_notifications`.

### B4. Production data (read-only SQL, `dxptnwrhwsqckaftyymj`, 2026-10-02)

| Fact | Value |
|---|---|
| Reports | 22: 21 `classified`, 1 `fixing`; 0 fixed, resolved or verified |
| Reports with `reporter_token_hash` / `end_user_id` | 22 / 4 |
| `report_comments` rows | **0**; `last_admin_reply_at` set on 0 reports |
| `reporter_notifications` | 23 rows: 18 `classified`, 4 `points_awarded`, 1 `confirmed`. All unread, all in-app. |
| `notification_deliveries` | 23 in-app; 0 email; 0 push |
| Notification prefs / reporter push subscriptions | 0 / 0 |
| Releases | 5 published, 1 draft; 0 `release_credits` |
| Grouped reports | 9 have `report_group_id`; all `classified` |
| `end_users` | 608 |
| `feature_request_reporter_votes` | 0 |

### B5. Why "Loading thread…" appeared

Report `08d0ecde…` (the-wanting-mind, SDK 1.28.0, created 02:25:17Z, 0 comments) had its thread fetched once, at 02:28:15Z. OPTIONS took 726 ms and GET 1918 ms, and **both returned 200**. The server did not hang: for about 2.6 s plus a trans-Pacific round trip the screen showed only the spinner, and once the request settled it would show "No developer replies yet."

Three client defects make a slow load look stuck, and would make a real stall last forever:

1. **No timeout or catch.** `requestForReporter` (`api-client.ts:307-348`) has neither. If the fetch stalls — or a host service worker or fetch wrapper never settles — `finally { reporterLoading = false }` (`widget.ts:2416-2418`) never runs.
2. **Errors are never shown in the thread.** `renderReportDetailStep` never renders `reporterError` (`widget-render.ts:762-797`), although the list view does (`:558`). A failure looks identical to "no replies".
3. **One shared loading flag.** One `reporterLoading` covers the list, the thread, replies, votes and reopen (`widget.ts:2307-2459`). Posting a reply blanks the thread back to "Loading thread…" (`widget-render.ts:788`), and there is no cached first paint even though the report summary is already in memory.

React Native has the inverse problem: `openThread` (`MushiBottomSheet.tsx:176-182`) has no loading state, and `listMyComments` returns `[]` on failure, so errors are silent.

### B6. Dogfood apps (versions from `package.json`)

| Repo | Platform | Packages | Mount point | Trigger and banner | Identity |
|---|---|---|---|---|---|
| the-wanting-mind | Vite + React web | web `^1.28.0` | `src/lib/mushi.ts:144-175`; `src/main.tsx:63` | `banner` with **`variant:'neon'`** at top, `bugCta`, `featureCta`, `TWM_CATEGORIES`, `brandFooter:true` | Unsigned `identify()` (`:204`) |
| glot.it (web) | Next + Capacitor | web `^1.27.0`, core `^1.27.2` | `lib/mushi.ts:232-520`; `components/providers.tsx:80` | `subtle` banner at top; `banner` or `edge-tab`; `betaMode`; `screenshotSensitiveHint` | `identifyWithToken`, falling back to unsigned (`:908-954`) |
| glot.it (mobile) | Expo RN | react-native `^0.21.0` | `apps/mobile-v2/src/native/mushi.ts` | | |
| yen-yen | Expo RN | react-native `0.21.0`; core **vendored as `mushi-mushi-core-1.26.0.tgz`** | `apps/mobile/lib/mushi.ts:138`, `:478-512`; `app/_layout.tsx:401`, `:904` | `manual`; the host draws a neon `MushiFeedbackBand` | `identifyWithToken` |
| help-her-take-photo | Expo RN | react-native `^0.21.0`, core `^1.27.2` | `src/components/MushiAppShell.tsx:122-140` | `manual`; console-driven `MushiBannerWidget` | |
| tsumagoi | Vite + React web | web `^1.27.0` | `src/lib/mushi.ts:31-55`; `src/main.tsx:164` (lazy) | `theme:'auto'`, then `sdk.hide()`; the HUD bar is the launcher | none |
| solo-boss-cloud-documentation | React web | web `1.28.0`, core `1.28.0`, react `1.21.0` (all pinned) | `src/lib/mushi.ts:277-430` (deferred to idle) | `hidden`, `bottom-left`, `ja`, `outdatedBanner:'console-only'`, `betaMode` | `identify()`, queued |
| kensaur.us | – | none | – | – | – |

Per-repo notes:

- **the-wanting-mind:** a dark gold book aesthetic, so the neon clash comes from its own config. It also casts the config with `as any`.
- **glot.it (web):** has `scripts/check-mushi-env.mjs`.
- **glot.it (mobile):** two mobile trees, `mobile` and `mobile-v2`.
- **yen-yen:** the vendored core (1.26.0) is out of step with react-native 0.21.0.
- **kensaur.us:** not integrated.

---

## Part A — external practice (2025–2026), condensed

Source strength: **(P)** official docs, fetched; **(S)** third-party or community; **(NF)** from memory, verify before relying on it.

**Steps and type selection**

- **Sentry:** one screen with name, email, description and an optional screenshot. Name and email are prefilled and hidden through `setUser`. No type picker; AI categories and LLM spam filtering run after submit. (P) https://docs.sentry.io/platforms/javascript/user-feedback/configuration/ · https://docs.sentry.io/product/user-feedback/
- **NN/g:** wizards suit complex flows only. (P) https://www.nngroup.com/articles/wizards/

**Reporter loop**

- **Sentry has no reporter loop**; the submitter is never notified. (P) https://docs.sentry.io/product/user-feedback/
- **Intercom tickets** have four system states — Submitted, In progress, Waiting on customer, Resolved — each with its own customer-facing label ("We're looking into it!"). A customer reply moves Waiting back to In progress, and notifications can be set per state. (P) https://www.intercom.com/help/en/articles/9730130-how-ticket-states-work · https://www.intercom.com/help/en/articles/8687982-customize-ticket-states

**Status labels**

- **Canny:** Under Review, Planned, In Progress, Complete, Closed ("we will not work on this"). Voters are emailed on every status change by default. (P) https://help.canny.io/en/articles/673583-post-statuses · https://help.canny.io/en/articles/1291127-status-change-emails
- **Featurebase:** Reviewing, Planned, Active, Completed, Canceled. After a status change the team sends either a default update or a drafted one. (P) https://help.featurebase.app/en/help/articles/6979960-configuring-request-statuses · https://help.featurebase.app/articles/8002760-sending-request-status-updates

**Merging duplicates**

- Canny and Featurebase move votes and comments to the parent post with "no user notifications sent". That is the gap to beat. (P) https://help.canny.io/en/articles/5776649-merging-and-unmerging-posts · https://help.featurebase.app/articles/6974491-merging-duplicate-posts

**Similar reports and resolutions**

- **Apple Feedback Assistant** shows a bucketed "Recent Similar Reports" count ("Less than 10"). Resolutions include "Potential fix identified — for a future OS update", "Investigation complete — works as designed", "… — unable to diagnose with current information" and "… — change required by a third party". (P) https://developer.apple.com/feedback-assistant/ · (S) https://developer.apple.com/forums/thread/709372

**Status notifications**

- **Marker.io** emails reporters on received, resolved, comments and (optionally) status changes; admins toggle it per project. (P) https://help.marker.io/en/articles/6561333-notifications
- **Linear Asks** posts updates into the original Slack thread only on key changes and comments. (P) https://linear.app/docs/linear-asks-slack

**Screenshot privacy**

- **Marker.io** blurs or blocks fields and DOM elements in the browser before capture. (P) https://help.marker.io/en/articles/12383990-data-privacy-security-overview
- **Jam** auto-blurs password and card fields at capture. (S) https://jam.dev/
- **Userback** masks data only on its top plan. (P) https://userback.io/pricing/
- **Sentry** once shipped a crop that never reached the sent image — test what the server actually receives. (S) https://github.com/getsentry/sentry-javascript/issues/11563

**Theming**

- **Sentry** exposes CSS variables (`--foreground`, `--background`, `--accent-foreground`, `--accent-background`, `--success-color`, `--error-color`, `--outline`, `--font-family`, `--font-size`) on a host element with system light/dark. CSS variables win over JS config. It uses Shadow DOM and native `<dialog>`. (P) Sentry configuration URL above.
- **Shadow DOM** passes inherited and custom properties through to the component. (P) https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM

**Accessibility**

- **APG modal dialog:** `aria-modal`, a labelled title, focus moves in, Tab is trapped, Escape closes, focus returns to the opener. (P) https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- **React Native:** `accessibilityViewIsModal` is iOS-only; on Android set `importantForAccessibility="no-hide-descendants"` on the siblings. (P/S) https://reactnative.dev/docs/accessibility · https://github.com/gorhom/react-native-bottom-sheet/issues/687

**Consent and law**

- **Featurebase** subscribes everyone to changelog email by default (opt-out). Avoid this. (P) https://help.featurebase.app/articles/2705284-subscribing-users-to-updates
- **Web push:** ask for permission only after a user action. (P) https://web.dev/articles/push-notifications-overview
- **GDPR:** a non-promotional status email about the user's own report can rest on legitimate interest; marketing needs consent. (S) https://www.termsfeed.com/blog/gdpr-transactional-emails/
- **Japan, 特定電子メール法 (Act on Specified Electronic Mail):** advertising email is opt-in only. A pure status notice is not advertising, but adding promotion brings it under the act. (P) https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/pdf/m_mail_pamphlet.pdf
- **Japan, APPI:** because LLM triage handles personal data, the host is entrusting processing (委託; Art 27(5)(i), supervised under Art 25). The GDPR equivalent is controller → processor with a DPA. (P) https://www.ppc.go.jp/all_faq_index/faq1-q7-53

**Takeaways:** few statuses in plain words; a status change is an editable message; every Closed state carries a reason; "need more info" reopens when the reporter replies; on merge, carry the reporter's subscription to the surviving report; bucket "others reported this" counts; theme through host tokens; redact before capture on every plan; email and push are explicit opt-in; never auto-subscribe anyone to a changelog.

---

## The 10 decisions

1. **One screen to report, on both platforms, free text first.** Optional type chips (four plus "More") above a single textarea, one Attach row, and an always-visible Submit. The chips are optional; `classify-report` assigns the type after submit. The 3-step web flow is retired, and intent becomes optional sub-chips. Minimum length **8** characters by default (host-overridable), or 0 when a screenshot or element is attached.
2. **One structure and vocabulary, in core.** `packages/core/src/reporter-ui.ts` holds the categories, the status table and the timeline kinds. The per-package `reporterStatus*` functions are deleted.
3. **Host-adaptive theming with a neutral default.** Web uses CSS variables on the shadow host, and CSS overrides win over JS config; RN gets a `widget.theme` prop. The default is the host font with a system-color ink accent. Neon is only an opt-in banner variant; RN drops "MUSHI · BETA".
4. **Eight end-user states mapped from all 14 internal statuses** (table in §2.1). "Waiting on you" is driven by a new `awaiting_reporter_at` column. "Fixed" has two variants, with and without a version. Severity and category are never shown to reporters.
5. **`reporter_notifications` is the reporter-visible event log.** Unread means `read_at IS NULL`; new mark-read routes close the loop. No new events table.
6. **The comment trigger stays the guaranteed in-app writer.** The admin console inserts `report_comments` directly (`apps/admin/src/lib/reportComments.ts:98`), bypassing `postReporterReply`, so removing the trigger's insert would silently drop console replies. The trigger keeps writing the in-app row (now with `dedupe_key` = comment id) and calls the existing `edge_function_post` helper to run a new `reporter-notify-fanout` function, which sends email and push through `createNotification`, de-duplicated by the ledger. Every delivery is stamped only after a real send.
7. **Admin review before messages go out.** New setting `reporter_updates_mode: 'auto' | 'review'`, default `auto`. In review mode, pipeline messages wait in a console Outbox (release, edit, discard). Direct replies are never held.
8. **Identity: the device reporter token first, the account second.** 22 of 22 reports carry a token; 4 of 22 have an end-user id. Identified users get a cross-device list through the existing token linking.
9. **Pipeline links.**
   - **Merge** → "Fixed — coming in the next update". Exists; only the copy changes.
   - **Release publish** → every report in `fixed_report_ids` moves to `resolved` with `fixed_in_version` set, and the reporter is asked whether it works now (Yes / Not yet).
   - **Grouped or closed as a duplicate** → the reporter's subscription follows the canonical report, with exactly one notice.
10. **A reporter's reply is an admin signal:** plugin event `report.reporter_replied` (posted as a Slack thread reply), an admin push, a console unread dot via `admin_seen_at`, the MCP timeline, and it clears `awaiting_reporter_at`.

---

## 1. Widget IA and interaction

### 1.1 Report screen (the web panel and the RN sheet share this structure)

```
┌──────────────────────────────────────────┐
│ Send feedback        [Your reports •2]   [×] │  header: host font, no brand strip
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ What went wrong?                                │ │  free text first
│ └──────────────────────────────────────┘ │
│ (Bug) (Slow) (Looks wrong) (Confusing) (Idea) (More…) │  optional chips; wrap; single-select radiogroup
│ 📎 Screenshot attached [view][remove]   ⌖ Point at it │  one attachments row
│ 🔒 Shown only to the app's developer. Remove anything private. │
│                                  [ Send ⌘↵ ]   │  sticky footer
│ Bug reports by Mushi ↗   (only if brandFooter)  │
└──────────────────────────────────────────┘
```

**Chips.** Bug, Slow, Looks wrong, Confusing, Idea, More…; "More…" shows the host's custom categories. "Idea" routes to the feature-request intent (`widget.ts:1975`). On RN the chips use `flexWrap:'wrap'` with a minimum width equal to the label width — never `flex:1` in one row. After a type is picked, an optional intent row may appear (Crash, Wrong result, Unresponsive, Data lost).

**Submit.** Enabled once the text reaches `minDescriptionLength` (8) **or** an attachment exists. While disabled, an inline hint says why ("Add a few words").

**Screenshot.** Captured on open and shown as a thumbnail row; tapping it opens preview and markup, including a Hide/blur tool. **Automatic masking on every plan:** `input[type=password]`, card-number fields (`autocomplete=cc-*`), `[data-private]`, `[data-mushi-mask]` and `capture.maskSelectors` are blurred **before** capture, and a test asserts that the masked image is what reaches the server. The privacy caption stays.

**Success.** The panel turns into a receipt in place: "Sent. We'll let you know here when there's news." It offers Track it (opens the thread) and Done. The 受 stamp animation respects reduced motion. When the host has an `identify({email})`, the receipt also offers an optional "Get updates by email" checkbox — never pre-checked.

### 1.2 Navigation

Three surfaces: **Report** (default), **Your reports**, **Report detail**. No tabs: a header pill opens Your reports and carries the unread dot; detail has a back arrow. Ask and Community move into a header overflow menu, shown only when the host enables them. The banner keeps "Report a bug | Feature idea | My reports", routed to the same surfaces.

### 1.3 Motion, keyboard, accessibility

- **Motion.** Opening is a 180 ms ease-out translate plus fade; switching surfaces cross-fades in 120 ms. Height animates only where `interpolate-size` is supported. Reduced motion: web keeps `prefers-reduced-motion`; RN reads `AccessibilityInfo.isReduceMotionEnabled()` and switches to instant transitions or a fade.
- **Keyboard (web).** Cmd/Ctrl+Enter sends. Escape closes the widget, or goes back from detail. Focus returns to the opener on close (APG). Chips use roving tabindex with the arrow keys.
- **React Native.** The sheet root sets `accessibilityViewIsModal` (iOS only). On Android, verify with TalkBack; if focus escapes, set `importantForAccessibility="no-hide-descendants"` on the sheet's siblings (RN `Modal` is its own window on Android, so this may be unnecessary). Chips: `accessibilityRole="radio"` with `accessibilityState={{selected}}`. Submit: `accessibilityState={{disabled}}` plus a hint giving the reason. The drag handle is `adjustable` with a dismiss action; the title has the `header` role.
- **Announcements.** `aria-live="polite"` announces "Sent", "Reply sent" and errors. Badges carry text ("2 updates"), not just a dot.
- **Web rendering.** Patch only `[data-region="body"]` instead of rebuilding the whole shadow DOM. This fixes lost focus and scroll position and the flicker on each poll.

### 1.4 Theming contract

Every token lives on the shadow host, and the host can override any of them; CSS overrides win over JS config.

```css
--mushi-font: inherit;  --mushi-font-size: 14px;
--mushi-bg: Canvas;  --mushi-fg: CanvasText;
--mushi-muted: color-mix(in oklab, var(--mushi-fg) 60%, transparent);
--mushi-surface: color-mix(in oklab, var(--mushi-bg) 94%, var(--mushi-fg));
--mushi-border: color-mix(in oklab, var(--mushi-fg) 14%, transparent);
--mushi-accent: <resolved>;  --mushi-accent-fg: <auto, contrast ≥ 4.5:1>;
--mushi-success: <token>;  --mushi-error: <token>;
--mushi-radius: 12px;  --mushi-shadow: 0 12px 40px rgb(0 0 0 / .18);
```

**Accent resolution** (first match wins): `widget.accent` → the host's `--mushi-accent` on `:root` → the computed `accent-color` of `<html>` → `<meta name="theme-color">` → `--mushi-fg`. The auto-contrast helper already exists in `build-widget-theme.ts`.

**Banner variants.** `subtle` becomes the default for `trigger:'banner'`; `brand` and `neon` stay available. The panel never uses the banner's color.

**React Native.** New prop `widget.theme?: Partial<MushiRNTheme>` covering bg, fg, muted, surface, border, accent, accentFg, success, error, fontFamily and radius. `MUSHI_BANNER_NEON` is used only by `MushiBanner variant="neon"`.

**Brand footer.** Stays opt-in (`widget-render.ts:229-233`), restyled to `--mushi-muted` at 11 px, so it keeps working as the growth loop without fighting the host's design.

---

## 2. "Your reports"

### 2.1 End-user status mapping (core `reporterStatus(report)`)

Rows are evaluated in order: overlays are checked before base statuses.

**Overlays (checked first)**

| Internal | Condition | Label | Tone | Detail line |
|---|---|---|---|---|
| any open status | `awaiting_reporter_at IS NOT NULL` | **Waiting on you** | attention | "The developer asked a question — reply below." |
| any open status | `report_group_id IS NOT NULL` and not canonical | as base status | as base | Adds a bucketed count: "You and a few others reported this" (2–9) or "Many people reported this" (10+). Never a raw number, never other users' content. |

**Base statuses**

| Internal | Label | Tone | Detail line |
|---|---|---|---|
| `new`, `pending`, `submitted`, `queued` | **Received** | neutral | "We got it." |
| `classified`, `triaged`, `grouped` | **Looking into it** | info | "The developer has it on their list." |
| `reopened` | **Looking into it again** | info | "Thanks — we reopened it." |
| `fixing`, `in_progress` | **Fix in progress** | progress | "A fix is being worked on." |
| `verified` | **Confirmed fixed** | success-muted | "You confirmed the fix. Thank you!" |

**Fixed and closed**

| Internal | Condition | Label | Tone | Detail line |
|---|---|---|---|---|
| `fixed` | `fixed_in_version` null | **Fixed — coming in the next update** | success | "It ships in the next release." |
| `fixed`, `resolved` | `fixed_in_version` set | **Fixed in v{X}** | success | "Update to v{X}. Does it work for you now?" with Yes / Not yet |
| `resolved` | `fixed_in_version` null | **Fixed** | success | "Does it work for you now?" with Yes / Not yet |
| `dismissed` | `closed_reason` | **Closed** | muted | The reason copy below |

#### `closed_reason` copy

| `closed_reason` | What the reporter sees |
|---|---|
| `duplicate` | "Same as an earlier report — we'll update you there." The thread links to the canonical report's status, and the reporter's updates follow it. |
| `needs_info` | Not closed — use `awaiting_reporter_at`. Listed only to forbid closing for missing info. |
| `not_reproducible` | "We couldn't reproduce it. Reply if it happens again." Replying reopens the report. |
| `wont_fix` | "We decided not to change this." plus the admin's note |
| `working_as_intended` | "This is expected behaviour." plus the note |
| `spam` | Hidden from the reporter; no notification is sent. |
| null | "Closed." |

#### Feature-request labels

| Bug label | Feature-request label |
|---|---|
| Received | Thanks for the idea |
| Looking into it | Under consideration |
| Fix in progress | Being built |
| Fixed* | Shipped (in vX) |

**Test.** Every value in `CANONICAL_REPORT_STATUSES` must map to a non-raw label. A `default` branch that returns the raw status is forbidden.

### 2.2 List

**Rows.** Each row is a tap target at least 56 px tall, with three lines:

1. Status pill, title, relative time.
2. Type chip, page path, and the bucketed "others" note when the report is grouped.
3. Only when there is news: "Developer replied: '…'", "Fixed in v1.4" or "Waiting on you" — bold while unread.

**Order and empty state.** Unread first, then `last_event_at` descending. Empty state: "Nothing yet — your reports will show up here with updates."

**API changes to `/v1/reporter/reports`.** Adds `title`, `user_category`, `page`, `app_version`, `screenshot_thumb_url` (signed, 10 min), `group_bucket` (`none` / `few` / `many`), `closed_reason`, `fixed_in_version`, `awaiting_reporter`, `last_event_at`, `last_event_preview`, `unread_count`. Removes `severity` and `category`.

### 2.3 Detail: thread and timeline

**Header card.** Status pill and detail line; the reporter's own text; screenshot thumbnail; page · device/OS · app version · date.

**Timeline.** One chronological list merging `reporter_notifications` rows for the report with `status='sent'` and the visible `report_comments`, plus the reporter's own. Pipeline events **render from the core template for their type, never from the stored `payload.message`** — otherwise the 18 existing `classified` rows would keep saying "classified as bug/high".

| Kind | Source | Copy |
|---|---|---|
| `received` | `reports.created_at` | "You reported this" |
| `reviewing` | notification `classified` | "The developer is looking into it" |
| `duplicate_linked` | notification `duplicate_linked` (new) | "Same as an existing report — we'll update you there" |
| `info_requested` | notification `info_requested` (new) | "The developer asked: …" (the admin's question, verbatim) |
| `comment` | admin comment | The developer's message, verbatim |
| `reporter_comment` | reporter comment | A bubble labelled "You" |
| `fix_started` | notification `fix_started` (new) | "A fix is in progress" |
| `fixed` | notification `fixed` | "Fixed — coming in the next update" |
| `released` | notification `released` (new) | "Shipped in v{X} — update to get it" |
| `verified` / `reopened` | existing notifications | "You confirmed it's fixed" / "Reopened" |
| `closed` | notification `dismissed` + `closed_reason` | The reason copy |

**Composer.** A sticky footer with a textarea growing from 1 to 4 lines and the send icon to the right of the field, so the Reply control can no longer be clipped. When the status is Fixed*, Yes / Not yet appear above it, reusing the existing `confirms` and `not_fixed` signals.

**Loading rules (fixes B5).**

- **First paint:** the header renders instantly from the list item; the timeline shows a 3-line skeleton.
- **Requests:** every reporter request times out after 8 s, retries once on a network error or 5xx, and always resolves to `{ok:false}` on failure — never throws.
- **Failure:** "Couldn't load updates · Retry", plus the cached thread if one exists.
- **Separate flags:** `listLoading`, `threadLoading`, `sending`.
- **Optimistic replies:** "Sending…", then "Sent" or "Failed · Retry". The thread never blanks.
- **Mark read:** opening the thread calls the new `POST /v1/reporter/reports/:id/read`, so badges decrement.

### 2.4 "Others reported this" and votes

- **Bugs:** a bucketed, display-only count from `report_groups.report_count`. No voting on bugs.
- **Ideas:** reuse `feature_request_reporter_votes` and the feature board. After an Idea is submitted, show similar ideas with a "+1 instead" option.

---

## 3. Two-way communication

### Admin → reporter

**Today.** Three writers — the console's direct insert, the `postReporterReply` API, and MCP/CLI — feed the trigger, which writes an in-app notification row only.

**v2.**

- **In-app row:** the trigger stays the guaranteed writer and adds `dedupe_key` = comment id.
- **Email and push:** the trigger also calls `edge_function_post('reporter-notify-fanout', {comment_id})`. The fan-out sends email and push per the reporter's prefs through `createNotification`; the ledger de-duplicates. If the fan-out fails, the in-app row still exists; the failure is logged and retried through the ledger's retry arm.
- **Ask for more info:** a console action posts the question as a visible comment, sets `awaiting_reporter_at`, and sends `info_requested`.
- **Slack:** a "Reply to reporter" button and a `/mushi reply` command under the report's Slack message (`reports.slack_message_ts`), both through `postReporterReply` (a new `slack-interactions` action).

### Reporter → admin

**Today.** The reply only stamps `last_reporter_reply_at`.

**v2.** The `public.ts:1285` route (the only reporter writer) also:

- fires `dispatchPluginEvent('report.reporter_replied')` → a Slack thread reply, plus Discord and Teams;
- sends admin Web Push to project members (`user_push_subscriptions`);
- clears `awaiting_reporter_at`, and moves a `not_reproducible` report back to `reopened`;
- lights the console unread dot (`last_reporter_reply_at > reports.admin_seen_at`).

MCP `get_report_timeline` shows the reply, and `triage_next_steps` reports "N reporters waiting for an answer".

### Unread state

| Side | Today | v2 |
|---|---|---|
| Reporter | Never decreases | `POST /v1/reporter/reports/:id/read` and `POST /v1/reporter/notifications/read-all` |
| Admin | None | `reports.admin_seen_at`, set when the report is opened in the console or the admin replies |

### Limits

| Limit | Today | v2 |
|---|---|---|
| Reporter replies | None | 10 per hour per token per project (`scoped_rate_limits`); body capped at 2,000 characters (the DB allows 10k) |

### Copy rule

The reporter never sees a PR URL or branch name, severity or category, the agent, or LLM text. Developer replies appear verbatim; pipeline messages use the §2.3 templates, editable per project (§5).

---

## 4. Notifications

### 4.1 Channels

**In-widget (badge, bold list row, toast).** Every reporter token. No consent needed — in-purpose and in-app. Uses the existing `reporter_notifications`, plus the new mark-read routes and the toast.

**Email.**

- **Audience:** reporters who tick "Get updates by email" on the receipt or the detail view. Hosts that pass `identify({email})` can prefill the address, which also needs `notifications.emailFromIdentity:true`; even then the box is never pre-ticked.
- **Consent:** an explicit checkbox, then double opt-in before the first send. Every mail carries `List-Unsubscribe` and `List-Unsubscribe-Post`. Status updates only, nothing promotional — transactional under GDPR and outside 特定電子メール法. Never auto-subscribe a reporter to a changelog.
- **Implementation:** a write route for `reporter_notification_prefs`; `_shared/email.ts`, which needs `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set in production.

**Web Push.**

- **Audience:** web reporters, only when the host opts in with `notifications.webPush:{serviceWorkerPath}`; the service worker must live on the host's origin.
- **Consent:** the browser permission prompt appears only after the user taps "Notify me".
- **Implementation:** a write route for `reporter_push_subscriptions`; `_shared/web-push.ts` with the ADR 0012 endpoint allowlist; the existing `/v1/push/vapid-public-key`.

**RN native push.** Not in v2. RN reporters get the in-app badge plus a toast when the app comes to the foreground.

### 4.2 Toast on next visit

On init, at first idle, the SDK calls `GET /v1/reporter/updates?since=` once. If anything is unread it shows one toast near the trigger or banner — "The developer replied to your report", "Your bug is fixed in v1.4" — with a [View] action.

- **Limits:** at most one toast per session and one per 24 hours; further updates collapse into "3 updates on your reports".
- **Suppression:** respects `hideOnRoutes`, `hideOnSelector` and `smartHide`; hosts can turn it off with `notifications.toast:false`.
- **React Native:** `MushiProvider` shows the toast when `AppState` becomes active.

### 4.3 Frequency caps (server-side, in `createNotification`)

- **Email:** at most 1 per report per 24 hours (`released`, `comment_reply` and `info_requested` are batched instead), and at most 3 per reporter per day; anything over becomes a daily digest sent by the existing cron pattern.
- **Push:** at most 2 per reporter per day, only for `comment_reply`, `info_requested`, `released` and `fixed`.
- **Never by email or push:** `reviewing`, `fix_started`, `duplicate_linked`.
- **Idempotency:** `notification_deliveries`, keyed by `dedupe_key`.

### 4.4 Polling and cost

- **Poll:** `GET /v1/reporter/updates?since=` every **5 minutes**, only while the page is visible and the reporter has at least one open report, plus once on `visibilitychange`. Replaces the current 60-second list poll.
- **Never poll from a device with no reports:** a local flag is set on the first successful submit.
- **CORS:** add `Access-Control-Max-Age: 86400`.

---

## 5. Pipeline links

| Event | Today | v2 status write | Reporter message | Admin review |
|---|---|---|---|---|
| Report classified | `classified` notification, which leaks severity | none | `reviewing`, in-app only, from the template | no |
| Grouped, or closed as duplicate | nothing | the reporter's updates follow the canonical report (§6.1, migration 1) | one `duplicate_linked` notice | no |
| Admin asks for more info | nothing | `awaiting_reporter_at = now()` | `info_requested` | no (the admin wrote it) |
| Fix dispatched (`fix-worker`) | nothing reaches the reporter | `fixing` (exists) | `fix_started`, in-app only | yes |
| PR merged (`finalizeFixMerge`, `fix-merge.ts:140-160`) | `fixed` notification (works) | `fixed`, `fixed_at` | `fixed` | yes |
| Release published (`releases.ts:365`) | stamps release credits, sends nothing (fail-open) | per report in `fixed_report_ids`: set `resolved`, `fixed_in_version`, `fixed_release_id` through `report-transition.ts` so the transition notifies; stamp `release_credits.notified_at` only after a delivered ledger row exists; return per-report delivery counts | `released`: "Shipped in v{X} — does it work for you now?" | yes |
| Release drafted (`release-builder`) | — | auto-fill `fixed_report_ids` from reports with `fixed_at` after the last published release; the admin can untick any | none | n/a |
| Reporter answers Yes / Not yet | existing `mushi_apply_reporter_feedback` | `verified` / `reopened` (exists) | same | no |
| Report dismissed | "reviewed and closed" | `dismissed` plus a `closed_reason` chosen in the console close dialog | `closed`, with the reason copy | yes |

### What the admin sees

**Console**

- **"Reporter view" panel** in report detail: a live preview of the status pill, the timeline and any pending messages.
- **`reporter_updates_mode`:** `auto` (default) or `review`. In `review`, messages are created `held` and wait in an Outbox, where the admin can release, edit or discard each one.
- **Template overrides** in `project_settings.reporter_templates`: secret-scanned (reusing `SECRET_DETECTED`), at most 280 characters each, interpolating only `{version}`, `{app}` and `{n}`.
- **"Ask for more info"** next to Reply.

**MCP**

- `transition_status` gains `closed_reason` and `reporter_message`.
- New `request_reporter_info` (mcp:write), `release_reporter_update` (mcp:write), `list_reporter_outbox` (mcp:read).
- `reply_to_reporter` is unchanged and still needs user confirmation.

---

## 6. Data and API changes

### 6.1 Migrations

Each goes in `packages/server/supabase/migrations/`, named `YYYYMMDDHHMMSS_snake.sql`, with a matching `down/` file.

1. **`20261002120000_reporter_loop_v2_report_columns.sql`**
   - `reports` gains `closed_reason text` (CHECK: `duplicate, not_reproducible, wont_fix, working_as_intended, spam`), `fixed_in_version text`, `fixed_release_id uuid references releases(id) on delete set null`, `admin_seen_at timestamptz`, `awaiting_reporter_at timestamptz`.
   - Index on `(project_id, reporter_token_hash, created_at desc)` if missing.
   - Duplicate subscriptions: `reporter_report_follows (report_id uuid, reporter_token_hash text, project_id uuid, created_at timestamptz, primary key (report_id, reporter_token_hash))`. When a report is grouped or closed as `duplicate`, insert a row for the canonical report. The reporter list and timeline include followed reports, and notifications on the canonical report fan out to its followers. RLS: service role only.
2. **`20261002120100_reporter_notifications_v2.sql`**
   - `reporter_notifications` gains `status text not null default 'sent'` (CHECK: `held, sent, discarded`), `body_override text`, `released_by uuid`, `released_at timestamptz`, `dedupe_key text`.
   - A CHECK on `notification_type` listing every type, including the new `reviewing, duplicate_linked, info_requested, fix_started, released, closed`.
   - `create unique index … on reporter_notifications (report_id, notification_type, dedupe_key) where dedupe_key is not null`.
   - `notification_deliveries` gains `dedupe_key text`; replace its UNIQUE constraint with `create unique index … on notification_deliveries (report_id, notification_type, channel, coalesce(dedupe_key, ''))` (Postgres does not allow expressions in a UNIQUE constraint).
   - Existing rows default to `sent`. Do not mark them read — that is the owner's call.
3. **`20261002120200_reporter_comments_fanout_v2.sql`**
   - Replace `report_comments_fanout_to_reporter()`: keep stamping `last_*_reply_at`, and **keep inserting the in-app row**, now with `dedupe_key = NEW.id::text`.
   - For admin comments visible to the reporter, also call `edge_function_post('reporter-notify-fanout', jsonb_build_object('comment_id', NEW.id))`.
   - For reporter comments, also clear `awaiting_reporter_at`.
   - Run the changed trigger once against a test row and read `postgres_logs` (the PL/pgSQL hot-helper lesson).
4. **`20261002120300_reporter_prefs_push_settings.sql`**
   - `reporter_notification_prefs` gains `email_verified_at`, `email_verify_token_hash`, `unsubscribed_at`, `end_user_id`.
   - `project_settings` gains `reporter_updates_mode text not null default 'auto'` (CHECK: `auto`, `review`), `reporter_templates jsonb not null default '{}'`, `reporter_email_enabled bool default false`, `reporter_push_enabled bool default false`.
   - Reporter tables stay service-role only.

**Apply and verify:** apply each via `apply_migration`, then check `information_schema` and `pg_constraint`.

### 6.2 Routes

Reporter routes use `apiKeyAuth` plus `resolveReporterAuth`.

| Route | Change | Purpose |
|---|---|---|
| `GET /v1/reporter/reports` | changed | Adds the §2.2 fields and the reports the reporter follows; drops `severity` and `category`; adds `?status=open\|all` |
| `GET /v1/reporter/reports/:id` | new | Header, the merged timeline (rendered from templates), `can_verify` |
| `GET /v1/reporter/reports/:id/comments` | kept | Back-compat for SDKs up to 1.28 |
| `POST /v1/reporter/reports/:id/read` | new | Marks that report's notifications read; returns the new unread total |
| `POST /v1/reporter/notifications/read-all` | new | |
| `GET /v1/reporter/updates?since=` | new | `{unread_total, latest:[{report_id, kind, preview, at}]}`, at most 3 in `latest` |
| `GET/PUT /v1/reporter/notification-prefs` | new | `{email?, channels}`; a PUT with an email sends the verification mail; GET returns the email masked |
| `GET /v1/reporter/email/verify?t=`, `GET\|POST /v1/reporter/email/unsubscribe?t=` | new, public | Double opt-in and one-click unsubscribe (RFC 8058) |
| `POST/DELETE /v1/reporter/push-subscriptions` | new | Enforces the ADR 0012 endpoint allowlist |
| `POST /v1/reporter/reports/:id/reply` | changed | Adds the rate limit, the 2k body cap, the plugin event and admin push; clears `awaiting_reporter_at` |
| `POST /v1/admin/reports/:id/request-info` | new (`adminOrApiKey`, mcp:write) | Posts the question as a visible comment, sets `awaiting_reporter_at`, sends `info_requested` |
| `POST /v1/admin/releases/:id/publish` | changed | Resolves `fixed_report_ids`; stamps only after delivery |
| `GET /v1/admin/reports/:id/reporter-view` | new (jwtAuth) | Reporter-view preview and outbox |
| `GET /v1/admin/reporter-outbox`, `POST …/:id/release\|discard`, `PATCH …/:id` | new | Review-mode outbox |
| `GET /v1/sdk/config` | changed | Adds `reporter:{emailEnabled, pushEnabled, toast}` |
| `reporter-notify-fanout` edge function | new | Email and push for comment replies (`requireServiceRoleAuth`) |
| CORS | changed | Sends `Access-Control-Max-Age: 86400` |

### 6.3 Core and SDK surface

- **New module `core/src/reporter-ui.ts`:** the categories; `reporterStatus(report) → {label, tone, detail, canVerify}`; the timeline kinds; i18n copy keys (en, ja, es, th).
- **`requestForReporter` parity with `request()` (`api-client.ts:156`):** an 8 s AbortController timeout; a catch returning `{ok:false, code:'NETWORK_ERROR'|'TIMEOUT'}`; one retry; circuit-breaker accounting; methods for the new routes.
- **`MushiInstance` additions:** `getReporterUpdates()`, `markReportRead(id)`, `setNotificationPrefs()`, `subscribeReporterPush()`, `onReporterUpdate(cb)` (so hosts can draw their own badge — yen-yen's band, tsumagoi's HUD).
- **Config:** `notifications?: { toast?, email?, emailFromIdentity?, webPush?: false | { serviceWorkerPath } }`; `capture.maskSelectors`; `minDescriptionLength` defaults to 8; RN gains `widget.theme`.
- **Legal docs:** a 委託 / DPA template for host apps at `docs/operators/reporter-data-processing.md`. The host app is the controller (entrusting party); Mushi is the processor (entrustee).

---

## 7. Rollout

### Phase 0 — correctness hotfix (patch release)

- [ ] **Reporter requests:** `requestForReporter` gains a timeout, a catch and a retry.
- [ ] **Web thread:** render the error with Retry; split the loading flags; send replies optimistically.
- [ ] **RN thread:** loading and error states.
- [ ] **Mark read on thread open:** use the existing `/v1/notifications/:id/read`, matching on `payload.reportId` (present in both the trigger and the `createNotification` payloads), or add `report_id` to the select at `public.ts:1400`.
- [ ] **Server:** `Access-Control-Max-Age`; drop `severity` from the reporter list; neutral copy for `classified`; render templates by notification type.
- [ ] **Status table:** the core table used by both SDKs, with a test covering all 14 statuses.
- [ ] **Live round trip** on one dogfood report, with SQL and a screenshot as evidence. This messages a real user, so the owner approves it first.

### Phase 1 — widget parity

One-screen report, free text first; the theming contract with a neutral default, plus the RN theme prop; wrapping chips; automatic masking, with a test that the masked image is what the server receives; the accessibility items; incremental web rendering; list, detail and timeline views.

React Native parity built 2026-10-02 (`feat/reporter-loop-phase2-3`): one-screen report, v2 timeline, Reduce Motion, receipt with email opt-in, next-visit toast. The RN bundle budget moved from 22 kB to 23.5 kB brotli for it (measured 22.95 kB; see `packages/react-native/.size-limit.cjs`); the shared widget rules live in `@mushi-mushi/core/reporter-ui`.

### Phase 2 — loop wiring

Migrations 1–4; the fan-out function; release linkage; duplicate follows; "Ask for more info" / Waiting on you; the `reporter_replied` plugin event; admin unread state; `/updates` plus the toast; the outbox; the console Reporter view; the MCP additions.

### Phase 3 — opt-in channels

Email opt-in, verification and unsubscribe (needs `RESEND_*` in production); web push for hosts that opt in; frequency caps and the digest; the DPA / 委託 template.

Built 2026-10-02 (branch `feat/reporter-loop-phase2-3`): migrations `20261002160000` (additive) and `20261002160100` (digest cron, value switch); `_shared/reporter-email.ts`, `reporter-optin.ts`, `reporter-digest.ts`, `reporter-settings.ts`; routes in `api/routes/reporter-prefs.ts` and `reporter-admin.ts`; console card `ReporterChannelsCard`; SDK calls in `@mushi-mushi/core/reporter-channels`. Email links open the console's public `/email/reporter` page (Supabase serves Edge Function HTML as `text/plain` with a sandbox CSP, so the API can not render a clickable page); `List-Unsubscribe` still points at the API for the RFC 8058 one-click POST. Without `RESEND_API_KEY` + `RESEND_FROM_EMAIL` email reports `not_configured` (console, `/v1/sdk/config`, ledger `skipped not_configured`). The built-in widget opt-in UI (receipt checkbox, "Notify me") is not shipped: the web bundle has ~10 B of its 89.5 kB budget left, so hosts render opt-in through the instance methods.

### Release batching

One Changesets release:

| Package | Bump |
|---|---|
| `@mushi-mushi/core`, `@mushi-mushi/web` | Minor: 1.30.0 if 1.29.0 ships first, otherwise 1.29.0 |
| `@mushi-mushi/react-native` | 0.22.0 |
| `@mushi-mushi/react` | Patch |

Order:

1. The server batch: migrations, then the `api` and fan-out functions. All changes are additive, and `/comments` stays.
2. The npm release.
3. **One bump PR per dogfood repo, folded into that repo's next release batch** (ci-cost rule 7).

### Dogfood bumps

| Repo | Bump | Config changes in the same PR |
|---|---|---|
| the-wanting-mind | web → new minor | `variant:'neon'` → `'subtle'`; `accent` (or `--mushi-accent`) = the book gold; drop the `as any` cast; keep `brandFooter` |
| glot.it (web) | web, core → new minor | optionally `notifications.toast`; update the "lime banner" copy in `check-mushi-env.mjs` |
| glot.it (mobile, mobile-v2) | react-native → 0.22.0 | pass `widget.theme`; confirm which mobile tree ships |
| yen-yen | react-native → 0.22.0; **replace the vendored core 1.26.0 tgz** with the npm core | `widget.theme`; drive the `MushiFeedbackBand` badge from `onReporterUpdate` |
| help-her-take-photo | react-native → 0.22.0, core → new minor | `widget.theme` |
| tsumagoi | web → new minor | HUD unread count via `onReporterUpdate`; `trigger:'hidden'` instead of `sdk.hide()` |
| solo-boss-cloud-documentation | web, core → new minor (pinned); react → new patch | none |
| kensaur.us | not integrated | – |

---

## 8. Non-goals and risks

**Non-goals:** RN native push (needs APNs/FCM per host app plus Expo tokens); a public roadmap portal; reporter-to-reporter comments; upvotes on bugs; raw duplicate counts; SMS; changelog subscriptions; changes to the Ask tab.

| Risk | Mitigation |
|---|---|
| PII in screenshots | Automatic masking on every plan (password, card, `[data-private]`) plus host selectors, applied before capture; a test that the masked image is what the server receives; the caption stays and the reporter can remove the image; thumbnails are signed, short-lived and served only to the same token. |
| PII in email | Stored only after opt-in, masked in GET responses, hashed in logs; unsubscribe on every mail; covered by the existing erasure path; the host is the controller, so the opt-in copy names the host app; the DPA / 委託 template documents the processor role. |
| Spam and abuse | Rate limit and cap on reporter replies; `reporter_devices` and anti-gaming flags suppress notifications; `closed_reason='spam'` hides the report silently. |
| Internals leaking | Fixed templates rendered by type; no severity, category, PR or agent in reporter copy; bucketed duplicate counts; the review outbox for cautious operators. |
| Notification fatigue | The §4.3 caps; low-value events stay in-app only; at most one toast per session and one per day. |
| Cost | Poll every 5 minutes plus on visibility, never when the device has no reports; preflights cached for 24 hours; email and push opt-in only; Resend's free tier covers current volume (22 reports in total). |
| Silent fail-open (shipped 4× in this repo) | The trigger stays the guaranteed in-app writer, covering the console's direct inserts; stamps only after delivery; every guard is tested on its failure path; release publish returns delivery counts. |
| Old SDKs | All changes are additive; `/comments` stays; in-app rows still come from the trigger. |
| Theme regressions in host apps | Each dogfood bump PR includes light and dark screenshots of the report and detail screens; system-color defaults are safe on any background. |

---

## 9. Verification

- **Phase 0:** `pnpm --filter @mushi-mushi/core test`, `pnpm --filter @mushi-mushi/web test` and the RN tests; a web test where `fetch` never resolves shows Retry after 8 s; a test covering all 14 statuses; SQL showing `read_at` is set after a thread is opened; the live round trip.
- **Phase 1:** headed Playwright on the-wanting-mind and glot.it in light and dark mode; RN emulator screenshots from yen-yen; axe on the panel; VoiceOver and TalkBack passes, including the Android modal-focus check; the masked-image test.
- **Phase 2:** migrations verified; a test release resolves a dogfood report (`fixed_in_version` set, a `released` notification plus a ledger row); an admin reply inserted from the console produces both the in-app row and the fan-out ledger rows; a reporter reply produces a Slack thread message and clears `awaiting_reporter_at`; a duplicate close moves the reporter's follow to the canonical report and sends one notice; `get_advisors` is clean.
- **Phase 3:** email, unsubscribe and the digest against a test inbox; a push subscription receives a push; a test that sends 5 events in one day confirms the caps hold.
