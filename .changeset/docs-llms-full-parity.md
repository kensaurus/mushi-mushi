---
"@mushi-mushi/docs": patch
---

LLM docs parity (Phase 5):

- **`scripts/generate-llms-full.mjs`** — build-time generator that produces `apps/docs/public/llms-full.txt` (655 KB, 188 pages of inlined prose, stripped of JSX/imports) and `apps/docs/public/llm-md/<path>.md` plain-markdown twins for every MDX content file. Follows the llmstxt.org "full" spec variant.
- **Prebuild hook** — wired into `apps/docs` `prebuild` script so the files are always regenerated before `next build`.
- **16 parity tests** in `apps/docs/lib/llms-parity.test.ts` — validates that `llms.txt`, `llms-full.txt`, and the MDX tree stay in sync (page counts match, all llms.txt slugs appear in the full dump, .md twins exist and have expected headers).
