---
'@mushi-mushi/cli': patch
---

- **`mushi doctor` shows the app's Health check**: it reads the same list as the console's "Fix these first" (setup gaps, SDK health, the report button) and prints each problem once, with how many items wait on it and its fix. A check the server could not read shows as not checked, never as a failure. Older servers without the route are skipped.
