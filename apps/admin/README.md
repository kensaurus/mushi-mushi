# @mushi/admin

Admin console for Mushi Mushi — report triage, analytics dashboard, knowledge graph visualization, and project settings.

## Tech Stack

- React 19 + React Router 7
- Tailwind CSS v4 (CSS-first `@theme` tokens)
- Vite 6
- Supabase Auth

## Development

```bash
cd apps/admin
cp .env.example .env    # Fill in Supabase credentials
pnpm dev                # Starts on http://localhost:6464
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `VITE_API_URL` | No | Override API base URL (defaults to Supabase functions) |

## Design System

Tokens are defined in `src/index.css` using Tailwind v4's `@theme` directive. Shared UI primitives live in `src/components/ui.tsx`. Color maps and status tokens are in `src/lib/tokens.ts`.

### Surface hierarchy

`surface-root` (sidebar) → `surface` (main bg) → `surface-raised` (cards) → `surface-overlay` (hover)

### Semantic colors

`brand` (amber), `accent` (violet), `ok` (green), `warn` (amber), `danger` (red), `info` (blue)

## Pages

| Route | Page |
|-------|------|
| `/` | Dashboard — stat cards, category/severity breakdowns |
| `/reports` | Filterable report list |
| `/reports/:id` | Report detail — triage, LLM classification, environment, logs |
| `/graph` | Knowledge graph visualization |
| `/judge` | LLM self-improvement scores |
| `/query` | Natural language data queries |
| `/fixes` | Auto-fix pipeline status |
| `/projects` | Project management + API keys |
| `/integrations` | Jira, Linear, GitHub, PagerDuty |
| `/sso` | SAML/OIDC configuration |
| `/audit` | Audit log with CSV export |
| `/fine-tuning` | LLM fine-tuning jobs |
| `/settings` | Project configuration |

## License

See root [LICENSE](../../LICENSE).
