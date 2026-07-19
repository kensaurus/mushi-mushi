#!/usr/bin/env node
/**
 * scripts/generate-llms-full.mjs
 *
 * Generates `apps/docs/public/llms-full.txt` — a single-file dump of every
 * docs page's markdown content suitable for LLM context ingestion.
 *
 * Format mirrors the llmstxt.org spec's "full" variant:
 *   https://llmstxt.org/
 *
 * Differences from `llms.txt` (the link index):
 *   - llms.txt: link list (≈16 KB) — for agents that want to pick pages
 *   - llms-full.txt: full prose (≈500-800 KB) — for agents that need all
 *     details without follow-up fetches (e.g. offline coding assistants,
 *     retrieval re-rankers, fine-tuning datasets)
 *
 * Also copies each MDX file into `apps/docs/public/llm-md/<path>.md` so the
 * static site serves plain `.md` twins at predictable URLs:
 *   https://kensaur.us/mushi-mushi/docs/llm-md/sdks/web.md
 *
 * Usage:
 *   node scripts/generate-llms-full.mjs [--dry-run]
 *
 * Wire into docs build:
 *   "prebuild": "node ../../scripts/generate-llms-full.mjs"
 *   (or call from turbo's dependsOn pipeline)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS_ROOT = join(ROOT, 'apps/docs');
const CONTENT_DIR = join(DOCS_ROOT, 'content');
const PUBLIC_DIR = join(DOCS_ROOT, 'public');
const LLMS_TXT = join(PUBLIC_DIR, 'llms.txt');
const LLMS_FULL_TXT = join(PUBLIC_DIR, 'llms-full.txt');
const MD_TWINS_DIR = join(PUBLIC_DIR, 'llm-md');

const BASE_URL = 'https://kensaur.us/mushi-mushi/docs';
const DRY_RUN = process.argv.includes('--dry-run');

// ── MDX collection ────────────────────────────────────────────────────────────

/**
 * Recursively collect all `.mdx` files under `dir`, sorted by path.
 * Excludes `_meta.ts` / `_meta.js` and index placeholders with no prose.
 */
function collectMdxFiles(dir, results = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectMdxFiles(full, results);
    } else if (entry.endsWith('.mdx') || entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Strip JSX components and import statements from MDX source so the
 * full-text file is plain Markdown that any LLM can read without an
 * MDX parser. We deliberately keep frontmatter (wrapped in `---`) so
 * agents can still extract `title` and other metadata.
 */
function stripMdx(src) {
  return src
    // Remove import / export lines
    .replace(/^import\s.+from\s+['"].+['"]\s*;?\s*$/gm, '')
    .replace(/^export\s+(?:default\s+)?(?:const|function|class)\s.*/gm, '')
    // Remove JSX component open/close tags (e.g. <Callout>, </Callout>)
    .replace(/<\/?\w[\w.]*(?:\s[^>]*)?\s*\/?>/g, '')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract the `title` value from MDX frontmatter.
 */
function extractTitle(src) {
  const m = src.match(/^---\s*\n[\s\S]*?^title:\s*['"]?(.+?)['"]?\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * Derive the docs URL from a file path relative to the content dir.
 *   content/sdks/web.mdx → /sdks/web
 *   content/index.mdx    → (root)
 */
function fileToUrlPath(filePath) {
  let rel = relative(CONTENT_DIR, filePath).replace(/\\/g, '/');
  // Strip extension
  rel = rel.replace(/\.mdx?$/, '');
  // index files → parent path
  rel = rel.replace(/\/index$/, '').replace(/^index$/, '');
  return rel ? `/${rel}` : '';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = collectMdxFiles(CONTENT_DIR);

// Build llms.txt parity set — all URL paths mentioned in the existing llms.txt
let llmsTxtPaths = new Set();
try {
  const existing = readFileSync(LLMS_TXT, 'utf8');
  for (const m of existing.matchAll(/\(https?:\/\/[^)]+\/docs(\/[^)]+)\)/g)) {
    llmsTxtPaths.add(m[1].replace(/\/$/, '') || '/');
  }
} catch {
  // llms.txt may not exist in CI yet; non-fatal
}

const sections = [];
const mdTwinPaths = [];
const missingFromLlmsTxt = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const urlPath = fileToUrlPath(file);
  const fullUrl = `${BASE_URL}${urlPath}`;
  const title = extractTitle(src) ?? basename(file, '.mdx');
  const prose = stripMdx(src);

  // Check parity with llms.txt
  if (llmsTxtPaths.size > 0 && !llmsTxtPaths.has(urlPath || '/')) {
    missingFromLlmsTxt.push(`  ${urlPath || '/'} (${file.replace(ROOT, '')})`);
  }

  sections.push(`## ${title}\n\nSource: ${fullUrl}\n\n${prose}`);

  // Prepare md-twin path: content/sdks/web.mdx → llm-md/sdks/web.md
  const relPath = relative(CONTENT_DIR, file).replace(/\\/g, '/').replace(/\.mdx$/, '.md');
  mdTwinPaths.push({ relPath, prose, fullUrl, title });
}

// ── Write llms-full.txt ───────────────────────────────────────────────────────

const header = `# Mushi Mushi — full documentation dump

> Know why your AI-built app broke — plain-English diagnosis + ready fix, in your editor.

Canonical docs: ${BASE_URL}
Generated: ${new Date().toISOString().slice(0, 10)}
Pages: ${files.length}

This file contains the full prose of every documentation page, stripped of
JSX syntax, suitable for offline LLM ingestion. For a compact link index see
\`llms.txt\` in the same directory. Individual pages also served as plain
Markdown at \`${BASE_URL}/llm-md/<path>.md\`.

---

`;

const fullContent = header + sections.join('\n\n---\n\n');

if (DRY_RUN) {
  console.log(`[dry-run] Would write ${fullContent.length} chars to ${LLMS_FULL_TXT}`);
  console.log(`[dry-run] Would write ${mdTwinPaths.length} .md twins to ${MD_TWINS_DIR}`);
} else {
  writeFileSync(LLMS_FULL_TXT, fullContent, 'utf8');
  console.log(`✓ Wrote llms-full.txt (${Math.round(fullContent.length / 1024)} KB, ${files.length} pages)`);

  // Write md twins
  for (const { relPath, prose, fullUrl, title } of mdTwinPaths) {
    const dest = join(MD_TWINS_DIR, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    const content = `# ${title}\n\nSource: ${fullUrl}\n\n${prose}\n`;
    writeFileSync(dest, content, 'utf8');
  }
  console.log(`✓ Wrote ${mdTwinPaths.length} .md twins to public/llm-md/`);
}

// Report parity gaps (informational, non-fatal)
if (missingFromLlmsTxt.length > 0) {
  console.warn(`\n⚠  ${missingFromLlmsTxt.length} MDX files not linked in llms.txt:`);
  missingFromLlmsTxt.slice(0, 10).forEach(l => console.warn(l));
  if (missingFromLlmsTxt.length > 10) {
    console.warn(`  … and ${missingFromLlmsTxt.length - 10} more`);
  }
}
