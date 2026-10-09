---
"@mushi-mushi/mcp": patch
"@mushi-mushi/cli": patch
---

The stdio MCP server now checks what its API key may do when it starts. With an SDK key (report:write), which can send bug reports but not read them, it serves setup mode and says how to mint an MCP key, instead of listing tools that all answer INSUFFICIENT_SCOPE. A read-only key (mcp:read) no longer lists the write tools. `MUSHI_SCOPES` still sets the upper bound, and if the check fails (offline, older server) nothing changes. `mushi whoami` prints the key's scopes and warns when it is an SDK key.
