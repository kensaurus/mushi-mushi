---
"@mushi-mushi/cli": patch
---

- **The wizard names the entry file your app has.** In a JavaScript React app it said to paste the snippet into `src/main.tsx` even though the file is `src/main.jsx`. It now names the file that exists (`.tsx`, `.jsx`, `.ts` or `.js`), in `--dry-run` too.
