# Monetization across apps: operator guide

How Mushi fits into taking payments across several apps. The decision and
its reasons are in
[ADR 0025](../adr/0025-portfolio-monetization-revenuecat-hub-own-ledger.md).
In short:

- RevenueCat holds the purchases and entitlements for every app, in one
  project.
- Your own backend ledger holds credit balances.
- Mushi reads both stores and RevenueCat, explains why a purchase would fail,
  and changes things only when you approve each change.

Mushi never holds balances, grants entitlements on its own, or reads
RevenueCat customers.

## 1. Bind the connectors

Connectors are added per organization from the console's **Portfolio** page
(**Connected sources**), or through `POST /v1/admin/orgs/:orgId/connectors`.
Every credential is stored in Supabase Vault. The read key is used read-only;
a write key is stored separately and is used only by an approved action.

| Connector | Read credential | Bind each app by | Status |
|---|---|---|---|
| `revenuecat` | A RevenueCat **v2 secret key** with `project_configuration:*:read`, plus `charts_metrics:overview:read` for the headline numbers. It needs no `customer_information` permission: Mushi never reads customers | The RevenueCat project id (`proj…`). Every app binds to the **same** project id | Built |
| `app_store_connect` | A team API key (key id, issuer id, `.p8`) with a read role (Developer or App Manager). Apple keys see every app on the team | The app's numeric Apple id | Built. Shows `blocked` until the account holder accepts Apple's current agreement (Business → Agreements). That is not a key error |
| `play_console` | A service account invited with app-level "View app information". Approved acts need release permissions on a separate write key | The Android package name | Built |

### RevenueCat, step by step

1. In RevenueCat, open the hub project → **Project settings → API keys** →
   **New secret API key (v2)**. Give it **read-only** project configuration
   permissions and **Charts & metrics: overview read**. Nothing else.
2. In Mushi, **Portfolio → Connected sources → Add a source**: kind
   **RevenueCat**, paste the key, pick the first app and enter the project id
   (for example `proj7ff5b439`).
3. For every other app that sells, open the connector's **Bind another app**
   and enter the same project id. Unbound apps that sell are flagged by
   `monetization_app_outside_hub`.
4. Press **Check**. The snapshot is taken by the daily collection (03:35 UTC),
   after which the **Payments across apps** card fills in.
5. Optional, for approved actions: create a **second** v2 secret key with
   `project_configuration:packages:read_write` (attach products) and/or
   `customer_information:customers:read_write` (support grants). Paste it under
   the connector's **Payment actions** and press **Turn on**. Without it the
   actions stay unavailable and say why.

Each app's `mushi.recipe.json` should declare its store ids
(`app.ids.bundleId`, `app.ids.androidPackage`) and, under `links.billing`:

| Key | What it does |
|---|---|
| `catalog` | Path of the billing catalog JSON in **this** repo (for example `kensaurus-spine/payments/catalog.json`). One repo declaring it is enough; the GitHub connector reads it at the default-branch head |
| `catalogApp` | The catalog's id for this app, when no store id matches |
| `offering` | The offering lookup key this app sells through, when there is no catalog |
| `entitlements` | Entitlement lookup keys this app grants, when there is no catalog |
| `sells` | `true` when the app takes payments but declares none of the above |
| `sharedCreditsWith` | Apps meant to share a pass (checked by `revenuecat_project_split`) |

The checks tie each finding to the app that owns it: by the products' app,
then the catalog, then these recipe keys. A finding no app can be tied to is
shown on the card under **Not tied to an app**, never on every app.

## 2. What the drift checks mean

Drift checks appear on the portfolio page (**Payments across apps**), in the
radar, and in `list_gate_findings` (gate `portfolio_radar`;
`store_review_stuck` and `rollout_halted` are gate `deploy_drift`). Each names a reason a user could not pay, or could
pay and get nothing. A check that could not look says **Not checked** with the
reason; it is never a pass.

