# Privacy Policy

Source: https://kensaur.us/mushi-mushi/docs/legal/privacy

---
title: Privacy Policy
description: What Mushi Mushi collects, why, who processes it, how long it is kept, and how to exercise your rights under GDPR and Japan's APPI.
---

# Privacy Policy

  **Draft, not yet reviewed by a lawyer.** This page is a complete plain-English
  description of how Mushi Mushi handles personal data as of 2026-09-21. Treat
  it as a description of current practice, not a finished legal document.
  Questions: kensaurus@gmail.com.

**Effective date:** 2026-09-21 · **Version:** 1

This policy covers **Mushi Cloud** (the hosted service at
`kensaur.us/mushi-mushi`), the **admin console**, the **docs site**, the
**Mushi Bounties** tester marketplace, and the **SDKs** when they send data
to Mushi Cloud. If you self-host the open-source server, you are the operator
and this policy does not apply to your instance.

## 1. Who is responsible

Mushi Mushi is built and operated by **kensaurus**, an individual developer
based in Japan (the "controller" for the data described in section 3, and the
"processor" for the data described in section 4).

- **Contact for anything in this policy:** [kensaurus@gmail.com](mailto:kensaurus@gmail.com)
- **Subject line that gets the fastest answer:** `[mushi-privacy]`
- **Security reports:** see [SECURITY.md](https://github.com/kensaurus/mushi-mushi/blob/master/SECURITY.md) and the [security summary](/security).

There is no separate data-protection officer. The founder answers these
requests personally.

## 2. What data we handle, in one table

| Category | Examples | Where it comes from | Why |
| --- | --- | --- | --- |
| **Account data** | Email address, display name and avatar from Google or GitHub sign-in, the "how did you hear about us" answer and `?src=` signup source, plan and billing status | You, when you create a console account | Run your account, bill you, understand which channels bring users |
| **End-user report data** | Screenshot, console and network log excerpts, browser user agent, viewport, page URL, the reporter's free-text description, an opaque reporter token, a hashed device fingerprint (a SHA-256 of browser, screen and time-zone traits, used to spot abuse), any end-user identifier (email, user ID) the host app chooses to pass, voice transcripts when the host app turns on voice intake | The SDK in an app that a project owner built | Diagnose the bug and hand the owner a fix |
| **Fix and repo data** | Repository names, file paths and an index of your code, draft pull requests, MCP tool calls from your editor | The GitHub integration and the MCP server, when you connect them | Produce fixes that fit your codebase |
| **Product usage events** | Console page views, setup-funnel steps (project created, key minted, first report), feature clicks, and a session heartbeat with your browser user agent, tagged with your user ID | The console, through Mushi's own SDK | Improve activation and find dead ends |
| **Docs-site analytics** | Views of the landing, quickstart and pricing pages (route, referring page without its query string, `utm_*` tags), clicks on sign-up and demo buttons, a session heartbeat with your browser user agent, and a random browser ID stored in your browser. These are **pseudonymous, not anonymous**: if you later sign in to the console in the same browser, the console links your earlier docs events to your account | The docs and landing pages, through Mushi's own SDK — only after you accept the consent bar | Measure the funnel from landing to signup |
| **Console error telemetry** | Stack traces, browser and OS, the console route you were on when something broke | Sentry, from the admin console | Fix bugs in the console itself |
| **Support and security mail** | Whatever you put in an email to us | You | Answer you |
| **Bounties tester data** | Tester display name, points balance, gift-card redemptions, and KYC details (legal name, jurisdiction, tax ID) once redemptions pass US$599 in a calendar year | You, on the Bounties marketplace | Pay out gift cards and meet US tax reporting rules |

We do not sell personal data and we do not run advertising.

## 3. Data where Mushi is the controller

This is data about **you**, the person with the console or tester account:
account data, product usage events, docs-site analytics, console error
telemetry, support mail, and Bounties tester data.

**Legal bases (GDPR art. 6(1))**

- **(b) contract** — creating and running your account, billing, delivering
  diagnoses, paying tester bounties.
- **(f) legitimate interests** — keeping the service secure, preventing abuse
  and quota gaming, keeping the console working (error telemetry), and
  understanding which onboarding steps fail. We ran a balancing test on the
  product-usage events: they are scoped to your own account, never shared, and
  expire (section 7).
- **(a) consent** — docs-site analytics. Until you accept the consent bar
  the docs site loads no analytics code, sends no analytics events, and
  stores nothing for analytics except your answer; Do Not Track and Global
  Privacy Control are honoured as a refusal. "No thanks" keeps it that way.
- **(c) legal obligation** — tax records for paid plans and tester payouts.

## 4. Data where Mushi is the processor

End-user report data, fix and repo data, and any voice transcript belong to the
**project owner** — the developer who put the SDK in their app. For that data:

- The **project owner is the controller**. They decide what the SDK captures,
  whether to pass end-user identifiers, whether to enable voice intake, and
  they must tell their own users that screenshots and console output may be
  captured (this duty is in the [Terms](/legal/terms#5-acceptable-use)).
- **Mushi is the processor** and acts only on the owner's instructions: store
  the report, run the diagnosis, produce a fix, delete on schedule or on
  request.
- **Data-processing summary (DPA).** Mushi processes this data only to provide
  the service; applies the security measures on the [security summary](/security);
  uses only the sub-processors in section 5 and gives notice on this page before
  adding one; assists the owner with data-subject requests through the DSAR
  tooling in the console; deletes or returns the data at the end of the
  contract; and makes the SOC 2 readiness evidence available on request. Owners
  who need a signed DPA on their own paper can email us.

End users of a project owner's app should contact **that owner** first. If you
cannot reach them, email us and we will forward the request.

## 5. Sub-processors

| Sub-processor | What they process | Location | Notes |
| --- | --- | --- | --- |
| **Supabase** (on AWS) | Database, auth, storage, edge functions — everything at rest | AWS `ap-northeast-1` (Tokyo) today. EU and JP residency options are reserved; when the dedicated clusters ship, a project's data stays in the [region chosen at creation](/security/data-residency) | Row-level security on every table, nightly coverage check |
| **Anthropic**, **OpenAI**, **OpenRouter** | Report text, sanitised screenshots and logs sent for diagnosis; audio clips for voice transcription (OpenAI only) | US | **BYOK:** if you add your own model key, calls run against *your* provider account. Nothing is billed to or stored by Mushi's provider account. Hosted keys are used only when you have not added your own |
| **Resend** | Email address and the content of transactional email (verification, usage alerts, invitations, lifecycle nudges) | US | No marketing list, no tracking pixels |
| **AWS S3 + CloudFront** | Static docs and console files; screenshots when you pick S3 as [BYO storage](/security/byo-storage) | US / your bucket's region | Public assets only, unless you bring your own bucket |
| **Sentry** | Console error telemetry (section 2) | US | Console only; the SDK in your app never reports to our Sentry |
| **GitHub** | OAuth sign-in profile; repo metadata, code index and draft PRs when you connect a repository | US | Access is scoped to the repos you pick and revocable in GitHub settings |
| **Stripe** | Billing name, email, card details (Stripe holds the card, we never see the full number), invoices | US | Paid plans only |
| **Firecrawl** | Public URLs you point Mushi at (for example your own site) when running inventory or QA-coverage crawls | US | Only pages you ask us to crawl |
| **Tremendous** | Gift-card delivery for Bounties testers: email, amount, and KYC data past the threshold | US | Bounties only |

## 6. International transfers and residency

Mushi is operated from **Japan**, and production data is stored in **Tokyo**.
The EU recognises Japan as providing adequate protection, and Japan
recognises the EEA and the UK in the same way, so EEA/UK ↔ Japan transfers need
no extra safeguard.

Transfers to the US sub-processors above rely on the provider's **EU-US Data
Privacy Framework** certification where it exists, and otherwise on **Standard
Contractual Clauses** in the provider's data-processing terms.

You can pick a residency region at project creation; see
[Data residency](/security/data-residency) for what is live today and what is
reserved.

## 7. Retention

| Data | Kept for | Mechanism |
| --- | --- | --- |
| End-user reports and everything attached to them | The retention window of your plan: **Free 7 days · Indie 30 days · Pro 90 days · Enterprise as agreed**, or a shorter per-project policy you set in **Compliance → Data retention** | A daily `retention-sweep` job hard-deletes rows past the window. Legal-hold rows are skipped |
| Product usage events (Mushi's own console analytics) | **730 days (2 years)** | Nightly `prune_product_events` job, using the 730-day retention set on Mushi's own analytics project |
| Docs-site analytics | 730 days (2 years) | Same table and job as above |
| Analytics events your app sends with `Mushi.track()` | 90 days by default, or the per-project override (1–3650 days) | Same nightly job |
| Console error telemetry | 90 days | Sentry retention |
| Account data | Until you delete your account, then 30 days for backups to roll off | Delete from **Settings**, or email us |
| Billing records and tester payout records | As long as Japanese and US tax law requires (currently up to 7 years) | Stripe / Tremendous exports |
| Support and security email | 2 years | Mailbox |
| Backups | Point-in-time recovery, 7 days | Supabase |

## 8. Your rights and how to use them

If you are in the EEA, the UK, or another place with similar law, you can ask
us to **access**, **correct**, **delete**, **restrict**, or **export** your
data, **object** to processing based on legitimate interests, and **withdraw
consent** (the docs consent bar can be reset by clearing site data). You can
also complain to your local supervisory authority.

- **Console accounts:** most of this is self-service in **Settings**. For a
  full export or deletion, email [kensaurus@gmail.com](mailto:kensaurus@gmail.com)
  from the address on the account.
- **Project owners handling requests from their end users:** the console
  has a DSAR tool that produces a signed export per reporter; see
  [SOC 2 readiness → DSAR](/security/soc2#dsar-data-subject-access-request).
- **End users of someone else's app:** contact the app's owner. If you cannot,
  email us with the app name and we will route the request.

We answer within **30 days**. We will ask you to prove you own the account
or the reporter identity before releasing anything.

## 9. Japan — Act on the Protection of Personal Information (APPI)

This section applies to personal information handled by Mushi as a
business operator under the APPI (個人情報の保護に関する法律).

- **Business operator (個人情報取扱事業者):** kensaurus, Japan. Contact:
  [kensaurus@gmail.com](mailto:kensaurus@gmail.com).
- **Purpose of use (利用目的):** to provide and improve the Mushi service,
  bill for paid plans, answer support requests, keep the service secure, pay
  Bounties testers, and comply with law. We do not use personal information
  beyond these purposes without your consent.
- **Provision to third parties (第三者提供):** we do not provide personal
  information to third parties except (a) to the sub-processors in section 5,
  who act on our instructions under a contract (委託), (b) where required by
  law, or (c) with your consent. Some sub-processors are outside Japan
  (mainly the US); we have confirmed their data-protection systems and the
  measures they take, as required for cross-border provision.
- **Retained personal data (保有個人データ):** you may request disclosure,
  correction, addition, deletion, suspension of use, or suspension of
  third-party provision. Email us with `[mushi-privacy]` in the subject. We
  will verify identity and respond without undue delay. We do not charge a fee.
- **Security measures (安全管理措置):** row-level security on every table,
  encryption at rest and in transit, least-privilege access with an
  append-only audit log, and the controls listed on the
  [security summary](/security).
- **Complaints (苦情):** use the same address. If we cannot resolve it, you may
  contact the Personal Information Protection Commission (個人情報保護委員会).

## 10. Children

Mushi is not directed at anyone under **16**, and we do not knowingly collect
their data. Project owners must not point the SDK at apps built for children
without their own compliance review. If you think a child has given us data,
email us and we will delete it.

## 11. Cookies and browser storage

We use no advertising or cross-site cookies. What each surface stores in your
browser:

| Surface | Key | Purpose | Lifetime |
| --- | --- | --- | --- |
| Console | Supabase auth session (cookie / localStorage) | Keep you signed in | Until sign-out or expiry |
| Console | `mushi:tour-v1-completed` | Remember that you finished the first-run tour | Until cleared |
| Console | Theme preference | Light / dark | Until cleared |
| Console | `mushi:accounts` | Each account signed in on this browser, with its sign-in session, so the account switcher can change accounts without a new sign-in | Until you remove the account or choose **Sign out of all** |
| Console | `mushi:login:last_email` | The email address on the sign-in form, only when you choose to have it remembered | Until cleared |
| Console | Active organization and project, collapsed panels, dismissed hints, saved views | Interface state | Until cleared |
| Console | Mushi SDK keys (see the SDK rows below) | The console runs Mushi's own SDK for bug reports and product analytics | As listed below |
| Docs | `mushi_events_consent_` | Remember your answer to the analytics consent bar — the only analytics key the docs site writes unless you accept | Until cleared |
| Docs | Release-banner dismissal, theme preference | Hide a banner you closed; light / dark | Until cleared |
| Docs | `mushi:migration::steps` | Your progress through a migration guide's checklist | Until cleared |
| Docs | `mushi:docs:auth`, `mushi:docs:bridge-nonce` (session storage) | Only when you sign in from the docs: a short-lived console session so snippets can show your own project | Until the tab closes |
| Docs, after you accept | `mushi_first_touch_` | Where your first visit came from: `utm_source` / `utm_medium` / `utm_campaign`, the referring page without its query string, the landing path, and the time | Until cleared |
| Docs, after you accept | Mushi SDK keys (see the SDK rows below) | The docs site loads Mushi's own SDK once you accept | As listed below |
| **SDK** (your app, the console, the docs after consent) | `mushi:reporter-token:` (`mushi_reporter_token` when the SDK starts without a project ID) | A random token so repeat reports and analytics events from the same browser group together. It is not an email or a name, but it links events from the same browser | Until cleared |
| **SDK** | `mushi_session_id` (session storage) | Group events from one browser tab session | Until the tab closes |
| **SDK** | `mushi_events_consent_`, `mushi_events_spill_` | The analytics consent state, and analytics events that could not be sent yet (retried on the next visit) | Until cleared or sent |
| **SDK** | `mushi_fingerprint_hash` | The hashed device fingerprint described in section 2, cached so it is computed once | Until cleared |
| **SDK** | Offline report queue (IndexedDB `mushi-mushi`, falling back to `mushi_offline_queue`) and its encryption key (IndexedDB `mushi-mushi-keyring`) | Reports that could not be sent yet, encrypted at rest where the browser allows | Until sent; the key until cleared |
| **SDK** | `mushi:last-run`, cached runtime and SDK-version settings, `mushi_region_v1:` | Technical state: crash-on-last-run detection, cached project settings, and the resolved API endpoint | Until cleared or expired |
| **SDK** | `mushi:lastShown`, `mushi:lastDismiss`, `mushi:consecDismiss`, `mushi::firstSessionShown` | Only when the app turns on proactive report prompts: when a prompt was last shown or dismissed, so it does not keep asking | Until cleared |
| **SDK** | `mushi:tester-jwt:` | Only for a Bounties tester who signs in from the widget: the tester session | Until cleared or expired |

The SDK sets no cookies and reads no third-party cookies.

## 12. Changes

We will post changes on this page and bump the version number. For changes
that reduce your rights or add a sub-processor, we also email console account
holders at least **14 days** before the change takes effect. Continued use
after the effective date means the new version applies.

## 13. Contact

**kensaurus** · Japan · [kensaurus@gmail.com](mailto:kensaurus@gmail.com) ·
subject `[mushi-privacy]`

Related: [Terms of Service](/legal/terms) · [Security summary](/security) ·
[Data residency](/security/data-residency) · [SOC 2 readiness](/security/soc2)
