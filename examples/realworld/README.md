# RealWorld (Conduit) dogfood fixtures

Full-stack Conduit fixture matrix proving the Mushi capture → ingest → MCP
fix-loop against the [RealWorld spec](https://realworld-docs.netlify.app/)'s
realistic behaviors. See [ATTRIBUTION.md](./ATTRIBUTION.md) and
`docs/execplans/realworld-attunement.md` for the gap analysis this closes.

| Fixture | Router | SDK | Port |
|---|---|---|---|
| `backend-express/` | — | `@mushi-mushi/node` | 4101 |
| `frontend-react-vite/` | history/path (React Router-style) | `@mushi-mushi/react` | 4102 |
| `frontend-hash/` | hash (`#/login`, `#/article/:slug`) | `@mushi-mushi/web` | 4103 |

Both frontends target the local Express fixture (never the public demo API) so
runs are deterministic and exercise the node SDK too.

## Running

```bash
MUSHI_REALWORLD=1 pnpm e2e:realworld        # boots all three + runs the journey
```

By default the journey runs hermetically: a local ingest stub
(`tests/ingest-stub.mjs`) accepts the SDKs' report POSTs and the assertions run
against what actually left the wire. Point `MUSHI_REALWORLD_ENDPOINT` /
`MUSHI_REALWORLD_PROJECT_ID` / `MUSHI_REALWORLD_API_KEY` at a real Mushi
project to ingest for real; the MCP dogfood step
(`get_recent_reports` → `get_report_detail` → `get_fix_context` →
`run_nl_query`) runs whenever `MUSHI_PROJECT_ID`/`MUSHI_API_KEY` are set.
