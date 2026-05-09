/**
 * FILE: cloudfront-mushi-apex-redirect.js
 * PURPOSE: CloudFront Function (viewer-request) that 301-redirects apex-domain
 *          SPA route URLs to their canonical form under /mushi-mushi/admin/.
 *
 * PROBLEM SOLVED
 * --------------
 * The admin SPA is deployed to kensaur.us/mushi-mushi/admin/, but the app's
 * "Copy link" button used to produce bare apex URLs such as:
 *
 *     https://kensaur.us/reports/a8054224-5d19-45e3-8c2b-1ad79182f761
 *
 * Those links circulated in Slack, email, and Discord before the copy-link
 * bug was fixed in ReportsPage.tsx. This function rescues them by issuing a
 * permanent 301 so search engines and bookmarks learn the canonical path.
 *
 * SCOPE — only the SPA routes that could appear in a shared link are listed.
 * Unknown apex paths are left untouched so other CloudFront behaviors / origins
 * on the same distribution keep working.
 *
 * ATTACHMENT
 * ----------
 * This function must be attached as a viewer-request function to the
 * CloudFront cache behavior(s) that cover apex-domain SPA paths.
 * The deploy step in deploy-admin.yml creates/updates and publishes the
 * function. The behavior association must be set up once in the AWS console
 * or via `aws cloudfront update-distribution` (it is not managed here because
 * the full distribution config is not stored in source control).
 *
 * Behaviors that should use this function (create one per pattern, or use
 * a single wildcard behavior that points at the same S3 bucket):
 *   /reports/*       → most common from the shared-link bug
 *   /dashboard/*
 *   /inbox/*
 *   /login
 *   /projects/*
 *   /settings/*
 *   /fixes/*
 *   /graph/*
 *
 * RUNTIME: cloudfront-js-2.0
 */

// SPA route prefixes that live under /mushi-mushi/admin/ on the real SPA.
// Every path that starts with one of these is a redirect candidate.
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

function handler(event) {
  var uri = event.request.uri;

  // Static assets: never redirect (they would 404 in S3 anyway, not here).
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return event.request;
  }

  // Check if the URI matches any known SPA route prefix.
  for (var i = 0; i < SPA_PREFIXES.length; i++) {
    var prefix = SPA_PREFIXES[i];
    if (uri === prefix.replace(/\/$/, '') || uri.indexOf(prefix) === 0 || uri === prefix) {
      return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          'location': { value: '/mushi-mushi/admin' + uri },
          'cache-control': { value: 'public, max-age=31536000' },
        },
      };
    }
  }

  // Not a known SPA route — pass through unchanged.
  return event.request;
}
