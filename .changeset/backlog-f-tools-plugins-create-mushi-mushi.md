---
"create-mushi-mushi": patch
---

- `--template` starters now include a `.gitignore` that ignores `.env` files, `node_modules` and `dist`, so the API key that `npx mushi-mushi` writes is not committed by accident.
- The Node starter now declares `engines.node >= 20.6`, the first version with `--env-file`.
