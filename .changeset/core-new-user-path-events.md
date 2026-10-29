---
'@mushi-mushi/core': patch
---

- **Six new server events in the analytics vocabulary**: `sdk_seen_localhost`, `sdk_seen_live`, `first_real_report`, `first_diagnosis_viewed`, `first_fix_dispatched` and `first_fix_merged` mark the new-user path, once per project. Only Mushi Mushi's server sends them; nothing changes for apps that call `Mushi.track()`.
