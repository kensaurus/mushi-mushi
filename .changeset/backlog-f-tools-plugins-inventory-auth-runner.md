---
"@mushi-mushi/inventory-auth-runner": patch
---

- `auth-bootstrap` now reads the inventory from the API's `{ snapshot }` envelope, so it no longer always fails with "no `auth.scripted` block"; a project without a current inventory gets a clear error instead.
