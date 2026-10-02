# One login and one purchase across your apps

Source: https://kensaur.us/mushi-mushi/docs/concepts/shared-login

---
title: 'One login and one purchase across your apps'
description: How to let people sign in once and keep what they bought across several of your apps, and what Mushi checks so it keeps working.
---

# One login and one purchase across your apps

If you run several apps, you may want people to sign in once and keep what they
bought in every app. Mushi does not hold accounts or balances. It checks that
the setup you chose keeps working, and tells you when one app drifts from the
rest.

Prices, plan limits and beta labels change often. Check each provider's own
docs before you choose.

---

## Signing in once

Pick one of these. Each keeps a single list of users that every app trusts.

| Setup | How it works | Watch out for |
|-------|--------------|---------------|
| **Supabase as the login provider** | One Supabase project holds the users. It acts as an OAuth 2.1 / OpenID Connect provider, and each other app signs in through it. | Every app's domain and deep-link scheme must be on that project's redirect list, or login breaks in that app. |
| **Clerk with satellite domains** | One Clerk application. The main domain hosts sign-in; the other apps run on satellite domains and share the session. | Satellite domains are set per app. A new app needs one added before it can share the session. |
| **Auth0, one tenant** | Every app is an application inside one Auth0 tenant, so users and sign-in rules are shared. | Each application has its own callback list. A missing callback shows up as a login error only in that app. |

Tell Mushi which apps share a login in each app's `mushi.recipe.json`:

```json
{
  "links": {
    "auth": { "provider": "supabase", "ref": "abcdefghijklmnopqrst" },
    "domains": ["glot.it"],
    "deepLinks": { "schemes": ["glotit"] }
  }
}
```

### What Mushi checks

- **Redirects.** Every domain and deep-link scheme an app declares must be on
  the shared redirect list. Mushi reads the list from `supabase/config.toml` in
  your repos. That file is what `supabase config push` sends; a change made only
  in the dashboard is not in it, so the finding says where the list came from.
- **Same settings.** When two repos declare the same login project, they must
  agree on sign-in methods, email confirmation and two-factor sign-in. Whichever
  pushes last wins, so a disagreement changes login for every app.
- **Not checked** means no repo in the group has a `supabase/config.toml` with
  an `[auth]` section. It is never shown as passing.

Mushi never reads the live login settings from Supabase. That response holds
provider secrets, and the Supabase connection stays read-only SQL.

---

## Keeping a purchase in every app

| Setup | How it works | Watch out for |
|-------|--------------|---------------|
| **RevenueCat, one project** | Put the apps in one RevenueCat project. An entitlement bought in one app is active in the others for the same user. | Entitlements are shared only inside one project. Apps in separate projects do not share purchases. |
| **Stripe, one account** | Apps that sell on the web bill through one Stripe account and read the same customer. | Stripe credit grants are a credit toward future usage invoices, not a balance one app can spend in another. |

Declare which apps share purchases:

```json
{
  "links": {
    "billing": { "stripeAccount": "acct_123", "sharedCreditsWith": ["yen-yen"] }
  }
}
```

### What Mushi checks

- Apps that share purchases name the same Stripe account. If one names none,
  Mushi says it cannot check, rather than calling it a mismatch.
- With RevenueCat connected: apps that share credits are in one RevenueCat
  project, every app has a RevenueCat app, and each one has an offering.

---

## Sending users between your apps

List the "more apps" links each app shows:

```json
{
  "links": {
    "crossPromo": [{ "url": "https://apps.apple.com/app/id1234567890?ct=from-glot", "toProject": "yen-yen" }]
  }
}
```

Mushi opens each link once a day. A link that answers 404 is broken. A store
that throttles the check is **Not checked**, not broken. A link with no
campaign tag (`ct` on the App Store, a `referrer` with `utm_source` on Google
Play, `utm_source` and `utm_campaign` elsewhere) is flagged, so you can tell
installs from it apart. Links into a sibling app also go through the deep-link
check on [the recipe](./app-recipe).

## Comparing apps

**Portfolio → Funnel across apps** runs one funnel on every app: the same event
names, in the same order, within the same window. An app with product events
off says **Events off**. An app where nobody entered the first step says **No
events yet**. Neither is shown as 0%.
