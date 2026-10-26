---
'@mushi-mushi/inventory-auth-runner': patch
---

`refresh` now finds the scripted login where the inventory schema puts it, `app.auth`. It read a top-level `auth` that the schema never produces, so every real `inventory.yaml` failed with "no auth.scripted block". The README and docs examples now show `auth` inside `app`.
