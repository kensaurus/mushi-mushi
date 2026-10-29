# Docs bridge

Source: https://kensaur.us/mushi-mushi/docs/admin/docs-bridge

---
title: Docs bridge
description: The docs bridge is the Mushi Mushi console's sign-in relay that lets the docs site sync your migration checklist progress, after you click Allow.
---

# Docs bridge

**Route:** `/docs-bridge`

The docs bridge is a sign-in relay between the Mushi Mushi console and the documentation
site (`kensaur.us/mushi-mushi/docs`). The docs use it to sync your migration checklist
progress (the Migration Hub) with your account, without asking you to sign in again.

You will never navigate here directly. The docs site opens `/docs-bridge` in a popup,
you confirm, the bridge posts a short-lived token back, and the popup closes.

---

## How it works

1. The docs site opens `kensaur.us/mushi-mushi/admin/docs-bridge?nonce=<one-time-nonce>&returnOrigin=<docs-origin>` as a popup.
2. If you are not signed in to the console, you go through the login page first and
   come back here.
3. The bridge checks that `nonce` is present and that `returnOrigin` is on the allowlist.
4. It asks: **Sign in to the docs as** *your email*? Nothing is sent until you click
   **Allow**. **Cancel** sends nothing.
5. After **Allow**, it reads your current session and posts a message to the opener at the
   exact `returnOrigin` (never `*`). The message holds the short-lived access token (never
   the refresh token), its expiry, your email, the active project and organization, and the
   API URL.
6. The popup closes itself 500 ms later. The docs site checks the origin, nonce and
   message type, then keeps the token in `sessionStorage`, so the docs session ends with
   the tab.

---

## Status messages

| Status | Meaning |
|--------|---------|
| **Connecting your Mushi account to the docs…** | Reading the session |
| **Docs sign-in** | Waiting for you to click **Allow** or **Cancel** |
| **Cancelled** | You clicked Cancel; the docs did not get your sign-in |
| **Docs sync connected** | Token posted; your checklist progress will sync |
| Sign in first | No session in this browser; sign in to the console, then reopen from the docs |
| Missing nonce | The `?nonce=` parameter was absent; close the window and try again from the docs |
| Not on the allowlist | `returnOrigin` is not an allowed docs origin; this is a safety check |
| Can't talk back | The opener window is gone; reopen the bridge from the docs site |

---

## Security

- `returnOrigin` must be on the allowlist (`VITE_DOCS_ORIGIN_ALLOWLIST` on self-hosted
  consoles). Local docs origins are allowed only when the console itself runs locally.
- Nothing is posted without an explicit **Allow** click.
- The `nonce` is a one-time value from the docs site, sent back unchanged so the docs can
  match the reply to its request.
- Only the short-lived access token is forwarded, never the refresh token.

---

## Related pages

- [Manage apps](/admin/projects): if you need a persistent API key for scripts or CI, generate one there instead
- [Editor agents](/admin/mcp): for AI assistant integrations that need API access
