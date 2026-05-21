# @mushi-mushi/inventory-auth-runner

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
