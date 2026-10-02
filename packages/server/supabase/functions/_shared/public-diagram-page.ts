/**
 * FILE: packages/server/supabase/functions/_shared/public-diagram-page.ts
 * PURPOSE: The crawlable public page and its Markdown twin for a published
 *          architecture diagram (Plan 020 §10.3.3): one static HTML file and
 *          one `.md` file per repo, written next to the docs export when the
 *          owner publishes and deleted when they unpublish.
 *
 * Why static files: the docs site is a static export (no per-repo HTML at
 * build time for repos published later), and Supabase Edge Functions rewrite
 * `text/html` responses to `text/plain`, so neither can serve this page. The
 * HTML here needs no JavaScript: the diagram is server-rendered SVG whose
 * parts link to the code on GitHub at the published commit, the parts are
 * listed as text for crawlers and answer engines, and a link opens the
 * interactive view on the docs site.
 *
 * Content is exactly the published payload (names, descriptions, valid
 * paths, connections, the commit), the same thing the owner previewed.
 * Every string is escaped. Pure: no I/O, no Deno globals.
 */

import type { PublicDiagramPayload } from './repo-diagram.ts'

const SITE = 'https://kensaur.us/mushi-mushi'
const NODE_W = 220
const NODE_H = 64
/** docs/adr/0015: the product inbox. */
const REPORT_EMAIL = 'kensaurus@gmail.com'

export interface PublicPageUrls {
  page: string
  markdown: string
  interactive: string
  github: string
  signup: string
  reportMailto: string
  badgeImage: string
}

/** S3 keys (lowercase, the CloudFront router lowercases the path to match). */
export function publicPageKeys(owner: string, repo: string): { html: string; markdown: string } {
  const base = `mushi-mushi/r/${owner.toLowerCase()}/${repo.toLowerCase()}`
  return { html: `${base}.html`, markdown: `${base}.md` }
}

export function publicPageUrls(owner: string, repo: string, sha: string): PublicPageUrls {
  const page = `${SITE}/r/${owner}/${repo}`
  const subject = `Wrong or unwanted diagram: ${owner}/${repo}`
  const body = `Page: ${page}\nCommit: ${sha}\n\nWhat is wrong, or why it should not be public:\n`
  const tag = `diagram:${owner}/${repo}`.replace(/[^A-Za-z0-9._:\-/]/g, '').slice(0, 64)
  return {
    page,
    markdown: `${page}.md`,
    interactive: `${SITE}/docs/r?repo=${encodeURIComponent(`${owner}/${repo}`)}`,
    github: `https://github.com/${owner}/${repo}`,
    signup: `${SITE}/admin/signup?src=${encodeURIComponent(tag)}`,
    reportMailto: `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    badgeImage: 'https://img.shields.io/badge/architecture-diagram-c2410c',
  }
}

/** A README badge that links to the public page. */
export function diagramBadgeMarkdown(owner: string, repo: string): string {
  const u = publicPageUrls(owner, repo, '')
  return `[![Architecture diagram](${u.badgeImage})](${u.page})`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Markdown inline text: escape the characters that would change structure. */
function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]<>|#])/g, '\\$1').replace(/\r?\n/g, ' ')
}

function treeUrl(owner: string, repo: string, sha: string, path: string): string {
  return `https://github.com/${owner}/${repo}/tree/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`
}

function canvasSize(d: PublicDiagramPayload): { width: number; height: number } {
  let w = 0
  let h = 0
  for (const g of d.groups) {
    w = Math.max(w, g.x + g.w)
    h = Math.max(h, g.y + g.h)
  }
  for (const n of d.nodes) {
    w = Math.max(w, n.x + NODE_W)
    h = Math.max(h, n.y + NODE_H)
  }
  return { width: w + 32, height: h + 32 }
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const sy = from.y + NODE_H / 2
  const ty = to.y + NODE_H / 2
  if (Math.abs(from.x - to.x) < 1) {
    const x = from.x + NODE_W
    return `M ${x} ${sy} C ${x + 48} ${sy}, ${x + 48} ${ty}, ${x} ${ty}`
  }
  const forward = to.x > from.x
  const sx = forward ? from.x + NODE_W : from.x
  const tx = forward ? to.x : to.x + NODE_W
  const mid = (sx + tx) / 2
  return `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** One sentence for <meta name="description"> and social cards, ≤ 160 chars. */
export function publicPageDescription(d: PublicDiagramPayload): string {
  const groups = d.groups.map((g) => g.label).join(', ')
  return clip(
    `Architecture of ${d.owner}/${d.repo}: ${d.nodes.length} parts in ${d.groups.length} groups (${groups}). Drawn by AI from commit ${d.sha.slice(0, 7)}.`,
    160,
  )
}

function svg(d: PublicDiagramPayload): string {
  const size = canvasSize(d)
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="-16 -16 ${size.width} ${size.height}" role="img" aria-labelledby="diagram-title">`,
    `<title id="diagram-title">${escapeHtml(`Architecture diagram of ${d.owner}/${d.repo}`)}</title>`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="arrow"/></marker></defs>',
  )
  for (const g of d.groups) {
    parts.push(
      `<g><rect class="group" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="8"/>`,
      `<text class="group-label" x="${g.x + 12}" y="${g.y + 22}">${escapeHtml(g.label.toUpperCase())}</text></g>`,
    )
  }
  for (const e of d.edges) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (!from || !to) continue
    parts.push(`<path class="edge" d="${edgePath(from, to)}" marker-end="url(#arrow)"><title>${escapeHtml(`${from.label} → ${to.label}${e.label ? ` (${e.label})` : ''}`)}</title></path>`)
  }
  for (const n of d.nodes) {
    const label = escapeHtml(clip(n.label, 28))
    const path = escapeHtml(n.path ? (n.path.length > 34 ? `…${n.path.slice(-33)}` : n.path) : '—')
    const inner = [
      `<rect class="node" x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="4"/>`,
      `<text class="node-label" x="${n.x + 10}" y="${n.y + 26}">${label}</text>`,
      `<text class="node-path" x="${n.x + 10}" y="${n.y + 46}">${path}</text>`,
      `<title>${escapeHtml(n.description || n.label)}</title>`,
    ].join('')
    parts.push(n.path ? `<a href="${escapeHtml(treeUrl(d.owner, d.repo, d.sha, n.path))}">${inner}</a>` : `<g>${inner}</g>`)
  }
  parts.push('</svg>')
  return parts.join('\n')
}

