/**
 * FILE: cloudfront-mushi-spa-router.js
 * PURPOSE: Single CloudFront Function (viewer-request) that handles routing
 *          for ALL three Mushi Mushi surfaces under kensaur.us/mushi-mushi/*:
 *
 *            /mushi-mushi/admin/*  -> S3 (apps/admin SPA, React Router fallback)
 *            /mushi-mushi/docs/*   -> S3 (apps/docs Next.js static export)
 *            /mushi-mushi/         -> 302 to /mushi-mushi/admin/ (canonical landing
 *                                    is the admin SPA's PublicHomePage today)
 *            /mushi-mushi/<other>  -> 302 to /mushi-mushi/admin/<other> so the
 *                                    admin React Router can take it from there
 *
 * WHY ONE FUNCTION: the kensaur.us distribution has a single cache behavior
 * `/mushi-mushi/*` -> S3, so this function is the single rewrite entry point
 * for every prefix served from S3. Splitting into three behaviors would be
 * cleaner, but it's not required and adds CloudFront propagation surface.
 *
 * CONTRACT (viewer-request, runtime cloudfront-js-2.0):
 * - Return `request` to forward to S3 (with a possibly rewritten `request.uri`)
 * - Return a synthesized response object `{ statusCode, statusDescription,
 *   headers, ... }` to short-circuit (used here for the 302 to /admin/).
 *
 * DEPLOYMENT:
 * - Updated + published by deploy-admin.yml on every admin deploy and on any
 *   change to scripts/cloudfront-mushi-* (path filter).
 * - After publish, the deploy workflow invalidates `/mushi-mushi/*` so cached
 *   pre-fix HTML at the CloudFront edge is purged immediately.
 */

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // 1. Static assets (anything with a file extension): pass through to S3 unchanged.
  //    Examples: .js .css .png .json .ico .map .woff2 .svg .txt
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  // 2. /mushi-mushi/admin/* page routes -> SPA index for React Router.
  if (uri === '/mushi-mushi/admin' || uri.indexOf('/mushi-mushi/admin/') === 0) {
    request.uri = '/mushi-mushi/admin/index.html';
    return request;
  }

  // 3. /mushi-mushi/docs/* clean URLs -> Next.js static export layout.
  //    `next export` writes one HTML file per route; trailing slash means
  //    folder index, no extension means append `.html`.
  //
  //    NOTE on the bare `/mushi-mushi/docs` (no trailing slash) case:
  //    Next.js with `trailingSlash: false` writes the docs root as
  //    `docs/index.html` (folder index), NOT `docs.html`. If we naively
  //    append `.html` here we get `/mushi-mushi/docs.html` which doesn't
  //    exist in S3 (visitors saw raw `NoSuchKey` XML — see Sentry breadcrumb
  //    for the originally-reported 404). 301 to the trailing-slash form is
  //    the canonical fix and matches Next's link-rendering for the same
  //    URL. Sub-pages (e.g. `/docs/quickstart`) keep the existing
  //    extension-append since `quickstart.html` is real.
  if (uri === '/mushi-mushi/docs') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': { value: '/mushi-mushi/docs/' },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }
  if (uri.indexOf('/mushi-mushi/docs/') === 0) {
    if (uri.charAt(uri.length - 1) === '/') {
      request.uri = uri + 'index.html';
    } else {
      request.uri = uri + '.html';
    }
    return request;
  }

  // 4. Bare /mushi-mushi/ or anything else under /mushi-mushi/* -> 302 to the
  //    admin SPA. The admin's PublicHomePage at `/mushi-mushi/admin/` is the
  //    canonical marketing landing today; once a dedicated cloud surface ships
  //    we'll replace this branch with a behavior pointing at it.
  //
  //    We forward whatever path suffix the user typed so deep links survive
  //    (e.g. /mushi-mushi/login -> /mushi-mushi/admin/login, which the admin
  //    React Router knows how to handle).
  var suffix = uri.replace(/^\/mushi-mushi\/?/, '');
  var location = '/mushi-mushi/admin/' + suffix;

  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      'location': { value: location },
      'cache-control': { value: 'no-cache' },
    },
  };
}
