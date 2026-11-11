---
'@mushi-mushi/mcp': patch
---

Add Lovable to the client registry (`MCP_CLIENTS`): a keyless entry for Lovable's custom MCP connector, with the hosted OAuth URL and the steps to add it. `McpClientDef.keyless` marks a client that signs in with OAuth, so the console mints no key for it.
