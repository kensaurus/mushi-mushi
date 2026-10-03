---
'@mushi-mushi/cli': patch
---

`mushi recipe init` reads monorepos properly: it ignores token files in tests, fixtures and examples, scans `apps/*/src` and `packages/*/src`, finds a nested `supabase/migrations`, takes the default branch from `origin/HEAD` instead of assuming `main`, and tags deploy, publish and release workflows as `deploy`.
