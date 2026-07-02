---
"@mushi-mushi/mcp": patch
---

Default `MUSHI_API_ENDPOINT` to the hosted Mushi Cloud endpoint when unset,
matching what the README, the registry `server.json`, the CLI
(`resolveCloudEndpoint`), `@mushi-mushi/node`, and the VS Code extension
already document and do. Previously a zero-config `npx @mushi-mushi/mcp`
booted with an empty endpoint and logged "MUSHI_API_ENDPOINT is not set.
All tool calls will fail." — visible in external introspection harnesses
(e.g. Glama's Dockerfile test instance logs) and a real footgun for cloud
users. Self-hosted deployments still override via `MUSHI_API_ENDPOINT`.

Also handle `EPIPE` on stdout: when the client closes the read end of the
pipe mid-write (crash / kill / `head`-style consumers), the server now
shuts down quietly instead of dying with an unhandled `EPIPE` stack trace.
