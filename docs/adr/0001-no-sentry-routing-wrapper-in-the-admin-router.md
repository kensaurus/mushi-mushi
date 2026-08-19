# 0001. Keep the admin router unwrapped by Sentry

Status: Accepted            Date: 2026-08-19

## Context

`apps/admin` is a React 19 SPA on react-router-dom v7. Sentry's browser SDK
ships `withSentryReactRouterV6Routing` (and the v7 equivalent), which wraps
`<Routes>` to attribute navigation transactions to route patterns. It is the
documented setup and looks like an obvious omission to anyone reading our
`main.tsx` — the SDK is initialised, but the router is plain.

When the wrapper was in place it violated hook order under React 19
StrictMode. The visible symptom was not an error banner but random SPA
navigations and whole-tree remounts, which are extremely expensive to
diagnose because they present as "the app is flaky" rather than as a stack
trace.

## Decision

We use bare `<Routes>` in `apps/admin/src/App.tsx` (`const SentryRoutes =
Routes`). Sentry stays initialised for error and performance capture; only the
routing instrumentation is off.

## Rejected alternatives

- **`withSentryReactRouterV6Routing` wrapper** — the documented integration.
  Rejected: hooks-order violation under React 19 StrictMode, surfacing as
  random navigations and tree remounts. Cost of diagnosis far exceeded the
  value of route-pattern attribution.
- **Disable StrictMode instead** — would keep the wrapper working. Rejected:
  StrictMode catches real concurrent-rendering bugs; trading it for
  transaction naming is the wrong side of the deal.
- **`createBrowserRouter` + `wrapCreateBrowserRouter`** — the other supported
  shape. Rejected: a full router rewrite to regain a reporting nicety.

## Consequences

Sentry performance transactions on the admin console are not labelled by route
pattern; navigation timing must be read from other signals. Errors, breadcrumbs
and replays are unaffected. Revisit when Sentry's React 19 support is
confirmed fixed upstream — and only behind a StrictMode smoke test that
exercises repeated in-app navigation.
