# 0025. Portfolio monetization: RevenueCat hub, own ledger, Mushi checks and approved acts

Status: Accepted (owner-delegated, 2026-10-11) Date: 2026-10-11

Related: [ADR 0016](0016-mushi-as-the-app-recipe-control-plane.md) (one
connector interface: snapshot, drift, propose, act with approval),
[ADR 0017](0017-strike-the-plan-019-020-sequencing-gate.md) (the
`revenuecat` connector kind; every live act needs a human approval through
`connector_actions`), [Plan 020 §7](../execplans/portfolio-operator.md)
(Mushi checks consistency and does not hold balances),
`_shared/connectors/revenuecat.ts`, `_shared/connectors/app-store-connect.ts`,
`_shared/connectors/play-console.ts`, `_shared/connector-actions.ts`;
operator guide [`docs/operators/monetization.md`](../operators/monetization.md).

## Context

- The owner runs five apps and none has a paying user yet.
- Each app takes payments a different way: different stores, SDKs, and
  product and entitlement names. No one place shows what each app sells,
  for how much, and whether a purchase actually unlocks anything.
- The owner wants payments to be coherent across the apps and manageable
  from the Mushi console.
- On 2026-10-11 the owner wrote: *"please decide fully for me based on
  research - i give you the autonomy"*.

Constraints found while researching:

- **RevenueCat shares entitlements only inside one project** (Plan 020 §7).
  A purchase in one app can unlock another only if both apps sit in the
  same RevenueCat project.
- **RevenueCat virtual currency cannot be the ledger** for credits that are
  also spent on a backend:
  - RevenueCat's events page says *"Adjustments via API are view-only. These
    adjustments are displayed for reference only and do not generate webhook
    events."* Spends made on a backend would be invisible to every other
    system
    ([revenuecat.com/docs/offerings/virtual-currency/events](https://www.revenuecat.com/docs/offerings/virtual-currency/events)).
  - RevenueCat's own guidance for apps with a backend wallet is to keep the
    backend as the source of truth. In that setup RevenueCat validates the
    purchase and sends a `VIRTUAL_CURRENCY_TRANSACTION` webhook, and the
    backend grants and spends. RevenueCat's balance "may get out of sync"
    when spending happens outside RevenueCat
    ([…/virtual-currency/faq/balance-source-of-truth](https://www.revenuecat.com/docs/offerings/virtual-currency/faq/balance-source-of-truth)).
- **Mushi is not a billing system.** It already has a read-only `revenuecat`
  connector (snapshot, drift) and read-only App Store Connect and Play
  connectors. Play is the only connector with `act` (`set_rollout`,
  `promote_track`), and every act goes through a hash-bound, single-use,
  expiring human approval (ADR 0017).

## Decision

1. **One RevenueCat project, `kensaurus`, holds every app.**
   - Each app is registered in it for every platform it ships on: iOS,
     Android and RevenueCat Web Billing.
   - `app_user_id` is the KENSAURUS account id, the same in every app. This
     lets a purchase follow the person, and an entitlement can be shared
     when the owner chooses.
   - The existing `revenuecat_project_split` drift rule catches part of
     this. It warns when two apps that declare shared credits
     (`links.billing.sharedCreditsWith`) sit in different RevenueCat
     projects. An app in a second project that declares no sharing raises
     no finding, so "every app in one project" is a convention, not
     something a check enforces.
2. **Balances (credits) stay in the operator's own ledger** (the KENSAURUS
   wallet). RevenueCat virtual currency is not used.
   - Purchases that grant credits reach the ledger through RevenueCat
     webhooks.
   - Spends happen only in the ledger.
   - RevenueCat is the record of purchases and entitlements, never of
     balances.
3. **Entitlements are per app, and paywalls use RevenueCat Paywalls v2.**
   - Each app has its own entitlement lookup keys (for example
     `<app>_pro`).
   - A cross-app pass is a separate, deliberate entitlement, not the
     default.
   - Paywalls are configured in RevenueCat and served from its current
     offering, so price tests do not need a store release.
4. **Mushi reads, checks and acts only with approval. It never holds
   balances** (Plan 020 §7).
   - **Read:** the `revenuecat`, `app_store_connect` and `play_console`
     connectors take read-only snapshots of products, offerings, apps and
     store state.
   - **Check:** drift rules turn mismatches into `gate_findings`. These are
     the gaps that explain "why nobody can pay": a store app missing from
     RevenueCat, no current offering, apps split across projects, and
     (planned) a product sold in a store that no entitlement grants, or a
     price that differs from the catalog.
   - **Act:** only through `connector_actions`. MCP or the API may request
     an action; a human approves it from a console session; it runs once,
     on the exact payload whose hash was approved. Nothing runs on its own,
     and no RevenueCat write capability ships enabled.
   - **Never:** Mushi does not store credits, customer balances or
     receipts. It does not grant or revoke entitlements on its own. It does
     not read RevenueCat customers.
5. **The catalog lives as code in the operator's spine repo.**
   - Products, entitlements, offerings and prices for every app sit in one
     reviewed file.
   - A sync script applies the file to RevenueCat. Each store's own
     tooling applies it to the stores.
   - A nightly export of the live RevenueCat configuration is committed as
     a backup, and Mushi's drift checks compare the live state against it.

## Rejected alternatives

- **One RevenueCat project per app.** Entitlements cannot cross projects.
  A cross-app pass would then mean re-platforming later, and every
  dashboard, webhook and key would be multiplied by five.
- **RevenueCat virtual currency as the credit ledger.** Spends made through
  the API send no webhook, so the backend and RevenueCat drift apart, and
  RevenueCat itself recommends the backend as the source of truth when a
  backend spends.
- **Adapty or Qonversion.** They cover the same ground as RevenueCat
  (cross-platform purchases, paywalls, analytics). Mushi already has a
  RevenueCat connector and Plan 020 already names RevenueCat as the mobile
  partner. Changing vendor would cost that work and gain no capability the
  five apps need.
- **Stripe only.** In most regions, digital goods sold inside a mobile app
  must use App Store and Google Play billing. Stripe does not validate store
  receipts.
  Stripe credit grants are monetary, metered-only and capped at 100 unused
  per customer (Plan 020 §7), so they cannot be cross-app credits.
- **Mushi as the billing system** (holding balances, granting entitlements,
  processing purchases). That is a different product with money-handling
  liability. It contradicts Plan 020 §7 and fails the drift test: it does
  not help a solo builder understand and fix a bug faster.

## Consequences

- This is an operator feature. It belongs in `docs/operators/` and the
  console's portfolio page, never in the README hero, the npm description
  or the landing page.
- It passes the drift test only through its checks. A check that explains
  "nobody can pay" in an app is a bug found before a user hits it (ADR
  0017). Revenue dashboards on their own do not pass.
- What exists today:
  - The read-only `revenuecat` connector, with the
    `revenuecat_project_split`, `revenuecat_app_missing` and
    `revenuecat_offering_missing` rules.
  - The App Store Connect read connector. It shows `blocked` until the
    owner accepts Apple's current agreement.
  - The Play connector's approved acts.
- Planned, not built:
  - Product, entitlement and price drift against the catalog.
  - RevenueCat write actions behind `connector_actions`.
  - The catalog sync script and the nightly export, which live in the
    spine repo, not in Mushi.
- The ledger is the operator's to run. Mushi can check it is wired (for
  example, that the RevenueCat webhook is set) but cannot reconcile
  balances it never sees.
- Every app has to use the same `app_user_id`. An app that signs users in
  anonymously first must alias to the KENSAURUS id on sign-in, or its
  purchases will not follow the person.
