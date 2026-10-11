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
(**Connectors** card), or through `POST /v1/admin/orgs/:orgId/connectors`.
Every credential is stored in Supabase Vault and used read-only unless noted.

| Connector | Credential | Bind each app by | Status |
|---|---|---|---|
| `revenuecat` | A RevenueCat **v2 secret key with read-only permissions** (project configuration: read only) | The RevenueCat project id. Every app should bind to the **same** project id | Built |
| `app_store_connect` | A team API key (key id, issuer id, `.p8`) with a read role (Developer or App Manager). Apple keys see every app on the team | The app's numeric Apple id | Built. Shows `blocked` until the account holder accepts Apple's current agreement (Business → Agreements). That is not a key error |
| `play_console` | A service account invited with app-level "View app information". Approved acts need release permissions on a separate write key | The Android package name | Built |

After adding a connector, run **Probe**. It records which scopes the key
actually has. A connector without a credential shows `not_connected`, never
an error.

Each app's `mushi.recipe.json` should also declare its store ids
(`app.ids.bundleId`, `app.ids.androidPackage`), plus `links.billing.sharedCreditsWith`
for apps that are meant to share a pass. The checks below compare against
those.

## 2. What the drift checks mean

Drift checks appear as findings on the portfolio page and in
`list_gate_findings`: gate `portfolio_radar` for the RevenueCat rules,
`deploy_drift` for the store rules. Each one names a reason a user could not
pay, or could pay and get nothing.

| Rule | Meaning | Fix | Status |
|---|---|---|---|
| `revenuecat_project_split` | Two apps declare shared credits but sit in different RevenueCat projects, so a purchase in one will not unlock the other | Move both apps into the one project | Built |
| `revenuecat_app_missing` | A store app (bundle id or package) is not registered in its RevenueCat project, so its purchases are never seen | Add the app in RevenueCat | Built |
| `revenuecat_offering_missing` | The project has entitlements but no current offering, so the paywall has nothing to show | Mark one offering current | Built |
| `store_review_stuck` | An iOS version has waited in App Review for more than 7 days | Check the Resolution Center | Built |
| `rollout_halted` | A Play release is halted | Check why before resuming | Built |
| Product without entitlement | A product sold in a store is attached to no entitlement, so buying it unlocks nothing | Attach it in RevenueCat | Planned |
| Catalog price drift | A live price differs from the catalog file in the spine repo | Re-run the catalog sync, or update the file | Planned |
| Ledger webhook not set | The RevenueCat project has no webhook pointing at the ledger, so purchased credits never arrive | Set the webhook in RevenueCat | Planned |

## 3. How approved actions work

Mushi changes a store or RevenueCat only through `connector_actions` (ADR
0017):

1. **Request.** An agent (MCP `request_connector_action`) or the API asks for
   one action with one exact payload. Nothing runs. The request stores the
   SHA-256 of the payload.
2. **Approve.** An org owner or admin approves it from the console
   (**Portfolio → Actions**). API keys and MCP cannot approve. The approval
   expires after one hour.
3. **Execute.** A human runs it from the console. It runs once, on the
   stored payload, and only if the hash still matches. A replay or a second
   click gets nothing.

Built acts: Play `set_rollout` and `promote_track`. RevenueCat write actions
(for example, attaching a product to an entitlement or marking an offering
current) are **planned**, and will ship disabled behind the same approval.

## 4. What stays outside Mushi

- **Credit balances** live in your ledger. Purchases reach it through
  RevenueCat webhooks; spends happen only there. RevenueCat virtual currency
  is not used, because adjustments made through its API send no webhook.
- **The catalog** (products, entitlements, offerings, prices) is a file in
  your spine repo. A sync script applies it to RevenueCat, and a nightly
  export of the live configuration is committed as a backup. Both scripts
  are yours, and both are **planned**.
- **Paywalls** are RevenueCat Paywalls v2, configured in RevenueCat.
