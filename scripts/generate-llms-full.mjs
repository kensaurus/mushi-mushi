#!/usr/bin/env node
/**
 * scripts/generate-llms-full.mjs
 *
 * Generates `apps/docs/public/llms-full.txt` — a single-file dump of every
 * docs page's markdown content suitable for LLM context ingestion — and
 * `apps/docs/public/llms-ctx.txt`, a <50 KB subset for agents with a small
 * context budget.
 *
 * Format mirrors the llmstxt.org spec's "full" variant:
 *   https://llmstxt.org/
 *
 * Differences from `llms.txt` (the link index):
 *   - llms.txt: link list — for agents that want to pick pages
 *   - llms-ctx.txt: the getting-started pages in full, under 50 KB
 *   - llms-full.txt: full prose of every page — for agents that need all
 *     details without follow-up fetches (e.g. offline coding assistants,
 *     retrieval re-rankers, fine-tuning datasets)
 *
 * Page order is deliberate, not alphabetical: getting started, pricing and
 * comparisons first, the admin-console manual last. A plain sort put ~6,000
 * lines of console docs ahead of the pricing page, and agents that read the
 * file top-down (or truncate it) never reached what a new user needs.
 *
 * Also copies each MDX file into `apps/docs/public/llm-md/<path>.md` so the
 * static site serves plain `.md` twins at predictable URLs:
 *   https://kensaur.us/mushi-mushi/docs/llm-md/sdks/web.md
 * The twin directory is rebuilt from scratch on every run, so a renamed or
 * deleted page cannot leave a stale twin behind.
 *
 * Also writes the blog's RSS feed to `apps/docs/public/blog/feed.xml`
 * (scripts/lib/blog-feed.mjs) from the posts' front matter.
 *
 * Usage:
 *   node scripts/generate-llms-full.mjs [--dry-run]
 *
 * Wire into docs build:
 *   "prebuild": "node ../../scripts/generate-llms-full.mjs"
 *   (or call from turbo's dependsOn pipeline)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRssFeed } from './lib/blog-feed.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { mdxToPlainMarkdown } from './lib/mdx-prose.mjs';
import { MUSHI_TAGLINE_V2 } from '../packages/brand/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS_ROOT = join(ROOT, 'apps/docs');
const CONTENT_DIR = join(DOCS_ROOT, 'content');
const PUBLIC_DIR = join(DOCS_ROOT, 'public');
const LLMS_TXT = join(PUBLIC_DIR, 'llms.txt');
const LLMS_FULL_TXT = join(PUBLIC_DIR, 'llms-full.txt');
const LLMS_CTX_TXT = join(PUBLIC_DIR, 'llms-ctx.txt');
const MD_TWINS_DIR = join(PUBLIC_DIR, 'llm-md');
const BLOG_FEED = join(PUBLIC_DIR, 'blog', 'feed.xml');
/** Byline on every post (the posts carry it in their body, not their front matter). */
const BLOG_AUTHOR = 'Kenji Sakuramoto';

const BASE_URL = 'https://kensaur.us/mushi-mushi/docs';
const DRY_RUN = process.argv.includes('--dry-run');

/** Summary line under each file's title: the brand pitch, same as the npm cards and JSON-LD. */
const PITCH = MUSHI_TAGLINE_V2.pitch;

/** Hard ceiling for llms-ctx.txt, in bytes. */
const CTX_BUDGET_BYTES = 50 * 1024;

/**
 * Section order for llms-full.txt. A page's rank is the first prefix its URL
 * path equals or sits under; unmatched pages go between the last listed
 * section and `/admin`, which is always last.
 */
const SECTION_ORDER = [
  '/quickstart/incident-loop',
  '/quickstart/mcp',
  '/quickstart',
  '/pricing',
  '/compare',
  '/use-cases',
  '/concepts',
  '/sdks',
  '/migrations',
  '/plugins',
  '/integrations',
  '/cloud',
  '/self-hosting',
  '/security',
  '/legal',
  '/changelog',
  '/roadmap',
  '/blog',
  '/launch-week',
  '/operating',
];
const LAST_SECTION = '/admin';

/** Pages copied whole into llms-ctx.txt, in order, while they fit the budget. */
const CTX_PAGES = [
  '/quickstart/incident-loop',
  '/quickstart/mcp',
  '/quickstart',
  '/concepts/credentials',
  '/quickstart/react',
  '/quickstart/web',
  '/pricing',
  '/sdks/mcp',
];

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

/** Rank of a URL path in SECTION_ORDER (the landing page `''` ranks first). */
function sectionRank(urlPath) {
  if (urlPath === '') return -1;
  if (urlPath === LAST_SECTION || urlPath.startsWith(`${LAST_SECTION}/`)) return SECTION_ORDER.length + 1;
  const i = SECTION_ORDER.findIndex((p) => urlPath === p || urlPath.startsWith(`${p}/`));
  return i === -1 ? SECTION_ORDER.length : i;
}

