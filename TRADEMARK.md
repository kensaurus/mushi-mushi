# Mushi Mushi Trademark Policy

> _Last updated: May 2026 — version 1.0_

## TL;DR

The **code** in this repository is open source under MIT (SDKs / CLI /
adapters / brand) and BSL 1.1 (server / agents / verify, see
`packages/server/LICENSE`). The **brand** is not.

If you fork this project, build a derivative product, or run a public
service from it, you **must rename it** and remove the Mushi Mushi name,
logo, and visual identity from anything end users see.

This document explains what that means in practice and how to ask for
permission for the few cases where you might want to use the marks.

## What's covered

The following are the unregistered trademarks of Kenji Sakuramoto
("the Trademark Owner"):

| Mark                                          | Type       |
| --------------------------------------------- | ---------- |
| **Mushi Mushi**                               | word mark  |
| **Mushi**                                     | word mark  |
| **虫** (the kanji used standalone)            | word mark  |
| The Mushi Mushi bug logo (any color variant)  | logo mark  |
| The "Sentry catches what your code throws…"   | trade dress|
| tagline + adjacent visual identity            |            |
| `mushi-mushi.dev`, `mushimushi.dev`,          | domain     |
| `kensaur.us/mushi-mushi/*`                    | identity   |

Trademarks are property rights independent of copyright. The MIT and BSL
1.1 licenses both grant rights to the **software**; neither grants rights
to the **trademarks**. This is normal — Mozilla, Apache, Linux, Postgres,
Redis, Elasticsearch and most other major projects do the same.

## What you may do without asking

You may, without separate permission:

1. **Refer to Mushi Mushi by name** in articles, blog posts, docs,
   comparison pages, conference talks, social media, books, training
   materials, and academic papers — provided the use is descriptive,
   accurate, and does not imply endorsement or sponsorship that does not
   exist.
2. **Link to this repository** and use the project name in `package.json`
   `dependencies`, `Cargo.toml`, `go.mod`, etc.
3. **Use the unmodified logo** in articles, slides, or talks _about_ Mushi
   Mushi. Do not stretch, recolor, or composite it with other logos in a
   way that suggests a partnership.
4. **Build and publish add-ons, plugins, integrations, or compatible
   tools** (e.g. `acme-mushi-import`, `mushi-for-vscode`) — provided the
   add-on name makes the secondary status clear (using "for", "by", or
   "compatible with" is fine; using "Mushi" as the dominant name is not).
5. **Run an unmodified self-hosted instance** for your organization's
   internal use under the BSL 1.1 Additional Use Grant.

## What you may not do

The following uses are **not permitted** without prior written
authorization from the Trademark Owner:

1. **Renaming a fork while keeping the Mushi Mushi brand** — if you
   distribute a modified version, you must remove the marks (name, logo,
   tagline, color identity) before distribution. Acceptable: "Acme
   Telemetry, fork of Mushi Mushi". Not acceptable: "Mushi Pro by Acme".
2. **Running a hosted or managed service that uses the Mushi Mushi name,
   logo, or visual identity** to attract users (whether paid, free, or
   freemium). This is true _even if_ your service is built on an
   unmodified copy.
3. **Using the marks on or in association with malware, phishing kits,
   credential stealers, ransomware, illegal surveillance tools, or any
   service that violates third-party terms of service** (including
   scraping operations against vendors whose webhooks Mushi consumes).
   This use is treated as bad-faith infringement and will be enforced
   against under the Lanham Act and applicable foreign trademark law.
4. **Registering a domain, npm scope, GitHub organization, social media
   handle, app-store listing, or company name** that includes "mushi",
   "mushimushi", "mushi-mushi", "虫", or any confusingly similar string,
   if the registration is intended to associate that resource with
   bug-reporting / observability software.
5. **Using the marks in a way that could mislead a reasonable user into
   thinking your product is the official Mushi Mushi product**, is
   endorsed by the project, or is a "Pro" or "Enterprise" tier of it.
6. **Using the Mushi Mushi name on merchandise** (t-shirts, stickers,
   mugs, etc.) for sale.

## Why we have this policy

Mushi Mushi is a small, single-maintainer open source project. The MIT
and BSL 1.1 licenses are deliberately permissive on the code so the
ecosystem can grow. The trademarks exist for one reason only: so end
users can trust that "Mushi Mushi" means the upstream project, with the
upstream project's security posture, supply-chain controls, and bug-fix
loop.

A bad actor can take this code under MIT and ship a malicious binary —
that is the nature of open source. They cannot legally ship that
malicious binary _under the Mushi Mushi name_. That is the line this
policy draws.

## Enforcement

The Trademark Owner reserves the right to enforce these marks. Most
disputes are resolved by a polite email and a one-line rename. We do not
go after good-faith forks; we do go after impersonators, typo-squatters,
and projects that use the name to legitimize harmful software.

## Asking for permission

If you have a use case that this policy does not clearly cover, or if
you would like permission for a use that is otherwise not permitted,
email **kensaurus@gmail.com** with the subject line
`[Mushi Mushi trademark]`. Please include:

- The exact mark you want to use
- Where it will appear
- For how long
- A mockup if visual

We aim to reply within seven days.

## Future changes

This policy can be updated at any time, but no update will retroactively
strip rights granted under it: if you complied with version `N` at the
time of distribution, you remain in good standing for that distribution
even after version `N+1` is published.

## Acknowledgments

This policy is heavily influenced by the
[Mozilla Trademark Policy](https://www.mozilla.org/about/legal/trademarks/),
the [Linux Foundation Trademark Usage Guidelines](https://linuxfoundation.org/trademark-usage),
and the [Model Trademark Guidelines](https://modeltrademarkguidelines.org/).
Where this policy and those policies disagree, this policy controls.
