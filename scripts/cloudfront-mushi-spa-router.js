/**
 * FILE: cloudfront-mushi-spa-router.js
 * PURPOSE: Single CloudFront Function (viewer-request) that handles routing
 *          for ALL three Mushi Mushi surfaces under kensaur.us/mushi-mushi/*:
 *
 *            /mushi-mushi/admin/*  -> S3 (apps/admin SPA, React Router fallback)
 *            /mushi-mushi/docs/*   -> S3 (apps/docs Next.js static export)
 *            /mushi-mushi/testers/* -> S3 (apps/testers Next.js static export,
 *                                    the Mushi Bounties public marketplace)
 *            /mushi-mushi/         -> INTERNAL REWRITE to the docs static export's
 *                                    home (/mushi-mushi/docs/index.html). That page
 *                                    is the prerendered, indexable marketing landing
 *                                    (apps/docs/content/index.mdx). We serve it in
 *                                    place (no redirect) so the canonical product URL
 *                                    stays /mushi-mushi/ AND it's crawlable — the old
 *                                    302 to the noindex admin SPA hid the homepage
 *                                    from search entirely. Asset/link URLs inside that
 *                                    HTML are absolute (/mushi-mushi/docs/_next/…), so
 *                                    serving the same bytes at the bare root resolves
 *                                    correctly against S3.
 *            /mushi-mushi/<docs-path> -> 301 to /mushi-mushi/docs/<docs-path>
 *                                    when the suffix is a docs content route
 *                                    (e.g. /mushi-mushi/quickstart/incident-loop)
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

// Docs content prefixes (mirror cloudfront-mushi-apex-redirect.js).
var DOCS_EXACT = [
  '/quickstart',
  '/concepts',
  '/sdks',
  '/migrations',
  '/operating',
  '/connect',
  '/security',
  '/self-hosting',
  '/plugins',
  '/blog',
  '/admin',
  '/pricing',
  '/roadmap',
  '/launch-week',
  '/changelog',
  '/cloud',
];

var DOCS_NESTED_PREFIXES = [
  '/quickstart/',
  '/concepts/',
  '/sdks/',
  '/migrations/',
  '/integrations/',
  '/operating/',
  '/admin/',
  '/connect/',
  '/security/',
  '/self-hosting/',
  '/plugins/',
  '/blog/',
];

// CloudFront's `request.querystring` is a map of `{ key: { value } }`, not a
// pre-encoded string — naively concatenating it into a URL yields the literal
// text "[object Object]". Mirrors cloudfront-mushi-apex-redirect.js.
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

function matchesDocsSuffix(suffix) {
  var path = suffix.charAt(0) === '/' ? suffix : '/' + suffix;
  var i;
  for (i = 0; i < DOCS_EXACT.length; i++) {
    if (path === DOCS_EXACT[i]) {
      return true;
    }
  }
  for (i = 0; i < DOCS_NESTED_PREFIXES.length; i++) {
    if (path.indexOf(DOCS_NESTED_PREFIXES[i]) === 0) {
      return true;
    }
  }
  return false;
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var qs = request.querystring;

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

  // 4. /mushi-mushi/testers/* clean URLs -> Next.js static export layout.
  //    apps/testers sets `trailingSlash: true`, so every generated page is a
  //    folder index (`<route>/index.html`) — there is no extensionless
  //    `<route>.html` variant the way docs has. A bare `/testers` (no
  //    trailing slash) or a nested path missing its trailing slash both
  //    301 to the slash form so the URL always resolves to a real S3 key.
  if (uri === '/mushi-mushi/testers') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': { value: '/mushi-mushi/testers/' },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }
  // 4a. /mushi-mushi/testers/apps/<slug>/ (the marketplace app-detail page)
  //     is a client-rendered dynamic route: it reads the real slug from the
  //     browser URL via useParams(), not from build-time data. Since
  //     `output: export` can only pre-render a fixed shell HTML
  //     (app/apps/[slug]/page.tsx's PLACEHOLDER_SLUG), every slug — known
  //     or not at the last build — must resolve to that same shell object,
  //     otherwise apps published after the last deploy 404 at the S3
  //     origin. Mirrors the admin SPA fallback (rule 2) for this one route.
  var appDetailMatch = /^\/mushi-mushi\/testers\/apps\/([^/]+)\/?$/.exec(uri);
  if (appDetailMatch && appDetailMatch[1]) {
    request.uri = '/mushi-mushi/testers/apps/_shell/index.html';
    return request;
  }

  if (uri.indexOf('/mushi-mushi/testers/') === 0) {
    if (uri.charAt(uri.length - 1) === '/') {
      request.uri = uri + 'index.html';
      return request;
    }
    var testersQs = serializeQuerystring(qs);
    var testersLocation = uri + '/';
    if (testersQs) {
      testersLocation = testersLocation + '?' + testersQs;
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': { value: testersLocation },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }

  // 5. Bare product root -> serve the docs static export's home page in place.
  //    This is the indexable marketing landing (apps/docs/content/index.mdx).
  //    We REWRITE (not redirect) so the canonical homepage URL stays
  //    /mushi-mushi/ while the bytes come from the already-deployed
  //    /mushi-mushi/docs/index.html. The HTML's asset + nav URLs are absolute
  //    (/mushi-mushi/docs/_next/…), so they resolve against S3 unchanged. Both
  //    the no-trailing-slash and trailing-slash forms are handled so a typed
  //    `kensaur.us/mushi-mushi` and a linked `/mushi-mushi/` both land here.
  if (uri === '/mushi-mushi' || uri === '/mushi-mushi/') {
    request.uri = '/mushi-mushi/docs/index.html';
    return request;
  }

  // 6. Mis-prefixed docs paths (/mushi-mushi/quickstart/… without /docs/) ->
  //    301 to the canonical docs URL before the admin SPA fallback.
  var suffix = uri.replace(/^\/mushi-mushi\/?/, '');
  if (suffix && matchesDocsSuffix(suffix)) {
    var docsQs = serializeQuerystring(qs);
    var docsLocation = '/mushi-mushi/docs/' + suffix.replace(/^\/+/, '');
    if (docsQs) {
      docsLocation = docsLocation + '?' + docsQs;
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': { value: docsLocation },
        'cache-control': { value: 'public, max-age=31536000' },
      },
    };
  }

  // 7. Anything else under /mushi-mushi/* -> 302 to the admin SPA. We forward
  //    whatever path suffix the user typed so deep links survive (e.g.
  //    /mushi-mushi/login -> /mushi-mushi/admin/login, which the admin React
  //    Router knows how to handle).
  var location = '/mushi-mushi/admin/' + suffix;

  // X-Robots-Tag on the 302 itself so Google drops the source URL on first
  // crawl instead of reporting 47 "Page with redirect" entries (one per
  // /mushi-mushi/<route> -> /mushi-mushi/admin/<route> pair) in GSC. The
  // destination is already noindex'd (apps/admin/index.html shell since
  // PR #91), but Google still indexes the redirect *source* unless the
  // 3xx response itself carries noindex. Per Google's robots-meta-tag
  // docs, X-Robots-Tag works on every response status including 3xx and
  // is the canonical way to drop a redirect URL from the index.
  // https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#xrobotstag
  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      'location': { value: location },
      'cache-control': { value: 'no-cache' },
      'x-robots-tag': { value: 'noindex, nofollow' },
    },
  };
}
