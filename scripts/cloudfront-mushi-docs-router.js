/**
 * FILE: cloudfront-mushi-docs-router.js
 * PURPOSE: CloudFront Function (viewer-request) that maps clean URLs to the
 *          static export emitted by `next build && next export` for the docs
 *          site deployed at /mushi-mushi/docs/.
 *
 * OVERVIEW:
 * - `next export` writes one HTML file per route, *not* a single SPA index.
 *   For example /mushi-mushi/docs/quickstart -> mushi-mushi/docs/quickstart.html.
 * - When users hit a clean URL with no trailing slash, S3 returns 403/404
 *   because there's no key at that exact name. This function appends
 *   `/index.html` (or `.html`) so the request resolves.
 * - Also consolidates www → apex and trailing-slash docs sub-pages to the
 *   slashless Next export form, preserving query strings on every 301.
 *
 * RULES:
 * - Host www.kensaur.us           -> 301 https://kensaur.us{uri}{qs}
 * - Bare `/…/docs` (no slash)     -> 301 `{uri}/`{qs}
 * - Docs root trailing slash      -> rewrite to `index.html`
 * - Other trailing slash          -> 301 slashless{qs}
 * - URI has any file extension    -> pass through (assets, JSON, images)
 * - Clean URL with no extension   -> append `.html`
 *
 * ASSOCIATIONS:
 * - Attached to the `/mushi-mushi/docs/*` cache behavior (S3 origin) on viewer-request.
 *
 * DEPLOYMENT:
 * - Create as a CloudFront Function (runtime: cloudfront-js-2.0)
 * - The deploy-docs.yml workflow creates / updates / publishes this function
 *   idempotently on every docs deploy.
 */

// CloudFront exposes querystring as { key: { value } }, not a
// pre-encoded string — naively concatenating it into a URL yields the literal
// text "[object Object]". Mirrors cloudfront-mushi-spa-router.js.
function serializeQuerystring(qs) {
  if (!qs) {
    return '';
  }
  if (typeof qs === 'string') {
    return qs;
  }
  var parts = [];
  var key;
  for (key in qs) {
    if (!Object.prototype.hasOwnProperty.call(qs, key)) {
      continue;
    }
    var entry = qs[key];
    if (entry && entry.value !== undefined && entry.value !== '') {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(entry.value));
    }
  }
  return parts.join('&');
}

function redirect301(location, qs) {
  var serialized = serializeQuerystring(qs);
  if (serialized) {
    location = location + '?' + serialized;
  }
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      'location': { value: location },
      'cache-control': { value: 'public, max-age=31536000' },
    },
  };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var qs = request.querystring;
  var hostHeader = request.headers && request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value.toLowerCase() : '';

  // www → apex (this behavior is more specific than Default).
  if (host === 'www.kensaur.us') {
    return redirect301('https://kensaur.us' + uri, qs);
  }

  // 1. Bare docs root with no trailing slash: 301 to the canonical
  //    trailing-slash form. The static export's docs root lives at
  //    `docs/index.html` (folder index), not `docs.html`, so naively
  //    appending `.html` would 404 in S3. Match either prefix in case
  //    this function is attached to either the docs-only behavior or
  //    the parent /mushi-mushi/* behavior.
  if (uri === '/mushi-mushi/docs' || uri === '/docs') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': {
          value: (function () {
            var loc = uri + '/';
            var serialized = serializeQuerystring(qs);
            return serialized ? loc + '?' + serialized : loc;
          })(),
        },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }

  // 2. Trailing slash: docs root keeps folder index; sub-pages 301 to
  //    slashless form (Next `trailingSlash: false` → `slug.html`, not
  //    `slug/index.html`). Mirrors cloudfront-mushi-spa-router.js.
  if (uri === '/mushi-mushi/docs/' || uri === '/docs/') {
    request.uri = uri + 'index.html';
    return request;
  }
  if (uri.charAt(uri.length - 1) === '/') {
    return redirect301(uri.slice(0, -1), qs);
  }

  // 3. Has a file extension: pass through (assets, JSON, sitemap, etc.)
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  // 4. Clean URL with no extension: append `.html` so S3 finds the static export.
  request.uri = uri + '.html';
  return request;
}
