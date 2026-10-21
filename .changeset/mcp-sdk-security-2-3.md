---
"@mushi-mushi/mcp": patch
---

Require `@modelcontextprotocol/server` and `@modelcontextprotocol/core` 2.3.1 or later. Versions below 2.3.0 have two high-severity advisories: a shared transport or server could deliver one HTTP client's messages to another (GHSA-jm63-cq47-j5jp), and one request within the default size limit could exhaust memory during validation.
