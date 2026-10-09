# 0012. Web Push from edge functions on Web Crypto, behind an endpoint allowlist

Status: Accepted (superseded in part on the same day — see *Reversal*)
Date: 2026-09-12

## Context

`sendPushNotification` was an honest stub (`push_not_configured`) and
`reporter_push_subscriptions` had no producer. The phone in the voice loop
belongs to an admin user, not a reporter, so developer push needs a
user-keyed subscription table as well. Web Push is RFC 8030 delivery, RFC
8291 `aes128gcm` encryption and RFC 8292 VAPID. The canonical `web-push` npm
package is Node-only (`crypto`, `https`, five dependencies). Deno options were
`@pushforge/builder` (2.0.5, 2026-04-23, zero dependencies, Web Crypto, lists
Deno) and `jsr:@negrel/webpush` (0.5.0, 2025-06-29, self-declared unaudited
crypto). Both only build the request; the caller performs the `fetch`, which is
an outbound request to a URL supplied by a browser.

## Decision

`_shared/web-push.ts` builds every push request, and before any `fetch` the
endpoint host must match the allowlist `fcm.googleapis.com`,
`*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`;
anything else is rejected as SSRF. VAPID keys are edge secrets
(`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), never files in the
repo. Developer devices subscribe through the installed admin PWA into
`user_push_subscriptions` (owner-only RLS); reporter push keeps
`reporter_push_subscriptions`. 404/410 responses delete the subscription.

## Reversal: the library was dropped during implementation

This ADR originally chose `npm:@pushforge/builder@2.0.5` to build the request.
That did not survive contact with the package. Its 2.0.5 build emits the
**pre-standard `aesgcm` content coding** — `Crypto-Key: dh=` and
`Encryption: salt=` — not the RFC 8291 `aes128gcm` coding, verified by reading
`dist/lib/vapid.js` and `dist/lib/payload.js` after a `deno info`. Apple's
`web.push.apple.com` documents `aes128gcm`, so the dependency would have
shipped a scheme that fails on exactly the platform the voice loop targets.

RFC 8291/8188 encryption and RFC 8292 signing are therefore implemented
directly on Web Crypto in `_shared/web-push.ts`, about 150 lines with no
dependency.

This contradicts the "hand-rolled ECDH/HKDF is forbidden" line below, which was
written to avoid unreviewed crypto. The concern was right and the conclusion
was wrong for this case: the alternative on offer was not reviewed crypto, it
was *incorrect* crypto. The implementation is covered by 18 tests including a
full encrypt-then-independently-decrypt round trip and ES256 JWT verification
with `aud`, `sub` and `exp` bounds, and it was confirmed live against a real
push service, which returned `410 Gone` for a fabricated endpoint — a malformed
VAPID signature returns 401 or 403 instead, so the 410 proves both the
encryption and the signature parsed.

## Rejected alternatives

- **`web-push` (npm)** — Node-only; cannot run in the Deno edge runtime.
- **`@negrel/webpush`** — Deno-native and smaller, but the author states the
  crypto has not been reviewed.
- **`@pushforge/builder`** — chosen first, then rejected: wrong content coding
  (see *Reversal*).
- **Hand-rolled ECDH/HKDF** — originally forbidden by the plan; adopted anyway
  once the only maintained Deno alternative proved non-conformant.
- **FCM SDK / APNs directly** — vendor-specific, and the PWA already gives a
  vendor-neutral endpoint.
- **`android.googleapis.com` in the allowlist** — legacy GCM for Chrome < 52.

## Consequences

Push works on Android Chrome and on iOS only for Home Screen web apps (16.4+)
after a user-gesture permission prompt; the console explains that. A new push
vendor host requires an allowlist change in code, on purpose. We now own the
encryption code, so an RFC change is our problem rather than a dependency
bump — the round-trip test is what makes that maintainable.
