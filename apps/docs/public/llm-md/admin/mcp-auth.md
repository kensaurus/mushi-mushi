# MCP OAuth consent

Source: https://kensaur.us/mushi-mushi/docs/admin/mcp-auth

---
title: MCP OAuth consent
description: The consent page the hosted Mushi Mushi MCP server opens when your editor signs in over OAuth, what you approve, and how the authorization flow works.
---

# MCP OAuth consent

**Route:** `/mcp-auth?txn=`

> **Scenario:** You ran `claude mcp login mushi` (or Cursor / VS Code MCP auth).
> The hosted MCP redirected your browser here to approve access.

The page is titled **Connect an MCP client**. It is the OAuth consent step for MCP
clients of the hosted Mushi Mushi MCP server (MCP auth spec):

1. Hosted MCP `/oauth/authorize` records a pending transaction and 302s here.
2. Page loads `GET /v1/mcp-oauth/request?txn=…`: client name + requested access.
3. Under **Projects this connection can reach**, pick **All my projects** (the default),
   **Only the projects I pick**, or **One project** (one you own or administer).
4. **Approve connection** → `POST /v1/mcp-oauth/approve` mints a revocable key and
   redirects to the client callback with the authorization code. **Deny** sends the
   client a refusal (`POST /v1/mcp-oauth/deny`).

What the key is:

- **One project**: a project API key labelled `mcp-oauth`; revoke it from the project's
  keys.
- **All my projects / Only the projects I pick**: an account key labelled
  `mcp-oauth-`; revoke it from **MCP → Account keys**. In each project it can do
  only what your role there allows.

Sibling flow for the CLI: [CLI device auth](/admin/cli-auth) (`mushi login`).

## Related pages

- [MCP](/admin/mcp): tool catalogue and deeplink install
- [Connect hub](/admin/connect): one-click MCP lane without OAuth
- [CLI device auth](/admin/cli-auth): terminal login approval
