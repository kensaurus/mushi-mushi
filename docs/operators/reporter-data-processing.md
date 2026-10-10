# Reporter data processing — DPA / 委託 template for host apps

> **Template, not legal advice.** Adapt it with your own counsel. It covers the
> reporter loop of Plan 018 ([`docs/execplans/reporter-loop-v2.md`](../execplans/reporter-loop-v2.md)):
> bug reports from your app's end users, the replies and status updates they
> get back, and (once enabled) email or Web Push about their own reports.

## 1. Who is who

| Role | GDPR | Japan APPI | Who |
|---|---|---|---|
| Decides why and how reporter data is used | Controller | 委託元 (entrusting party) | **You, the host app** |
| Processes it on your instructions | Processor (Art. 28) | 委託先 (entrustee) | **Mushi** |
| Mushi's own vendors | Sub-processors | 再委託先 | Listed in the [privacy policy, section 5](../../apps/docs/content/legal/privacy.mdx) |

Under APPI, handing reporter data to Mushi for triage is a provision of personal
data *accompanying entrustment* (Art. 27(5)(i)), so it needs no separate
consent from the reporter, but you must supervise Mushi as your entrustee
(Art. 25). The clauses in §4 are written to make that supervision concrete. The
GDPR equivalent is an Art. 28 data processing agreement.

## 2. What the reporter loop processes

| Data | Source | Why | Retention / deletion |
|---|---|---|---|
| Reporter key (`rk1_…`, a one-way hash of the device token) | Widget | Ties "Your reports" to the device without an account | With the report; erased by `DELETE /v1/sdk/me` |
| Report text, chosen type, page path, app version, device/OS | Reporter | Triage and the reporter's own thread | Project retention policy (`retention-sweep`) |
| Screenshot (password, card and `[data-private]` fields masked before capture; the reporter can remove it) | Reporter | Diagnosis | Same as the report; served back only as a 10-minute signed URL to the same reporter key |
| Thread messages (developer replies, the reporter's answers) | Both sides | Two-way conversation | Same as the report |
| Status events (`reporter_notifications`) | Mushi pipeline | "Looking into it", "Fixed in v1.4", read/unread | Same as the report |
| Reporter email (Phase 3, **opt-in only**, double opt-in) | Reporter | Status emails about *their own* report | Until unsubscribe or erasure |
| Web Push subscription (Phase 3, opt-in, browser prompt after a tap) | Reporter's browser | Push about their own report | Until unsubscribed, or the push service reports it gone |
| Rate-limit bucket (hash of project + reporter key, or of IP) | Derived | Abuse protection | Rolling window |

Report text and sanitised screenshots are sent to the LLM provider listed in
the privacy policy for diagnosis. With your own model key (BYOK), the call runs
against **your** provider account.

If you turn on **Search the web for known fixes** (Settings → Web tools, off by
default, per project), the report's error message, with IDs, URLs and long
numbers removed, is also sent to Firecrawl as a search query against GitHub
and Stack Overflow. Report text from the reporter, screenshots and the
reporter key are not sent.

What the reporter is **never** shown: internal severity or category, PR or
branch names, the coding agent used, LLM output, or other reporters' content
(duplicate counts are bucketed: "a few others", "many people").

## 3. Email and notices to reporters

- Status emails about the reporter's own report are **transactional**: legitimate
  interest under GDPR, and outside 特定電子メール法 (Act on Specified Electronic
  Mail) as long as they carry **no promotion**. Do not add marketing to them; that
  would make them advertising email, which is opt-in only.
- The opt-in checkbox is never pre-ticked, a verification mail is sent before the
  first update, and every mail has `List-Unsubscribe` and `List-Unsubscribe-Post`
  (one-click, RFC 8058).
- Reporters are never subscribed to a changelog or newsletter.
- The opt-in copy should name **your** app, because you are the controller.

## 4. Template clauses (fill in the brackets)

1. **Scope.** [Host company] ("Controller") entrusts Mushi ("Processor") with the
   processing of end-user bug reports submitted through the Mushi widget in
   [app name], solely to triage, diagnose and fix defects and to notify the
   submitting end user about their own report.
2. **Instructions.** The Processor processes the data only on the Controller's
   documented instructions, which are the project configuration in the Mushi
   console (including `reporter_updates_mode`, retention, and enabled channels).
3. **Confidentiality.** Personnel with access are bound by confidentiality.
4. **Security.** Row-level security on every table, one-way reporter keys,
   short-lived signed URLs for screenshots, encryption in transit and at rest,
   and the measures described at `/security` on the Mushi docs site.
5. **Sub-processors / 再委託.** The Processor uses only the sub-processors in the
   privacy policy, section 5, and gives notice there before adding one. The
   Controller may object within [30] days.
6. **Data subject requests.** The Processor provides `GET /v1/sdk/me/export` and
   `DELETE /v1/sdk/me` and assists with requests within [10] business days.
7. **Breach notice.** The Processor notifies the Controller without undue delay,
   and within [72] hours of becoming aware of a breach affecting this data.
8. **Supervision (APPI Art. 25).** The Controller may request a written report on
   the measures in clause 4 [once a year] and after any notified breach.
9. **Transfers.** Data may be processed in the regions listed in the privacy
   policy; transfers rely on the mechanisms stated there.
10. **Return and deletion.** At the end of the service the Processor deletes the
    data, or returns it on request, within [30] days, except where law requires
    retention.

## 5. Reporter-facing notice (example)

> Bug reports you send from [app name] go to its developer through Mushi, a
> service that helps them triage and fix bugs. Your report, the screenshot you
> choose to attach, and basic device details are processed by Mushi on
> [app name]'s behalf. You can see updates in "Your reports"; email updates are
> optional and you can turn them off at any time. [Link to app privacy policy]