const STYLE = `
:root{color-scheme:light dark;--paper:#faf7f2;--wash:#f3eee5;--ink:#1c1917;--muted:#57534e;--rule:#d6d3d1;--accent:#c2410c}
@media (prefers-color-scheme:dark){:root{--paper:#1c1917;--wash:#14110f;--ink:#f5f5f4;--muted:#a8a29e;--rule:#44403c;--accent:#fb923c}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:72rem;margin:0 auto;padding:2.5rem 1rem}h1{font-size:1.9rem;margin:0 0 .5rem}h2{font-size:1.2rem;margin:2rem 0 .75rem}
a{color:var(--accent)}p.meta{color:var(--muted);margin:.25rem 0}.canvas{overflow-x:auto;border:1px solid var(--rule);border-radius:8px;background:var(--wash);margin-top:1.5rem}
svg .group{fill:var(--paper);stroke:var(--rule)}svg .group-label{fill:var(--muted);font-size:11px;font-weight:600}
svg .node{fill:var(--paper);stroke:var(--rule)}svg a:hover .node,svg a:focus .node{stroke:var(--accent);stroke-width:2}
svg .node-label{fill:var(--ink);font-size:13px;font-weight:600}svg .node-path{fill:var(--muted);font-size:10px;font-family:ui-monospace,monospace}
svg .edge{fill:none;stroke:var(--muted);stroke-opacity:.5;stroke-width:1.25}svg .arrow{fill:var(--muted)}
ul.parts{list-style:none;padding:0;margin:0;display:grid;gap:.75rem}ul.parts li{border:1px solid var(--rule);border-radius:6px;padding:.6rem .8rem}
code{font-family:ui-monospace,monospace;font-size:.85em}.group-name{color:var(--muted);font-size:.85rem}footer{border-top:1px solid var(--rule);margin-top:2.5rem;padding-top:1rem;color:var(--muted)}
`

