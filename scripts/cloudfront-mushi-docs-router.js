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
 *
 * RULES:
 * - URI ends with `/`               -> append `index.html`
 * - URI has no file extension       -> append `.html` (catches /quickstart -> /quickstart.html)
 * - URI has any file extension      -> pass through (assets, JSON, images)
 *
 * ASSOCIATIONS:
 * - Attached to the `/mushi-mushi/docs/*` cache behavior (S3 origin) on viewer-request.
 *
 * DEPLOYMENT:
 * - Create as a CloudFront Function (runtime: cloudfront-js-2.0)
 * - The deploy-docs.yml workflow creates / updates / publishes this function
 *   idempotently on every docs deploy.
 */

function handler(event) {
  var request = event.request;
  var uri = request.uri;

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
        'location': { value: uri + '/' },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }

  // 2. Trailing slash: serve the folder index (e.g. /mushi-mushi/docs/ -> /mushi-mushi/docs/index.html)
  if (uri.charAt(uri.length - 1) === '/') {
    request.uri = uri + 'index.html';
    return request;
  }

  // 3. Has a file extension: pass through (assets, JSON, sitemap, etc.)
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  // 4. Clean URL with no extension: append `.html` so S3 finds the static export.
  request.uri = uri + '.html';
  return request;
}
