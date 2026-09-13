---
"@mushi-mushi/core": minor
---

Add same-origin `tunnel`, error filtering, and a page-unload beacon transport.

- **`tunnel`** — post reports to a same-origin path (`tunnel: '/api/mushi-tunnel'`)
  instead of the API host, so no CORS preflight is needed and ad-blockers that
  match on third-party hosts do not drop the request. Mirrors Sentry's option
  of the same name.
- **`ignoreErrors` / `denyUrls` / `allowUrls`** — drop errors by message pattern
  or by the URL of the frame that raised them, before anything leaves the page.
- **`sendOnUnload`** — flush a queued report from a `pagehide` handler, where a
  normal `fetch` is cancelled as the document goes away.

These shipped in #380 as part of a larger merge, but the only `@mushi-mushi/core`
changesets in that release were patches — a new public export surface is a minor.
This is the release note they should have had; the code is already on master.

Related: the `KNOWN_CONFIG_KEYS` fix released alongside this is what makes
`tunnel`, `ignoreErrors`, `denyUrls` and `allowUrls` actually take effect rather
than being rejected as unknown options.
