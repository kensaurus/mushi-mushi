# Console UX journeys and IA: 2026-10-16

**Trigger.** Complaints rising. On 2026-10-16 the owner reported three things:
- most pages load slowly;
- the Plan/Do/Check/Act strip at the top is "useless — I don't know what I'm supposed to do";
- open Sentry issues across five apps should be fixable "via the mushi console like a normal vibe coder".

Later the same day they added that the SDK widget launcher covers too much of host apps.

**Method.** Each story was walked in the owner's signed-in Chrome on prod (kensaur.us/mushi-mushi/admin), at desktop width. The persona is the primary buyer from VISION.md: a solo vibe coder with several AI-built apps.

**Evidence.** Measurements came from the browser Performance API, Supabase edge logs and Sentry. Console funnel events exist for opening a report, copying the fix prompt and dispatching, but none were read for this audit. Findings are tagged `[observed]` (seen in a walkthrough or measured) or `[judgment]`.

**What works.**
- The report detail page puts a diagnosis, a paste-ready fix prompt and Dispatch fix on one screen.
- Dispatch asks once and then runs.
- Close reasons tell you exactly what the reporter will see.

## Stories and results

| # | Story (done when …) | Before | After (shipped in #490 and the follow-ups batch) | Evidence |
|---|---|---|---|---|
| 1 | Open the console and know the one thing to do next (a sentence and a button) | COMPLETED-WITH-FRICTION. Advanced mode showed four stage cards, a "Two strips, two jobs" explainer and a three-tile hero, with no single next step. | COMPLETED. One "do this next" line in every mode. | [observed] |
| 2 | See the truth about open work on To-do (critical and high Sentry bugs counted) | BLOCKED. glot.it said "All clear" over 3 critical and 16 high open reports. The Plan flag counted only critical reports still at `new`. | COMPLETED. The Plan flag stays open while any critical or high report is unfixed. | [observed] |
| 3 | A page you visited before shows its data straight away | COMPLETED-WITH-FRICTION. Every visit opened on a skeleton. Cold /inbox fired 16 requests, the last landing at 15.4 s. | COMPLETED. A revisit paints its last data in under 150 ms. Cold load: 11 requests at 1–2 s each. | [observed], measured |
| 4 | Dispatch a fix for a Sentry bug and get a PR | COMPLETED-WITH-FRICTION. 2 of 8 dispatches opened PRs. 6 stopped at the review gate ("comments only"), shown as raw text in small print beside "Failed — retry", and a retry stops the same way. | COMPLETED-WITH-FRICTION. The failure now reads "Mushi found no code change to make from this report", says why, and offers the fix prompt or closing instead of a pointless retry. | [observed] |
| 5 | Close a Sentry alert that is not a code bug | COMPLETED-WITH-FRICTION. Closing was hidden in the Status select: Status → Dismissed → reason → Close, 4 interactions. "Couldn't reproduce" left the Sentry issue open, which needed a trip to Sentry. | COMPLETED. "Not a code bug" opens the picker preset to "Works as intended" (2 clicks). For Sentry-linked reports, the picker says whether the issue is archived there. | [observed] |
| 6 | The page name matches the sidebar | COMPLETED-WITH-FRICTION. Sidebar "To-do", tab "Action inbox", hotkey "Action Inbox". | COMPLETED. "To-do" everywhere. | [observed] |
| 7 | A host app's users can still see and tap the app with the widget installed | COMPLETED-WITH-FRICTION. A tall edge card covered content above glot.it's bottom tab bar. | In progress on feat/widget-launcher-2026-10-16 | [observed] (owner screenshot) |

## IA checks

| Check | Verdict | Evidence |
|---|---|---|
| IA1 click depth | Pass | Story 4: Bugs → report → Dispatch fix → confirm takes 3 clicks from the sidebar. |
| IA3 dead ends | Fail → fixed | A refused dispatch offered only a retry that would fail again. Now it points at the fix prompt or closing. |
| IA4 label consistency | Fail → fixed | To-do / Action inbox / Action Inbox (story 6). |
| IA6 first-click logic | Fail → fixed | The first thing on the page was four stage cards with no action. It is now one sentence with a button. |
| IA7 wayfinding | Pass | Sidebar steps 1 to 5, the current item highlighted, project switcher in the header. |
| IA9 URLs | Pass | `?project=` deep links resolve the team and project (tenant gate). |

## Findings not closed here

| # | Finding | Severity | Evidence | Next |
|---|---|---|---|---|
| F1 | Web-vital and native-crash Sentry reports carry no stack trace, so the cloud fix agent can only refuse them. These were 6 of 8 dispatches today. The console offers Dispatch as if it could work. | Medium | [observed] | Hide or soften Dispatch fix when a report has no stack or code location, and lead with "Copy fix prompt" (to be decided; BACKLOG). |
| F2 | The per-request floor is about 0.85 s on every API route. The `api` function boots a fresh isolate for almost every request (4,338 boots for 3,656 requests in 24 h). | Medium | measured | Split the api router into a light admin-read function. This needs an ADR (BACKLOG). |
| F3 | The console already sends `report_opened`, `fix_context_pulled`, `fix_dispatched` and `diagnosis_viewed`. Two steps had no event: clicking the "do this next" line, and closing a report. | Low | [observed] | Done in this batch: `next_step_clicked` {tone, to} and `report_closed` {reason, sentry_linked}. Both are ad hoc events (lib/track.ts), so the next audit can count them. |
| F4 | First-run onboarding was not walked: only the owner's established account was available. | n/a | — | Walk it with a fresh test account. |
