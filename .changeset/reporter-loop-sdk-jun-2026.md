---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/cli': minor
'@mushi-mushi/mcp': minor
'@mushi-mushi/mcp-ci': minor
'@mushi-mushi/react-native': minor
'@mushi-mushi/capacitor': minor
---

Reporter two-way loop + fix-merge surface across the SDKs.

## @mushi-mushi/core
- Add reporter verify/reopen API client methods and the `not_fixed` feedback signal to the public types.

## @mushi-mushi/web
- Reporter widget can confirm a fix (verify) or flag a regression (reopen), and opt into email delivery for status updates.

## @mushi-mushi/cli
- New fix-merge lifecycle commands wired to the console merge endpoints.

## @mushi-mushi/mcp
- New MCP tools: `merge_fix`, `refresh_ci`, and `reopen_report`; `transition_status` now covers the `verified` / `reopened` states.

## @mushi-mushi/mcp-ci
- CLI surface updated for the new fix-merge and CI-refresh tools.

## @mushi-mushi/react-native
- Bottom-sheet widget gains reporter verify/reopen actions and notification opt-in.

## @mushi-mushi/capacitor
- Plugin definitions and web bridge updated for the reporter verify/reopen flow.
