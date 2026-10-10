---
"@mushi-mushi/cli": patch
---

- `mushi project create` no longer overwrites `.env.local` when the existing file can't be read (permissions, I/O errors); it now stops with the error and leaves your other variables untouched.
- `mushi doctor --host-app` now recognises hash route templates written as `'/#/…'` and stops warning that none are configured.
- `mushi nudge --max` now rejects a fractional value instead of writing it into the generated snippet.
- A trailing slash on `MUSHI_API_ENDPOINT` no longer produces double-slash API URLs that miss their routes.
- A blank `MUSHI_API_ENDPOINT` no longer sends `mushi project create` and `mushi init` to Mushi Cloud; they fall through to the endpoint saved with `mushi config endpoint`.
