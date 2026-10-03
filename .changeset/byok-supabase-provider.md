---
"@mushi-mushi/mcp": patch
"@mushi-mushi/cli": patch
---

`add_byok_key` and `mushi keys add --provider` accept `supabase`: a scoped, read-only Supabase access token (`sbp_…`) for the project's linked Supabase project. The server checks it with a read-only query against `supabase_project_ref`, so set the ref first (console Settings → General → Supabase project). `mushi audit` and `run_fullstack_audit` now name the real console paths for both steps.
