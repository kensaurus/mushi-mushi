---
"@mushi-mushi/svelte": patch
"@mushi-mushi/vue": patch
"@mushi-mushi/angular": patch
---

Fix the CommonJS entry point. `package.json` `"main"` now points at `./dist/index.cjs` (the CJS build) instead of `./dist/index.js` (the ESM build), so `require('@mushi-mushi/svelte' | '/vue' | '/angular')` loads the correct bundle instead of throwing on the ESM `export` syntax.
