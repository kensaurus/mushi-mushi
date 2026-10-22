---
"@mushi-mushi/cli": patch
---

`mushi project create` still writes the same `.env.local`, `.cursor/mcp.json`, and saved CLI config. Those writes now go through one helper so the unit tests can check the merge.
