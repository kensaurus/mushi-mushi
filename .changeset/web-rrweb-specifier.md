---
"@mushi-mushi/web": patch
---

Vite apps without `rrweb` installed no longer fail to load the SDK. Vite's dependency pre-bundle folded the SDK's optional rrweb lookup into a literal `import("rrweb")`, so the dev server answered "Failed to resolve import \"rrweb\"" on 1.31.0. The lookup now stays a runtime import, and replay falls back to click capture as documented.
