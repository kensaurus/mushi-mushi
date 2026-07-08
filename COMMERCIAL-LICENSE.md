# Mushi Mushi — Commercial License (dual licensing)

<!--
  FILE: COMMERCIAL-LICENSE.md
  PURPOSE: Describe the optional commercial license alongside the AGPLv3 server.
  OVERVIEW: Mushi uses AGPL-native open-core + commercial dual licensing (Grafana
            / Mattermost pattern). The server is genuinely open source under AGPLv3;
            this document explains when and how to obtain a commercial license.
  USAGE: Link from README, open-source.mdx, and sales inquiries.
-->

Mushi Mushi is **dual-licensed** for the server packages (`@mushi-mushi/server`,
`@mushi-mushi/agents`, `@mushi-mushi/verify`):

| License | Who it's for | What you get |
| ------- | ------------ | ------------ |
| **[AGPLv3](./packages/server/LICENSE)** (default) | Self-hosters, tinkerers, teams running Mushi for their own org | True OSI open source. Self-host free. Modify and run. If you offer a **modified** version as a network service, publish your changes (§13). |
| **Commercial license** (this document) | Companies offering Mushi (or a derivative) as a **hosted service to third parties** without AGPL copyleft obligations | A separate license from the copyright holder that replaces AGPL terms for the licensed use case. |

The **SDK packages remain MIT** — embed them in proprietary apps with zero copyleft
obligations. The commercial license applies to the **server**, not the widget.

## When you need a commercial license

You **do not** need one if you:

- Self-host Mushi for your own team or product (AGPLv3 covers this).
- Use **Mushi Cloud** at `kensaur.us/mushi-mushi/` (we operate under our license).
- Embed the MIT SDK in your app and send reports to your own Mushi instance.

You **may** want one if you:

- Run a **modified** Mushi server as a multi-tenant SaaS and cannot publish your
  server changes under AGPL.
- Need a **legal team's non-copyleft** alternative to AGPL for internal policy reasons
  (uncommon for self-host-only use — the MIT SDK split already handles embed scenarios).

Enterprise Edition features (`packages/server/ee/` — SSO, audit export, retention
CRUD, region pinning, SOC 2 evidence) are **separately licensed**. Production use
requires an Enterprise subscription or `MUSHI_EE_LICENSE_KEY`. See
[`packages/server/ee/README.md`](./packages/server/ee/README.md).

## How to obtain a commercial license

Contact **security@kensaur.us** with:

- Your company name and use case (self-host vs hosted SaaS vs OEM)
- Whether you need EE features
- Expected diagnosis volume (helps us quote fairly)

We typically respond within a few business days. Pricing is separate from Mushi
Cloud Indie/Pro subscriptions — this path is for **license-only** needs.

## Reference implementations

This model follows the same pattern as [Grafana Labs licensing](https://grafana.com/licensing/)
(AGPL core + commercial license for SaaS modifiers) and Mattermost (AGPL + commercial
alternative).

---

*This document is not legal advice. The AGPLv3 text in `packages/server/LICENSE`
is the authoritative open-source license.*
