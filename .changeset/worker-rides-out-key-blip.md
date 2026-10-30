---
'@mushi-mushi/cli': patch
---

- **`mushi work --daemon` rides out a server blip**: a single 401 on its key no longer stops the worker for good. It stops when the key is refused on 3 heartbeats in a row, or at once on an explicit revoke (a 403 naming a revoke or a missing scope). On 2026-10-30 a one-second server error was read as "key revoked", and the worker stayed offline for 11 hours because its service does not restart after exit code 2.
