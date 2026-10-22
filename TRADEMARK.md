# Mushi Mushi Trademark Policy

> _Last updated: October 2026 — version 1.1_

## TL;DR

The **code** in this repository is open source: MIT for the SDKs, CLI,
MCP server, plugins, adapters and the code and tokens in `packages/brand`;
AGPL-3.0-only for the server (`packages/server`, `packages/agents`,
`packages/verify`) and the console (`apps/admin`); a source-available
Enterprise Edition license for `packages/server/ee/`. The root
[`LICENSE`](./LICENSE) states the split. The **brand** is not open source:
no license in this repository covers the Mushi Mushi name, logo or marks.

If you fork this project, build a derivative product, or run a public
service from it, you **must rename it** and remove the Mushi Mushi name,
logo, and visual identity from anything end users see.

This document explains what that means in practice and how to ask for
permission for the few cases where you might want to use the marks.

## What's covered

The following are trademarks of Kenji Sakuramoto / Kensaurus 合同会社
("the Trademark Owner"). **They are not registered.** No registration has
issued in any country; the Trademark Owner plans to apply in Japan first
and then extend abroad. When an application or registration exists, this
page will list its number. Until then they are unregistered marks, protected
only as far as the law protects unregistered marks where you are.

| Mark                                          | Type       |
| --------------------------------------------- | ---------- |
| **Mushi Mushi**                               | word mark  |
| **Mushi**                                     | word mark  |
| **虫** (the kanji used standalone)            | word mark  |
| The Mushi Mushi bug logo (any color variant)  | logo mark  |
| The tagline "Your AI wrote it. Mushi tells you why it broke." + adjacent visual identity | trade dress |
| `mushi-mushi.dev`, `mushimushi.dev`,          | domain     |
| `kensaur.us/mushi-mushi/*`                    | identity   |

Trademarks are property rights independent of copyright. The MIT,
AGPL-3.0 and Enterprise Edition licenses grant rights to the **software**;
none of them grants rights to the **trademarks**. The logo and mark image
files (`packages/brand/src/logo*`, the favicons and app icons, the mascot
art in `docs/mascot/`) are also not licensed for copying beyond what this
policy allows: they are all rights reserved. This is normal — Mozilla, Apache, Linux, Postgres,
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
5. **Self-host Mushi for your own organization and keep the name** on
   that instance, modified or not, as long as only your organization uses
   it. The AGPL already lets you run and change the code; this item lets
   you keep calling your internal instance "Mushi". Once people outside
   your organization use it, "What you may not do" applies.

## Using the logo

The logo files live in [`packages/brand/src/`](./packages/brand/src/)
(`logo.svg`, `logo-dark.svg`, `logo-wide.svg`, `logo-mark.svg`,
`logo-mark-512.png`). You may use them without asking when all of these hold:

- **You are referring or linking to Mushi Mushi**: an article, a talk, a
  "Works with Mushi Mushi" note in your README, an integrations page that
  lists Mushi beside other tools, or a link to this repository or the docs.
- **The file is unmodified**: no recoloring beyond the light and dark
  variants provided, no stretching, cropping, animation, or combining it
  with your own logo.
- **It is not your identity**: not your app icon, favicon, product logo,
  social avatar, or part of your product or company name.
- **It does not suggest endorsement or partnership** that does not exist.

Forks of the server or the console (`apps/admin`) must replace the
favicons, app icons and logo before anyone outside their own organization
sees them. Anything else, such as merchandise, co-branding, or a modified
mark, needs written permission (see "Asking for permission").

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
   against under applicable trademark and unfair-competition law.
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
and AGPL-3.0 licenses are deliberately open on the code so the ecosystem
can grow. The trademarks exist for one reason only: so end
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
