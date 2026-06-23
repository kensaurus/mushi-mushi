/**
 * FILE: cloudfront-mushi-apex-redirect.js
 * PURPOSE: CloudFront Function (viewer-request) that 301-redirects apex-domain
 *          URLs to their canonical form under /mushi-mushi/docs/ or
 *          /mushi-mushi/admin/.
 *
 * PROBLEM SOLVED
 * --------------
 * 1. Admin SPA — historical "Copy link" URLs like
 *    https://kensaur.us/reports/<uuid> (fixed in ReportsPage.tsx, but links
 *    still circulate).
 * 2. Docs site — Nextra static export embeds unprefixed routes in `.txt` RSC
 *    payloads (e.g. {"route":"/quickstart/incident-loop"}). Crawlers and
 *    bookmarks hit https://kensaur.us/quickstart/incident-loop which would
 *    otherwise 404 with raw S3 NoSuchKey XML.
 *
 * MATCHING ORDER (first win):
 *   1. Static assets (has extension) → pass through
 *   2. Docs routes → /mushi-mushi/docs{uri}
 *   3. Admin SPA routes → /mushi-mushi/admin{uri}
 *   4. Unknown → pass through
 *
 * CONFLICT: /integrations alone is the admin console route; /integrations/*
 * is docs-only (e.g. /integrations/cursor). Nested docs prefixes use a
 * trailing slash so exact /integrations is not captured by docs rules.
 *
 * ATTACHMENT: viewer-request on apex cache behaviors — see
 * scripts/aws-attach-apex-redirect.mjs (updated by deploy-admin.yml and
 * deploy-docs.yml).
 *
 * RUNTIME: cloudfront-js-2.0
 */

// Docs folder roots (exact match) + single-page slugs at apex.
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

// Docs nested paths — trailing slash required so /integrations (admin) is not
// mistaken for a docs route.
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

// SPA route prefixes under /mushi-mushi/admin/.
var SPA_PREFIXES = [
  '/reports/',
  '/dashboard',
  '/inbox',
  '/login',
  '/projects',
  '/settings',
  '/fixes',
  '/graph',
  '/inventory',
  '/judge',
  '/query',
  '/research',
  '/repo',
  '/sso',
  '/audit',
  '/prompt-lab',
  '/intelligence',
  '/compliance',
  '/storage',
  '/marketplace',
  '/integrations',
  '/mcp',
  '/onboarding',
  '/health',
  '/anti-gaming',
  '/notifications',
  '/billing',
  '/organization',
  '/org/',
  '/queue',
  '/users',
  '/invite/',
  '/reset-password',
];

function redirect301(targetPath, querystring) {
  var location = targetPath;
  if (querystring) {
    location = location + '?' + querystring;
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

function matchesDocs(uri) {
  var i;
  for (i = 0; i < DOCS_EXACT.length; i++) {
    if (uri === DOCS_EXACT[i]) {
      return true;
    }
  }
  for (i = 0; i < DOCS_NESTED_PREFIXES.length; i++) {
    if (uri.indexOf(DOCS_NESTED_PREFIXES[i]) === 0) {
      return true;
    }
  }
  return false;
}

function matchesSpa(uri) {
  var i;
  for (i = 0; i < SPA_PREFIXES.length; i++) {
    var prefix = SPA_PREFIXES[i];
    if (uri === prefix.replace(/\/$/, '') || uri.indexOf(prefix) === 0 || uri === prefix) {
      return true;
    }
  }
  return false;
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var qs = request.querystring;

  // Static assets: never redirect.
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  // Docs before SPA — unprefixed Nextra routes and nested docs paths.
  if (matchesDocs(uri)) {
    return redirect301('/mushi-mushi/docs' + uri, qs);
  }

  // Admin SPA shared-link rescue.
  if (matchesSpa(uri)) {
    return redirect301('/mushi-mushi/admin' + uri, qs);
  }

  return request;
}
