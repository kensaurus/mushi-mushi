---
'@mushi-mushi/inventory-auth-runner': patch
---

A `js:./scripts/login.js` login script now loads from your project. The path was imported relative to the runner's own file inside `node_modules`, so it was never found. It now resolves against the folder of your local `inventory.yaml`: `--inventory <path>` or `MUSHI_INVENTORY_FILE`, default `./inventory.yaml` (the working directory). `refresh()` takes the same `inventoryFile` option.
