# Known holes in dependencies

Source: https://kensaur.us/mushi-mushi/docs/concepts/known-holes

---
title: Known holes in dependencies
description: Mushi matches the exact versions in your lockfiles and pinned runtimes against published security advisories, and files each one with a fix as a bug with the upgrade to make.
---

# Known holes in dependencies

Your AI agent installed whatever packages it needed, and your app runs on
whatever PHP, Node.js, Python or Go version the template picked. When one of
those versions has a published security hole, that is a bug your users have not
hit yet. Mushi checks for these every day and files each one like any other
bug: in plain English, with the upgrade that fixes it.

## What Mushi checks

Once a day (05:25 UTC), and when you press **Check now** on **App health →
Code**, Mushi reads your primary repo at the head of the default branch:

| What | Files | Matched against |
| --- | --- | --- |
| Packages | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `poetry.lock`, `uv.lock`, pinned `requirements*.txt`, `go.sum` with `go.mod` | [OSV.dev](https://osv.dev) |
| The runtime | `Dockerfile` (`FROM php:8.3.30-fpm`), `.nvmrc`, `.node-version`, `.tool-versions`, `.python-version`, `runtime.txt`, composer `config.platform.php`, go.mod `toolchain` | OSV.dev, plus a hand-kept list for the first days after a release |
| End of life | The same runtime files, including a line such as `FROM node:20` | [endoflife.date](https://endoflife.date) |

Only **exact** versions are matched. A version is exact when a lockfile resolved
it, or when a runtime file pins a full patch version. A range like `^4.17.0` or
`FROM node:20` never matches an advisory; a line like `node:20` can only say that
it no longer gets security fixes. Minimum versions (`engines.node: ">=20"`,
composer `require.php`, `requires-python`, the go.mod `go` line) say what your
code supports, not what it runs, so they are not checked. A repo without a
lockfile gets the end-of-life check only, and the card says so.

Folders named `node_modules`, `vendor`, `fixtures`, `testdata`, `__mocks__` and
`examples` are skipped: what is in them does not ship.

## What becomes a report

A hole becomes a report only when all of these are true:

- the version is installed for production, not only for development;
- the advisory names a fixed version;
- the advisory is not withdrawn or disputed.

Everything else stays on the card and on the radar, so it does not fill your
queue. Mushi files one report per upgrade: three advisories on `lodash 4.17.15`
that `4.17.21` fixes are one report, not three. At most 10 reports are filed
per app per day (change it on the card; **Off** keeps the list without filing).

These reports do **not** count as diagnoses. Mushi writes them from the
advisory data with no AI call. Sending one to an agent goes through the normal
dispatch, caps and [agent PR review](./agent-pr-review).

## How bad is it

| Level | When |
| --- | --- |
| Critical | On [CISA's list](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) of holes attackers already use |
| High | [EPSS](https://www.first.org/epss/) says at least a 10% chance of attack in the next 30 days, or CVSS 9 or more, or the advisory rates it critical |
| Medium | Everything else |
| Low | The advisory rates it low |
| Dev only | Installed for development only: listed, never filed |

If your code imports the package (seen in Mushi's code index), it goes up one
level. Mushi never lowers a level because it could not find an import: the index
is not enough to prove a package unused.

## The fix

The report says exactly what to change:

- **A direct dependency:** change it in `package.json` (or `composer.json`,
  `pyproject.toml`, `go.mod`) and let the package manager rewrite the lockfile.
- **A dependency of a dependency:** add an override (`overrides`,
  `pnpm.overrides`, `resolutions`) that names it. Upgrading the package that
  pulls it in also works, but then a person merges the PR: verified merge only
  trusts a lockfile change whose manifest change names the package.
- **The runtime:** change the pin (the Docker image tag, `.nvmrc`…), rebuild
  and redeploy. For a runtime hole the report also lists the vendor's
  stopgaps, such as the `php.ini` settings PHP published for php2shell.

Lockfiles are never edited by hand. [Verified merge](../admin/verified-merge) lets a
PR change a lockfile only when the same PR changes the manifest that lockfile
comes from, and, for a security report, that manifest change names the
package. A lockfile-only change waits for a person.

Mushi never writes or stores exploit code. The report says so, and the PR review
holds a fix that adds an attack script or payload.

## What leaves Mushi

Only package names and versions, sent to `api.osv.dev`. Mushi stores package
coordinates (ecosystem, name, version, whether it is for development), never a
lockfile: a lockfile can hold private registry URLs with tokens in them. Per-app
findings never appear on a public page.

For a locked-down install, allow these hosts: `api.osv.dev`, `www.cisa.gov`,
`api.first.org`, `endoflife.date` (and `api.github.com`, which Mushi already
uses to read the repo).

## Where to see it

- **Console:** App health → Code → *Known holes in your dependencies*, and the
  filed reports in the normal queue.
- **Editor (MCP):** `get_radar` (rules `known_vulnerable_dependency` and
  `runtime_end_of_life`), `list_gate_findings` with gate
  `portfolio_radar_vulns`, `run_radar` to check again.
- **Terminal:** `mushi radar show`, `mushi audit findings --gate portfolio_radar_vulns`.

## Data sources

Advisories come from [OSV.dev](https://osv.dev), which collects the GitHub
Advisory Database, the PyPI and Go vulnerability databases (each under
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)), Bitnami's runtime
database and others; every finding links its advisory. Exploited-in-the-wild
flags come from CISA's Known Exploited Vulnerabilities catalog (CC0), exploit
likelihood from FIRST's EPSS, and release lines from endoflife.date.

Feeds lag. On 21 October 2026 PHP fixed two remote-code-execution bugs
("php2shell"); OSV had no record of them until the next morning. Mushi keeps a
short hand-kept list of runtime holes for those first days.