| Rule | Meaning | Fix | Status |
|---|---|---|---|
| `monetization_app_outside_hub` | An app that sells is bound to no RevenueCat project, or to one other than the catalog's hub, so its purchases are unseen and a shared pass never unlocks it | Bind it to the hub project and register its store apps there | Built |
| `monetization_ios_app_missing` | An app has an iOS bundle id but RevenueCat has no **App Store** app for it, so iPhone purchases are never validated | Add the App Store app in RevenueCat (needs an App Store Connect In-App Purchase key) | Built |
| `revenuecat_app_missing` | The Android package is not a **Play Store** app in the RevenueCat project | Add the Play app in RevenueCat | Built (Android only since 2026-10-11) |
| `monetization_offering_empty` | An offering has no packages, its packages have no products, or on one platform its packages carry no product, so the paywall shows nothing | Attach the store products to each package | Built |
| `monetization_entitlement_unattached` | An entitlement has no products, so a buyer pays and gets nothing | Attach the products that should unlock it | Built |
| `monetization_product_not_in_offering` | A product is in RevenueCat but in no offering, so no paywall can sell it (info) | Attach it to a package, or archive it | Built |
| `monetization_catalog_drift` | RevenueCat differs from the catalog: a missing or extra product, entitlement, offering or package, a package selling the wrong product, or a product that does not grant its entitlement. iOS items are not compared one by one while the iOS app is missing | Re-run the catalog sync, or update the file. A package mismatch offers the approved attach action | Built |
| `monetization_store_product_unready` | A store product is not purchasable: iOS not `APPROVED` / `READY_TO_SUBMIT`, or a Play base plan or one-time product not `ACTIVE`. A warning when the paywall offers it | Finish and submit it in App Store Connect, or activate it in Play Console | Built. Reads need the store connectors; a store that refuses reads `unknown` |
| `monetization_webhook_unhealthy` | No RevenueCat webhook sends this app's purchases to the backend the catalog names, so purchased credits never arrive. Without a catalog, an app no webhook covers is a note | Add the webhook in RevenueCat (Integrations → Webhooks) | Built. Checks configuration only: RevenueCat's API does not report delivery failures, so delivery is not checked |
| `revenuecat_project_split` | Two apps declare shared credits but sit in different RevenueCat projects | Move both apps into the one project | Built |
| `revenuecat_offering_missing` | The project has entitlements but no current offering | Mark one offering current | Built |
| `store_review_stuck` | An iOS version has waited in App Review for more than 7 days | Check the Resolution Center | Built |
| `rollout_halted` | A Play release is halted | Check why before resuming | Built |
| `monetization_billing_library_outdated` | The app ships an old purchases SDK | Upgrade it | Planned: neither the recipe nor the ingest reports the SDK version yet |
| Catalog price drift | A live store price differs from the catalog | Re-run the sync, or update the file | Planned: RevenueCat holds only indicative prices, so this needs the store price reads |

## 3. How approved actions work

Mushi changes a store or RevenueCat only through `connector_actions` (ADR
0017):

1. **Request.** An agent (MCP `request_connector_action`), the API, or the
   card's **Ask to fix** asks for one action with one exact payload. Nothing
   runs. The request stores the SHA-256 of the payload.
2. **Approve.** An org owner or admin approves it from the console
   (**Portfolio → Connected sources → Store and payment actions**). API keys
   and MCP cannot approve. The approval expires after one hour.
3. **Execute.** A human runs it from the console. It runs once, on the
   stored payload, and only if the hash still matches. A replay or a second
   click gets nothing.

| Connector | Action | Payload | Status |
|---|---|---|---|
| `play_console` | `set_rollout` | `{ package, track, userFraction, versionCodes }` | Built |
| `play_console` | `promote_track` | `{ package, track, toTrack, versionCodes, userFraction? }` | Built |
| `revenuecat` | `attach_products_to_package` | `{ rcProjectId, packageId, products: [{ productId, eligibilityCriteria? }] }` (1–20 products) | Built |
| `revenuecat` | `grant_promotional_entitlement` | `{ rcProjectId, appUserId, entitlementId, expiresAt }` (ISO date, in the future, at most 366 days out) | Built, for support |

RevenueCat actions run only on a project the connector binds, with the
separate write key, and only after the connector's **Payment actions** are
turned on. A support grant is a human-approved promotional entitlement for
one customer; Mushi keeps only the entitlement id and expiry it granted, not
the customer record RevenueCat returns.

## 4. What stays outside Mushi

- **Credit balances** live in your ledger. Purchases reach it through
  RevenueCat webhooks; spends happen only there. RevenueCat virtual currency
  is not used, because adjustments made through its API send no webhook.
- **The catalog** (products, entitlements, offerings, prices) is a file in
  your spine repo. A sync script applies it to RevenueCat, and a nightly
  export of the live configuration is committed as a backup. Both scripts
  are yours. Mushi reads the file and compares it with RevenueCat.
- **Paywalls** are RevenueCat Paywalls v2, configured in RevenueCat. The card
  shows whether each offering has one.
- **Revenue reporting** stays in RevenueCat. The card shows four headline
  numbers as context and links to the project.
