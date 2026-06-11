# Kenji Table Registry

**Supabase project:** `kenji` (ref: `jghcferpoaqntpfqvayf`, region: ap-northeast-1 small)

The `kenji` database is shared across six applications. This document maps table
prefixes to owning applications and repositories so the backend-drift-scanner and
Gate 7/8 (orphan endpoint / unknown call) can enforce per-app boundaries.

> **Decision (Jun 2026):** The kenji DB was intentionally kept as a single shared project
> rather than split, so existing `auth.users` linkages are preserved. Each app registers
> as its own mushi project pointing `supabase_project_ref = jghcferpoaqntpfqvayf`.

---

## Prefix → App → Repository Map

| Table prefix | Application | Repo path | Mushi project ID |
|---|---|---|---|
| `hhtp_*` | **Help Her Take Photo** | `C:\Users\kensa\Documents\GitHub\help-her-take-photo` | _(create via mushi console)_ |
| `twm_*` | **The Wanting Mind** | `C:\Users\kensa\Documents\GitHub\the-wanting-mind` | _(create via mushi console)_ |
| `babuu_*` | **Babuu AI** | `C:\Users\kensa\Documents\GitHub\babuu-ai` | _(create via mushi console)_ |
| `pf_*` | **Project Flow** | `C:\Users\kensa\Documents\GitHub\project-flow` | _(create via mushi console)_ |
| `skin_*` | **Skin Analysis** | `C:\Users\kensa\Documents\GitHub\skin-analysis` | _(create via mushi console)_ |
| `wr_*` | **Wedding Reception** | `C:\Users\kensa\Documents\GitHub\wedding-reception-202511` | _(create via mushi console)_ |

Shared tables (no prefix or `auth.*`): `auth.users`, `auth.sessions`, any tables without
a prefix are considered shared infrastructure and reviewed manually.

---

## Setup Checklist (per app)

For each of the 6 apps:

1. **Create a mushi project** via the admin console → Projects → New Project.
   - Set `crawler_base_url` to the deployed URL.
   - Set `github_repo_url` to the GitHub repo.
   - Set `supabase_project_ref = jghcferpoaqntpfqvayf`.

2. **Install the SDK** in the app repo:
   ```bash
   npx mushi-mushi
   ```
   Wire `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` via env vars (`.env.local` or CI secrets).
   Never commit API keys.

3. **Add BYOK Supabase PAT** once (shared across all 6 projects since they point to the
   same kenji ref):
   - Admin console → Settings → API Keys → Add key → slug: `supabase`.
   - Use a fine-grained read-only PAT generated at
     [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

4. **Seed `inventory.yaml`** with DbDep entries scoped to the app's table prefix:
   ```yaml
   # Example for help-her-take-photo (prefix: hhtp_)
   db_deps:
     - label: "hhtp_*"
       description: "All tables owned by the Help Her Take Photo app"
       prefix: "hhtp_"
   ```
   Use `mushi stories map --url <deployed-url> --wait` to auto-propose stories.

5. **Run db-advisors** once linked: Admin → Project → DB Advisors card.
   Fix any `ERROR`-level findings (RLS disabled, missing indexes) on `hhtp_*` tables.

---

## RLS Hygiene Notes

Since all apps share `auth.users`, RLS policies on prefixed tables **must** use
project-specific column checks or stored context (e.g. `current_setting('app.tenant_id')`)
to avoid cross-app data leakage. The mushi backend-drift-scanner flags any new table
addition without RLS as an `error`-severity gate finding.

**Action items identified during initial advisor run (Jun 2026):**
_(Fill in after running db-advisors on the kenji project via Admin → DB Advisors)_

- [ ] Verify all `hhtp_*` tables have RLS enabled
- [ ] Verify all `twm_*` tables have RLS enabled
- [ ] Verify all `babuu_*` tables have RLS enabled
- [ ] Verify all `pf_*` tables have RLS enabled
- [ ] Verify all `skin_*` tables have RLS enabled
- [ ] Verify all `wr_*` tables have RLS enabled
- [ ] Add `idx_<prefix>_user_id` indexes on foreign-key columns for RLS performance

---

## Backend-Drift-Scanner Configuration

The `backend-drift-scanner` runs daily at 03:05 UTC and checks all projects with
`supabase_project_ref` set. Since all 6 kenji apps point to the same ref, the scanner
will see the same tables for all 6. Gate findings are tagged by `project_id` so
each app's dashboard shows its own subset (filtered by DbDep prefix declarations).

To see schema snapshots: Admin → Full-Stack Audit → Backend linked.
