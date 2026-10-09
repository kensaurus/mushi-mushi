---
"@mushi-mushi/cli": patch
---

`mushi selfhost up` now runs the Supabase CLI without a shell, so each flag value (including the keys you pass) reaches it as one argument and is never interpreted by the shell. A failed step now reports the CLI's own error output instead of a message that embedded the full command line.
