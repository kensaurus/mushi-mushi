/**
 * Shared favicon resolution helpers for admin console and SDK widget.
 */

export interface ProjectFaviconSource {
  project_id: string;
  project_name: string;
  project_slug: string;
  /** Operator override — wins over inferred domain when set. */
  icon_url?: string | null;
  /** e.g. https://kensaur.us — from SDK heartbeat or API key last_seen_origin */
  sdk_origin?: string | null;
  /** Connected GitHub/GitLab repo — used when SDK has not heartbeated yet. */
  repo_url?: string | null;
}

/**
 * Hosts that serve many dogfood apps under one favicon — skip for icon lookup
 * so we prefer slug/repo-specific domains or initials instead of one shared globe.
 */
const MULTI_TENANT_PARENT_HOSTS = new Set(['kensaur.us', 'www.kensaur.us']);

/**
 * Slug → canonical production domain. Use app-specific TLDs, not shared parents.
 * Native-only apps (yen-yen) intentionally omitted — initials fallback is clearer.
 */
const SLUG_DOMAIN_HINTS: Record<string, string> = {
  'glot-it': 'glot.it',
  glotit: 'glot.it',
  'solo-boss-cloud': 'sbc-front.vercel.app',
  'mushi-mushi': 'mushimushi.dev',
};

/**
 * Verified absolute favicon URLs for dogfood projects whose TLD blocks /favicon.*
 * or serves a shared parent icon. Playwright-checked Jun 2026.
 */
const SLUG_ICON_URL_HINTS: Record<string, string> = {
  'mushi-mushi': 'https://kensaur.us/mushi-mushi/admin/favicon.svg',
  'solo-boss-cloud': 'https://sbc-front.vercel.app/favicon.svg',
  'glot-it': 'https://kensaur.us/glot-it/apple-touch-icon.png',
  glotit: 'https://kensaur.us/glot-it/apple-touch-icon.png',
};

/** Third-party favicon CDNs — return HTTP 200 generic globes; never use as fallbacks. */
const UNTRUSTED_FAVICON_HOSTS = [
  'www.google.com',
  'icons.duckduckgo.com',
  'icon.horse',
] as const;

export function isUntrustedFaviconUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return UNTRUSTED_FAVICON_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Per-domain favicon URLs — first-party assets only (no CDN globes). */
export function faviconUrlCandidates(domain: string, _size = 32): string[] {
  return [
    `https://${domain}/favicon.svg`,
    `https://${domain}/favicon.ico`,
    `https://${domain}/favicon-32x32.png`,
    `https://${domain}/apple-touch-icon.png`,
  ];
}

/** Ordered unique domains to try for a project (most specific first). */
export function resolveProjectFaviconDomains(source: ProjectFaviconSource): string[] {
  const out: string[] = [];
  const add = (d: string | null | undefined) => {
    const n = d?.trim().toLowerCase();
    if (!n || out.includes(n)) return;
    out.push(n);
  };

  add(githubRepoDomainHint(source.repo_url));
  add(SLUG_DOMAIN_HINTS[source.project_slug.toLowerCase()]);

  const fromOrigin = source.sdk_origin ? originToDomain(source.sdk_origin) : null;
  if (fromOrigin && !MULTI_TENANT_PARENT_HOSTS.has(fromOrigin)) {
    add(fromOrigin);
  }

  return out;
}

/** Flat URL list across all candidate domains for a project. */
export function projectFaviconUrlCandidates(source: ProjectFaviconSource, size = 32): string[] {
  if (source.icon_url?.trim()) return [source.icon_url.trim()];
  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (url: string) => {
    if (!url || seen.has(url) || isUntrustedFaviconUrl(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const slugHint = SLUG_ICON_URL_HINTS[source.project_slug.toLowerCase()];
  if (slugHint) push(slugHint);

  for (const domain of resolveProjectFaviconDomains(source)) {
    for (const url of faviconUrlCandidates(domain, size)) {
      push(url);
    }
  }
  return urls;
}

export function originToDomain(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) return null;
  if (/^(capacitor|file|content|app):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

/** Derive a production hostname from a connected repo URL when possible. */
export function githubRepoDomainHint(repoUrl: string | null | undefined): string | null {
  if (!repoUrl?.trim()) return null;
  try {
    const u = new URL(repoUrl.trim());
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts[1]!.replace(/\.git$/i, '').toLowerCase();

    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(repo)) return repo;

    if (host === 'github.com' && repo.endsWith('.github.io')) return repo;

    if (host !== 'github.com' && host !== 'www.github.com') return host;

    return null;
  } catch {
    return null;
  }
}

/** Best single domain — first entry from {@link resolveProjectFaviconDomains}. */
export function resolveProjectDomain(source: ProjectFaviconSource): string | null {
  return resolveProjectFaviconDomains(source)[0] ?? null;
}

/**
 * Google's favicon CDN returns HTTP 200 with a gray globe when it has no icon.
 * Treat low-saturation loaded images as "miss" so callers try the next URL or initials.
 */
export function isLikelyGenericFavicon(img: HTMLImageElement): boolean {
  if (typeof document === 'undefined') return false;
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return false;

  try {
    const canvas = document.createElement('canvas');
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    let opaque = 0;
    let satSum = 0;
    let maxDiff = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 128) continue;
      opaque++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const diff = max - min;
      maxDiff = Math.max(maxDiff, diff);
      satSum += diff;
    }
    if (opaque === 0) return true;
    const avgSat = satSum / opaque;
    return avgSat < 14 && maxDiff < 24;
  } catch {
    // Cross-origin CDN images taint the canvas — treat as untrusted generic globe.
    return isUntrustedFaviconUrl(img.src);
  }
}

/** Two-letter initials for favicon fallback chips. */
export function projectInitials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  const compact = name.replace(/[^a-zA-Z0-9]/g, '');
  return (compact.slice(0, 2) || name.slice(0, 2) || '?').toUpperCase();
}

const INITIALS_CHIP_THEMES = [
  'info',
  'brand',
  'warn',
  'ok',
  'accent',
] as const;

/** Stable theme index (0–4) for initials chip coloring. */
export function projectInitialsThemeIndex(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash + projectId.charCodeAt(i)) % INITIALS_CHIP_THEMES.length;
  }
  return hash;
}

/**
 * Read the host page favicon href (web SDK only).
 *
 * Security: the host page declares this value, so it could be a `data:`,
 * `blob:`, or `javascript:` URL. Since the result is rendered into an
 * `<img src>` inside the widget, only same-trust http(s) (and protocol-relative)
 * URLs are returned; anything else falls back to `null` so the widget renders
 * its default mark instead of an unvalidated, host-controlled resource.
 */
export function readPageFaviconHref(): string | null {
  if (typeof document === 'undefined') return null;
  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ];
  for (const sel of selectors) {
    const link = document.querySelector<HTMLLinkElement>(sel);
    const href = link?.href;
    if (href && isSafeFaviconHref(href)) return href;
  }
  return null;
}

/** Allow only http(s) favicon URLs — reject data:/blob:/javascript: etc. */
function isSafeFaviconHref(href: string): boolean {
  try {
    // `link.href` is already resolved to an absolute URL by the DOM; parse with a
    // base for safety in case a raw attribute value is ever passed in.
    const base = typeof location !== 'undefined' ? location.href : undefined;
    const protocol = new URL(href, base).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
