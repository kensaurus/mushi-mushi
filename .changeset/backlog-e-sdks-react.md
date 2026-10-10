---
"@mushi-mushi/react": patch
---

`<MushiProvider config>` is typed `MushiInitConfig`, so it accepts partial config (for example `{ widget: {...} }`) when env vars supply `projectId` and `apiKey`.