/** Section order first; inside a section the index page, then alphabetical. */
function comparePages(a, b) {
  const byRank = sectionRank(a.urlPath) - sectionRank(b.urlPath);
  if (byRank !== 0) return byRank;
  return a.urlPath.localeCompare(b.urlPath);
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

const pages = [];
const missingFromLlmsTxt = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const urlPath = fileToUrlPath(file);
  const fullUrl = `${BASE_URL}${urlPath}`;
  const title = parseFrontmatter(src).data.title || basename(file, '.mdx');
  const prose = mdxToPlainMarkdown(src);

  // Check parity with llms.txt
  if (llmsTxtPaths.size > 0 && !llmsTxtPaths.has(urlPath || '/')) {
    missingFromLlmsTxt.push(`  ${urlPath || '/'} (${file.replace(ROOT, '')})`);
  }

  // md-twin path: content/sdks/web.mdx → llm-md/sdks/web.md
  const relPath = relative(CONTENT_DIR, file).replace(/\\/g, '/').replace(/\.mdx$/, '.md');
  pages.push({
    urlPath,
    relPath,
    prose,
    fullUrl,
    title,
    frontmatter: parseFrontmatter(src).data,
    section: `## ${title}\n\nSource: ${fullUrl}\n\n${prose}`,
  });
}

pages.sort(comparePages);

// ── Write llms-full.txt ───────────────────────────────────────────────────────

const header = `# Mushi Mushi — full documentation dump

> ${PITCH}

Canonical docs: ${BASE_URL}
Generated: ${new Date().toISOString().slice(0, 10)}
Pages: ${files.length}

This file contains the full prose of every documentation page, stripped of
JSX syntax, suitable for offline LLM ingestion. Getting-started pages come
first and the admin-console manual last. For a compact link index see
\`llms.txt\`, and for a <50 KB getting-started subset see \`llms-ctx.txt\`, in
the same directory. Individual pages also served as plain Markdown at
\`${BASE_URL}/llm-md/<path>.md\`.

---

`;

const fullContent = header + pages.map((p) => p.section).join('\n\n---\n\n');

// ── Build llms-ctx.txt ────────────────────────────────────────────────────────

const ctxHeader = `# Mushi Mushi — getting-started context

> ${PITCH}

Canonical docs: ${BASE_URL}

The pages a new user or agent needs first, in full, kept under 50 KB. Every
other page is linked from \`llms.txt\` and included in \`llms-full.txt\`.

---

`;

const byUrl = new Map(pages.map((p) => [p.urlPath || '/', p]));
const ctxSections = [];
let ctxBytes = Buffer.byteLength(ctxHeader, 'utf8');
for (const route of CTX_PAGES) {
  const page = byUrl.get(route);
  if (!page) continue;
  const chunk = (ctxSections.length ? '\n\n---\n\n' : '') + page.section;
  const size = Buffer.byteLength(chunk, 'utf8');
  if (ctxBytes + size > CTX_BUDGET_BYTES) continue;
  ctxSections.push(page.section);
  ctxBytes += size;
}
const ctxContent = `${ctxHeader}${ctxSections.join('\n\n---\n\n')}\n`;

// ── Build blog/feed.xml ───────────────────────────────────────────────────────

const blogIndex = byUrl.get('/blog');
const feedXml = buildRssFeed({
  title: 'Mushi Mushi Blog',
  link: `${BASE_URL}/blog`,
  description: blogIndex?.frontmatter.description ?? 'Notes from building Mushi Mushi.',
  feedUrl: `${BASE_URL}/blog/feed.xml`,
  author: BLOG_AUTHOR,
  posts: pages
    .filter((p) => p.urlPath.startsWith('/blog/'))
    .map((p) => ({
      title: p.title,
      url: p.fullUrl,
      description: p.frontmatter.description,
      date: p.frontmatter.date ?? null,
    })),
});

if (DRY_RUN) {
  console.log(`[dry-run] Would write ${fullContent.length} chars to ${LLMS_FULL_TXT}`);
  console.log(`[dry-run] Would write ${ctxBytes} bytes (${ctxSections.length} pages) to ${LLMS_CTX_TXT}`);
  console.log(`[dry-run] Would write ${pages.length} .md twins to ${MD_TWINS_DIR}`);
  console.log(`[dry-run] Would write ${feedXml.length} chars to ${BLOG_FEED}`);
} else {
  mkdirSync(dirname(BLOG_FEED), { recursive: true });
  writeFileSync(BLOG_FEED, feedXml, 'utf8');
  console.log('✓ Wrote blog/feed.xml');

  writeFileSync(LLMS_FULL_TXT, fullContent, 'utf8');
  console.log(`✓ Wrote llms-full.txt (${Math.round(fullContent.length / 1024)} KB, ${files.length} pages)`);

  writeFileSync(LLMS_CTX_TXT, ctxContent, 'utf8');
  console.log(`✓ Wrote llms-ctx.txt (${Math.round(ctxBytes / 1024)} KB, ${ctxSections.length} pages)`);

  // Rebuild the twins from scratch so renamed / deleted pages leave nothing behind.
  rmSync(MD_TWINS_DIR, { recursive: true, force: true });
  for (const { relPath, prose, fullUrl, title } of pages) {
    const dest = join(MD_TWINS_DIR, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    const content = `# ${title}\n\nSource: ${fullUrl}\n\n${prose}\n`;
    writeFileSync(dest, content, 'utf8');
  }
  console.log(`✓ Wrote ${pages.length} .md twins to public/llm-md/`);
}

// Report parity gaps (informational, non-fatal)
if (missingFromLlmsTxt.length > 0) {
  console.warn(`\n⚠  ${missingFromLlmsTxt.length} MDX files not linked in llms.txt:`);
  missingFromLlmsTxt.slice(0, 10).forEach(l => console.warn(l));
  if (missingFromLlmsTxt.length > 10) {
    console.warn(`  … and ${missingFromLlmsTxt.length - 10} more`);
  }
}
