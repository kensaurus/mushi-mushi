---
"@mushi-mushi/cli": patch
---

`mushi project create` no longer overwrites `.env.local` when the existing file can't be read (permissions, I/O errors); it now stops with the error and leaves your other variables untouched.
