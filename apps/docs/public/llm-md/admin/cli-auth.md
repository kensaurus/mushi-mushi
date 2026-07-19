# CLI device auth

Source: https://kensaur.us/mushi-mushi/docs/admin/cli-auth

---
title: CLI device auth
---

# CLI device auth

**Route:** `/cli-auth?code=XXXX-XXXX`

> **Scenario:** You ran `mushi login` in a terminal. The CLI opened this page
> so you can approve the device code while signed into the console.

RFC 8628 device authorization grant for the CLI:

1. CLI starts `POST /v1/cli/auth/device/start` and opens this URL with the user code.
2. Sign in to the console if needed (`ProtectedRoute` returns you here).
3. Review the 3-step guide — **do not paste the code into your terminal**.
4. **Approve** → `POST /v1/cli/auth/device/approve`.
5. The page polls `GET /v1/cli/auth/device/status` until the CLI claims the token
   (`cli_token_claimed_at`), then shows **CLI connected**.

Operator deep-dive: [SDK reliability overhaul](https://github.com/kensaurus/mushi-mushi/blob/master/docs/operators/sdk-reliability-overhaul.md) · public guide: [CLI ↔ console loop](/quickstart/cli-console-loop).

## Related pages

- [Connect hub](/admin/connect) — install CLI + MCP after login
- [Setup Copilot](/admin/setup-copilot) — verify ingest after the CLI is wired
