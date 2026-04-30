/**
 * FILE: cloudfront-mushi-docs-response.js
 * PURPOSE: CloudFront Function (viewer-response) for the docs site at
 *          /mushi-mushi/docs/*. Adds security headers and synthesizes a
 *          brand-aligned editorial 404 body so missing pages don't surface
 *          the raw S3 `NoSuchKey` XML.
 *
 * BACKGROUND:
 * - The previous version only flipped the status to 404 but left the S3
 *   error XML body in place — visitors saw "<Error><Code>NoSuchKey</Code>…"
 *   which looks broken and leaks the bucket layout.
 * - CloudFront Functions can fully replace a response body up to 40KB.
 *   The function-code limit is 10KB; the editorial HTML below is ~2.6KB
 *   so we have room for the surrounding logic.
 * - Status stays 404 for SEO so search engines don't index broken paths
 *   as live pages (no soft-404 redirect to /404.html).
 *
 * PAGE-vs-ASSET DETECTION:
 * - The companion router function appends `.html` to extension-less paths,
 *   so by the time a request reaches the response stage, page routes end
 *   in `.html` and real assets end in something else (.js / .css / .png /
 *   .json / .woff2 / .svg / .txt). The regex below excludes `.html`
 *   explicitly so page 404s get the editorial body and asset 404s pass
 *   through (lets the browser fail fast on a missing `_next` chunk).
 *
 * ASSOCIATIONS:
 * - Attached to the `/mushi-mushi/docs/*` cache behavior (S3 origin) on
 *   viewer-response. Republished by deploy-docs.yml on every docs deploy.
 */

// Editorial 404 body. Inlined here (rather than fetched from S3) so the
// function returns in a single round-trip and the visitor never sees the
// S3 NoSuchKey XML even for the briefest flash. Tokens mirror
// packages/brand/src/editorial.css so the standalone HTML matches the
// rest of the site's brand language without depending on an external CSS
// fetch (which would be one more failure mode in an error path).
var FALLBACK_404_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta name="robots" content="noindex">',
  '<title>404 — Mushi Mushi docs</title>',
  '<link rel="icon" type="image/svg+xml" href="/mushi-mushi/docs/favicon.svg">',
  '<style>',
  ':root{--paper:#f8f4ed;--ink:#211f1c;--mute:#6b665c;--rule:rgba(33,31,28,0.10);--vermillion:#e03c2c;}',
  '@media (prefers-color-scheme:dark){:root{--paper:#0d0c0a;--ink:#ece6d6;--mute:#948c7c;--rule:rgba(242,235,221,0.12);}}',
  '*,*::before,*::after{box-sizing:border-box}',
  'html,body{margin:0;padding:0}',
  'body{min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);',
  'font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;padding:2.5rem 1.5rem;}',
  'main{max-width:38rem;width:100%}',
  '.eyebrow{font:700 .7rem/1 ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;letter-spacing:.22em;',
  'text-transform:uppercase;color:var(--mute);display:inline-flex;align-items:center;gap:.65rem;margin:0 0 1.5rem;}',
  '.eyebrow::before{content:"";width:.45rem;height:.45rem;border-radius:999px;background:var(--vermillion);}',
  'h1{font:600 clamp(2.25rem,5vw,3.25rem)/1.05 "Hiragino Mincho ProN","Yu Mincho","Noto Serif",Georgia,serif;',
  'letter-spacing:-.03em;margin:0 0 .75rem;max-width:22ch;}',
  'h1 em{color:var(--vermillion);font-style:normal;font-weight:700;}',
  '.rule{height:1px;background:linear-gradient(90deg,var(--vermillion) 0,var(--vermillion) 3rem,var(--rule) 3rem);',
  'margin:1.5rem 0;}',
  'p{color:var(--mute);max-width:54ch;margin:0 0 1.75rem;font-size:1.0625rem;}',
  'p code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(33,31,28,.06);',
  'padding:.1em .4em;border-radius:.25em;color:var(--ink);}',
  '@media (prefers-color-scheme:dark){p code{background:rgba(255,255,255,.05);}}',
  '.actions{display:flex;gap:.75rem;flex-wrap:wrap;}',
  'a.btn{display:inline-block;padding:.7rem 1.05rem;font:600 .7rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;',
  'letter-spacing:.18em;text-transform:uppercase;text-decoration:none;border-radius:.5rem;',
  'transition:transform 200ms,background 200ms;}',
  'a.btn:hover{transform:translateY(-1px);}',
  'a.primary{background:var(--ink);color:var(--paper);box-shadow:inset 0 -2px 0 rgba(255,255,255,.18);}',
  'a.primary:hover{background:color-mix(in oklch,var(--ink) 82%,var(--vermillion));}',
  'a.secondary{background:transparent;color:var(--ink);border:1px solid var(--rule);}',
  'a.secondary:hover{border-color:var(--ink);}',
  '@media (prefers-reduced-motion:reduce){a.btn{transition:none}a.btn:hover{transform:none}}',
  '</style>',
  '</head>',
  '<body>',
  '<main>',
  '<p class="eyebrow">404 · 虫々</p>',
  '<h1>This page <em>doesn\'t exist</em> in our docs.</h1>',
  '<div class="rule" aria-hidden="true"></div>',
  '<p>The link may be from an older version, a typo, or a page we have since moved. The docs index is the table of contents for everything Mushi — start there and search for what you need.</p>',
  '<div class="actions">',
  '<a class="btn primary" href="/mushi-mushi/docs/">Docs home</a>',
  '<a class="btn secondary" href="/mushi-mushi/admin/">Console</a>',
  '</div>',
  '</main>',
  '</body>',
  '</html>',
].join('');

function buildSecurityHeaders() {
  return {
    'x-content-type-options': { value: 'nosniff' },
    'x-frame-options': { value: 'SAMEORIGIN' },
    'referrer-policy': { value: 'strict-origin-when-cross-origin' },
    'permissions-policy': { value: 'camera=(), microphone=(), geolocation=()' },
    'strict-transport-security': { value: 'max-age=63072000; includeSubDomains; preload' },
    'content-security-policy': {
      value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    },
  };
}

function handler(event) {
  var response = event.response;
  var request = event.request;
  var status = parseInt(response.statusCode);

  response.headers = response.headers || {};
  var security = buildSecurityHeaders();
  for (var key in security) {
    response.headers[key] = security[key];
  }

  if (status !== 403 && status !== 404) {
    return response;
  }

  // Real assets keep S3's native error so the browser fails fast (a missing
  // `_next` chunk should NOT receive an HTML body — the browser would try to
  // execute the HTML as JavaScript and explode somewhere even uglier).
  // Page routes end in `.html` because the router appended it; the negative
  // lookahead excludes them so we synthesize the editorial 404 only for
  // page-shaped requests.
  if (/\.(?!html$)[a-zA-Z0-9]+$/.test(request.uri)) {
    return response;
  }

  var fallbackHeaders = buildSecurityHeaders();
  fallbackHeaders['content-type'] = { value: 'text/html; charset=utf-8' };
  fallbackHeaders['cache-control'] = { value: 'public, max-age=60, must-revalidate' };

  return {
    statusCode: 404,
    statusDescription: 'Not Found',
    headers: fallbackHeaders,
    body: {
      encoding: 'text',
      data: FALLBACK_404_HTML,
    },
  };
}
