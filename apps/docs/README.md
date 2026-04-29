# @mushi-mushi/docs

Mushi Mushi documentation site — Nextra v4 on Next.js 15 (App Router),
statically exported and hosted at `kensaur.us/mushi-mushi/docs/`.

## Tech stack

- Next.js 15 + React 19 (App Router, `output: 'export'`)
- Nextra v4 (`nextra-theme-docs`) — sidebar / TOC / search
- Tailwind v4 — for our custom MDX components only; the Nextra theme ships
  its own `x:`-prefixed Tailwind layer untouched
- MDX-first content under `content/`, with a catch-all route at
  `app/[[...mdxPath]]/page.tsx` that hands every URL back to Nextra

## Getting started

```bash
cd apps/docs
pnpm dev          # http://localhost:3000 (Next default)
pnpm build        # produces ./out/ (static export)
pnpm start        # serves the built site on http://localhost:3001
pnpm typecheck
```

## Layout

```
apps/docs/
├── app/
│   ├── layout.tsx                # Nextra theme + globals.css
│   ├── globals.css               # Tailwind v4 entry (see "Styling")
│   └── [[...mdxPath]]/page.tsx   # Nextra catch-all route
├── components/
│   ├── Playground.tsx            # interactive code playground for SDK demos
│   ├── MigrationHub.tsx          # filterable + searchable guide grid
│   ├── MigrationChecklist.tsx    # per-step interactive checklist
│   └── MigrationBadges.tsx       # <EffortBadge /> + <RiskBadge />
├── content/                      # all docs MDX
│   ├── _meta.ts                  # top-level sidebar order
│   ├── migrations/               # the Migration Hub
│   │   ├── _catalog.ts           # SINGLE source of truth for guide metadata
│   │   ├── _meta.ts              # sidebar order for /migrations/*
│   │   ├── index.mdx             # renders <MigrationHub guides={CATALOG} />
│   │   └── *.mdx                 # 14 guides (mobile, web, competitor, SDK)
│   ├── quickstart/   sdks/   admin/   concepts/   plugins/
│   ├── security/   self-hosting/   changelog.mdx   roadmap.mdx
│   └── index.mdx
├── mdx-components.tsx            # registers Playground + Migration* globally
└── postcss.config.mjs            # @tailwindcss/postcss
```

## Styling

Nextra v4 already ships Tailwind under an `x:` prefix for its theme. Our
custom components (`MigrationHub`, `MigrationChecklist`, badges) need
**unprefixed** Tailwind. We give them their own pipeline:

```css
/* app/globals.css */
@import 'tailwindcss';
@import 'nextra-theme-docs/style.css';

@variant dark (&:where(.dark *));

@source "../components/**/*.{ts,tsx}";
@source "../content/**/*.{md,mdx}";
@source "../mdx-components.tsx";
```

`app/layout.tsx` imports `globals.css` instead of `nextra-theme-docs/style.css`
directly so the cascade order (Tailwind base → Nextra theme) stays stable.

## Migration Hub

`/migrations` is a generative hub backed by a single catalog and a few
interactive primitives. Adding a new guide is a 3-step contribution:

1. Append an entry to `content/migrations/_catalog.ts` (slug, title,
   summary, category, effort, risk, status, optional `detectPackages`).
2. Add the entry to `content/migrations/_meta.ts` so it shows up in the
   sidebar in the right category.
3. Create `content/migrations/<slug>.mdx`. Drop in a `<MigrationChecklist
   id="..." steps={[...]} />` near the bottom.

**What the catalog drives:**

- The `<MigrationHub />` grid (filter chips + free-text search +
  effort / risk badges per card).
- The CLI's `mushi migrate` subcommand, which reads the same catalog shape
  via `packages/cli/src/migrate.ts` and only ever surfaces `status:
  'published'` entries (pinned by `migrate.test.ts`).

**Status field** — `'published'` shows up everywhere; `'draft'` stays
hidden from both the hub grid and the CLI suggestions until promoted.

### Cross-device checklist sync (Phase 2, opt-in)

`MigrationChecklist` is **anonymous-first**: progress lives in
`localStorage` under `mushi:migration:<slug>` and never blocks on the
network. A logged-in user can opt into cross-device sync via the
`SyncCta` footer (renders only after at least one step is checked, so
empty pages stay calm).

Sync flow:

1. The footer's **Sign in to sync** button calls `openAdminAuthBridge()`
   (`apps/docs/lib/migrationProgress.ts`) which `window.open()`s the
   admin console at `/docs-bridge?nonce=<random>&returnOrigin=<docs>`.
2. The admin's `DocsBridgePage` runs through `ProtectedRoute`, then
   `postMessage`s `{ type: 'mushi:docs-bridge:token', nonce, accessToken,
   apiUrl, projectId, expiresAt, ... }` back to the docs popup opener.
   Docs verifies `event.origin` against an allowlist + matches the nonce
   before trusting the token.
3. Docs holds the JWT in `sessionStorage` only — **never** a refresh
   token. From there, `mergeProgress()` runs a local-wins union against
   `GET /v1/admin/migrations/progress?guide_slug=<slug>` and pushes
   updates via `PUT /v1/admin/migrations/progress/:guide_slug`.

Merge policy: **local wins for unsynced checked steps**; remote can only
add missing completed steps. A local check is never silently undone by
the server.

The `apps/docs/lib/migrationProgress.ts` module exports `mergeProgress`,
`openAdminAuthBridge`, `getProgress`, `putProgress`, `deleteProgress`,
`readSession`, and `clearSession`. The `apiUrl` returned by the bridge
points at the Edge Function origin so the docs don't need to know
Supabase project URLs at build time.

## Editorial conventions

- One `<Callout type="info">` "Coming from X?" banner near the top of any
  quickstart / SDK page that has a corresponding migration guide.
- Code blocks default to fenced markdown; use `filename="..."` for any
  example longer than ~10 lines.
- For curly-brace text inside `<code>` JSX (e.g. `{ category: 'feedback' }`),
  wrap in a template literal — `` <code>{`{ category: 'feedback' }`}</code> ``
  — or MDX will try to parse it as an expression.
- `_meta.ts` link entries use Nextra's `linkSchema` (strict): only
  `title`, `href`, and `theme` keys are accepted. `newWindow` is **not** a
  supported key and will trip a Zod validation error at build time.

## Build gotchas

- The catch-all `app/[[...mdxPath]]/page.tsx` is required for Nextra v4
  to discover content; without it `next build` only emits `404.html`.
- `next.config.mjs` defaults to `output: 'export'` (set
  `MUSHI_DOCS_EXPORT=0` to opt out for dev previews). The `basePath` is
  driven by `MUSHI_BASE_PATH` at build time so the same source builds for
  local dev (no prefix), `docs.mushimushi.dev` (no prefix), and
  `kensaur.us/mushi-mushi/docs` (`MUSHI_BASE_PATH=/mushi-mushi/docs`).
- Stale `_meta.ts.bak` files in `content/` will crash the dev server with
  "Unknown module type" — delete them.