export function renderPublicDiagramHtml(d: PublicDiagramPayload): string {
  const u = publicPageUrls(d.owner, d.repo, d.sha)
  const title = `${d.owner}/${d.repo} architecture diagram · Mushi`
  const description = publicPageDescription(d)
  const groupLabel = new Map(d.groups.map((g) => [g.id, g.label]))
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  const drawnOn = new Date(d.generated_at)
  const drawnText = Number.isFinite(drawnOn.getTime()) ? drawnOn.toISOString().slice(0, 10) : ''
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: `${d.owner}/${d.repo}`,
    codeRepository: u.github,
    url: u.page,
    description,
    version: d.sha,
    ...(drawnText ? { dateModified: drawnText } : {}),
    hasPart: d.nodes.map((n) => ({
      '@type': 'SoftwareSourceCode',
      name: n.label,
      ...(n.description ? { description: n.description } : {}),
      ...(n.path ? { codeRepository: treeUrl(d.owner, d.repo, d.sha, n.path) } : {}),
    })),
  }
  // `</` inside JSON-LD would end the script element early.
  const jsonLdText = JSON.stringify(jsonLd).replace(/</g, '\\u003c')

  const partsList = d.nodes
    .map((n) => {
      const path = n.path
        ? ` <a href="${escapeHtml(treeUrl(d.owner, d.repo, d.sha, n.path))}"><code>${escapeHtml(n.path)}</code></a>`
        : ''
      const desc = n.description ? `<div>${escapeHtml(n.description)}</div>` : ''
      return `<li><strong>${escapeHtml(n.label)}</strong> <span class="group-name">· ${escapeHtml(groupLabel.get(n.group) ?? n.group)}</span>${path}${desc}</li>`
    })
    .join('\n')
  const connections = d.edges
    .map((e) => {
      const from = byId.get(e.from)?.label ?? e.from
      const to = byId.get(e.to)?.label ?? e.to
      return `<li>${escapeHtml(from)} → ${escapeHtml(to)}${e.label ? ` <span class="group-name">(${escapeHtml(e.label)})</span>` : ''}</li>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${escapeHtml(u.page)}">
<link rel="alternate" type="text/markdown" href="${escapeHtml(u.markdown)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(u.page)}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${jsonLdText}</script>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(`${d.owner}/${d.repo}`)}</h1>
<p class="meta">Architecture drawn by AI from commit <a href="${escapeHtml(`${u.github}/tree/${d.sha}`)}"><code>${escapeHtml(d.sha.slice(0, 7))}</code></a>${drawnText ? ` on ${escapeHtml(drawnText)}` : ''}. Every file path was checked against the repo at that commit. It can still be wrong about what a part does.</p>
<p class="meta"><a href="${escapeHtml(u.interactive)}">Open the interactive view</a> · <a href="${escapeHtml(u.markdown)}">Markdown</a> · <a href="${escapeHtml(u.reportMailto)}">Report a wrong or unwanted diagram</a></p>
<div class="canvas">
${svg(d)}
</div>
<h2>Parts</h2>
<ul class="parts">
${partsList}
</ul>
${connections ? `<h2>Connections</h2>\n<ul>\n${connections}\n</ul>` : ''}
<footer>
<p>Made with Mushi: when something in your app breaks, Mushi tells you why in plain English, with the fix ready to go.</p>
<p><a href="${escapeHtml(u.signup)}">Get a diagram and plain-English bug fixes for your own app →</a></p>
</footer>
</main>
</body>
</html>
`
}

/** The `.md` twin: the same content for agents and answer engines. */
export function renderPublicDiagramMarkdown(d: PublicDiagramPayload): string {
  const u = publicPageUrls(d.owner, d.repo, d.sha)
  const groupLabel = new Map(d.groups.map((g) => [g.id, g.label]))
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  const lines = [
    `# ${escapeMd(`${d.owner}/${d.repo}`)}: architecture`,
    '',
    `Drawn by AI from commit \`${d.sha}\`. Every file path was checked against the repo at that commit; descriptions can still be wrong.`,
    '',
    `- Page: ${u.page}`,
    `- Repository: ${u.github}`,
    '',
    '## Parts',
    '',
    '| Part | Group | Path | What it does |',
    '| --- | --- | --- | --- |',
    ...d.nodes.map(
      (n) =>
        `| ${escapeMd(n.label)} | ${escapeMd(groupLabel.get(n.group) ?? n.group)} | ${n.path ? `[\`${n.path.replace(/`/g, '')}\`](${treeUrl(d.owner, d.repo, d.sha, n.path)})` : ''} | ${escapeMd(n.description)} |`,
    ),
  ]
  if (d.edges.length > 0) {
    lines.push('', '## Connections', '')
    for (const e of d.edges) {
      lines.push(`- ${escapeMd(byId.get(e.from)?.label ?? e.from)} → ${escapeMd(byId.get(e.to)?.label ?? e.to)}${e.label ? ` (${escapeMd(e.label)})` : ''}`)
    }
  }
  lines.push('', `Made with Mushi: ${SITE}/`, '')
  return lines.join('\n')
}
