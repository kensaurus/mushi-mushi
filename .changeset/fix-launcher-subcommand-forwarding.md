---
"mushi-mushi": patch
"@mushi-mushi/cli": minor
---

Fix the unscoped `mushi-mushi` launcher: any non-`init` subcommand (`setup`,
`login`, `status`, ...) is now forwarded verbatim to `@mushi-mushi/cli`
instead of throwing `Unknown flag` on its trailing options or silently
falling through to the init wizard. `npx mushi-mushi setup --ide cursor` —
the headline command in the README and every install guide — now works.

`mushi setup` also triggers the same browser-guided device-auth flow as
`mushi login` inline when no credentials are configured yet, instead of
erroring out and telling the user to run `mushi login` first. `npx
mushi-mushi setup --ide cursor` is now a true one-command onboarding path.
