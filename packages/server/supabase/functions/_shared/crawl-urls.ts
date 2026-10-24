/**
 * FILE: crawl-urls.ts
 * PURPOSE: Pick which mapped URLs a live crawl scrapes. A Firecrawl map of a
 *          multilingual app returned the same pages once per language
 *          (/en/preface, /ja/preface, /zh/preface, …) plus sitemap.xml, so a
 *          15-page crawl of the-wanting-mind covered about four screens
 *          (2026-10-10). Files are skipped and each page is kept once.
 *          Markdown and text mirrors (/docs/intro.md beside /docs/intro)
 *          are the same page and are not scraped (lets-talk, 2026-10-24).
 *          Pages are taken round-robin across the first path segment so one
 *          section (solo-boss /docs) cannot fill the budget.
 */

/** Language prefixes the apps use; a two-letter route outside this list is kept. */
const LOCALES = new Set([
  'en', 'ja', 'zh', 'th', 'ko', 'vi', 'id', 'ms', 'tl', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'nl',
  'ru', 'uk', 'pl', 'tr', 'ar', 'he', 'sv', 'da', 'no', 'nb', 'fi', 'cs',
  'zh-cn', 'zh-tw', 'zh-hk', 'zh-hans', 'zh-hant', 'pt-br', 'en-us', 'en-gb', 'es-mx',
]);

const FILE_RE = /\.(?:xml|json|pdf|png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|zip|webmanifest)$/i;
/** Rendered-page mirrors. Canonicalized onto the page, then dropped. */
const MIRROR_RE = /\.(?:md|txt)$/i;

interface Candidate {
  url: string;
  key: string;
  /** 0 = no language prefix, 1 = English, 2 = another language. */
  rank: number;
  mirror: boolean;
}

function candidate(link: string, base: URL, basePath: string): Candidate | null {
  let u: URL;
  try {
    u = new URL(link, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // "www.example.com" and "example.com" are one site: a user who typed the
  // apex for a site served from www got a 1-page crawl (review 2026-10-10).
  const sameSite = (h: string) => h.toLowerCase().replace(/^www\./, '');
  if (sameSite(u.host) !== sameSite(base.host)) return null;
  const path = u.pathname.replace(/\/+$/, '') || '/';
  if (basePath && path !== basePath && !path.startsWith(`${basePath}/`)) return null;
  if (FILE_RE.test(path)) return null;

  // /privacy, /privacy.html, and /privacy.md are one page.
  const mirror = MIRROR_RE.test(path);
  const rest = path.slice(basePath.length).replace(/\.(?:html?|md|txt)$/i, '');
  const segments = rest.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();
  const locale = first && LOCALES.has(first) ? first : null;
  const pageSegments = locale ? segments.slice(1) : segments;
  return {
    url: u.origin + u.pathname + u.search,
    key: `/${pageSegments.join('/')}${u.search}`,
    rank: locale === null ? 0 : locale.startsWith('en') ? 1 : 2,
    mirror,
  };
}

function prefer(next: Candidate, prev: Candidate): boolean {
  if (next.mirror !== prev.mirror) return !next.mirror;
  return next.rank < prev.rank;
}

/**
 * Up to `maxPages` URLs, one per page. The start URL is first. For a page
 * found in several languages, the unprefixed or English copy is kept.
 * `.md` / `.txt` mirrors are not scraped. Remaining pages are round-robin
 * across the first path segment so one section cannot fill the budget.
 */
export function pickCrawlUrls(links: string[], baseUrl: string, maxPages: number): string[] {
  const cap = Math.max(1, maxPages);
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const best = new Map<string, Candidate>();
  for (const link of [baseUrl, ...links]) {
    const c = candidate(link, base, basePath);
    if (!c) continue;
    const seen = best.get(c.key);
    // Map keeps first-insertion order, so a better copy keeps its page's place.
    if (!seen || prefer(c, seen)) best.set(c.key, c);
  }

  const sections: string[] = [];
  const buckets = new Map<string, Candidate[]>();
  for (const c of best.values()) {
    if (c.mirror) continue;
    const section = c.key.split('/').filter(Boolean)[0] ?? '';
    let bucket = buckets.get(section);
    if (!bucket) {
      bucket = [];
      buckets.set(section, bucket);
      sections.push(section);
    }
    bucket.push(c);
  }

  const picked: string[] = [];
  while (picked.length < cap) {
    let took = false;
    for (const section of sections) {
      const next = buckets.get(section)!.shift();
      if (!next) continue;
      took = true;
      picked.push(next.url);
      if (picked.length >= cap) break;
    }
    if (!took) break;
  }
  return picked;
}
