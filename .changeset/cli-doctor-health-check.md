---
'@mushi-mushi/cli': patch
---

- **`mushi doctor` shows the app's Health check**: it reads the server's Health check (setup gaps, SDK health, the report button) and prints each problem once as a warning, with how many items wait on it and its fix. It does not change whether `mushi doctor` passes. A check the server could not read shows as not checked. Older servers without the route are skipped.
