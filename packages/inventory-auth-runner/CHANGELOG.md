# @mushi-mushi/inventory-auth-runner

## 0.1.4

### Patch Changes

- f5e94ce: npm metadata. The author link on the npm page now points at an account that exists: the maintainer's GitHub profile, instead of a Bluesky handle that was never registered. The Node floor is `>=20.19.0`, the same as `@mushi-mushi/core`. The `funding` field is gone, because it pointed at a GitHub Sponsors page that is not enabled and `npm fund` listed a dead link.

## 0.1.3

### Patch Changes

- 4af54f0: Broaden npm keywords on the packages that had the thinnest discovery surface.

  The flagship packages carry 18–32 keywords; these twelve carried 4–9, which is
  what npm ranks package search on. Each now also carries the tail the
  well-indexed plugins already use (`bug-reporting`, `integration`) plus the
  category terms a reader would actually search for — `error-monitoring` and
  `crash-reporting` on the crash plugins, `chatops` and `alerting` on the chat
  plugins, `issue-tracker` and `issue-sync` on the tracker plugins.

  Metadata only; no runtime change. Keywords reach npm only on publish, so this
  needs a release to take effect.

## 0.1.2

### Patch Changes

- 8544e22: Publish these packages with npm provenance attestations. They were the last four published packages still missing `publishConfig.provenance: true`, so their tarballs shipped without the Sigstore build-provenance signature every other `@mushi-mushi/*` package carries. Adding it brings them in line with the rest of the workspace and lets consumers verify them via `npm audit signatures`. No runtime or API changes.

## 0.1.1

### Patch Changes

- 0c66aa9: Security hardening for the scripted-auth crawler runner.
  - Inline auth scripts now run a `validateInlineAuthScript` deny-list
    before reaching `new Function()`. Blocks `require(`, `import(`,
    `process.`, `eval(`, `Function(`, `child_process`, `fs.`, `net.`,
    `dns.`, `globalThis.process`, and dynamic-property access of these
    globals. Closes a sandbox-escape hole where a customer-supplied script
    could break out of the runner and read service-role secrets from
    `process.env`.
  - `pickSessionCookie` now filters analytics cookies (`_ga`, `_gid`,
    `_fbp`, `_gclid`, `__hssc`, `__hstc`, `__utm*`, `_pin_*`, `_pk_*`)
    from the candidate pool and prefers `httpOnly + secure`. Returns
    `null` when only ambiguous candidates exist (was: silently picked
    the first match), so the runner now declares “no session cookie
    detected” instead of pinning a tracking cookie as the auth proof.

  Adds the first vitest suite for this package (cookie-scoring matrix +
  five sandbox patterns).
