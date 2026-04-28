/**
 * FILE: cloudfront-mushi-docs-response.js
 * PURPOSE: CloudFront Function (viewer-response) that injects security headers
 *          on the docs site at /mushi-mushi/docs/* and surfaces a friendly 404
 *          on missing paths instead of redirecting to the admin SPA.
 *
 * OVERVIEW:
 * - Injects the same security headers as the admin (CSP / HSTS / X-Frame-Options).
 * - On 403/404 for *page* requests: rewrites to /mushi-mushi/docs/404.html
 *   (Nextra emits a 404 page on static export). The status code stays 404 so
 *   crawlers see the truth — we don't soft-301 missing pages.
 *
 * ASSOCIATIONS:
 * - Attached to the `/mushi-mushi/docs/*` cache behavior (S3 origin) on viewer-response.
 */

function handler(event) {
  var response = event.response;
  var request = event.request;
  var status = parseInt(response.statusCode);

  response.headers = response.headers || {};
  response.headers['x-content-type-options'] = { value: 'nosniff' };
  response.headers['x-frame-options'] = { value: 'SAMEORIGIN' };
  response.headers['referrer-policy'] = { value: 'strict-origin-when-cross-origin' };
  response.headers['permissions-policy'] = { value: 'camera=(), microphone=(), geolocation=()' };
  response.headers['strict-transport-security'] = { value: 'max-age=63072000; includeSubDomains; preload' };
  response.headers['content-security-policy'] = {
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  };

  if (status !== 403 && status !== 404) {
    return response;
  }

  // Pass asset errors through unchanged so the browser fails fast.
  if (/\.[a-zA-Z0-9]+$/.test(request.uri)) {
    return response;
  }

  // For missing pages, hand the request back to the docs 404 page. We don't
  // soft-redirect to / because that hides broken doc links from search engines.
  response.statusCode = 404;
  response.statusDescription = 'Not Found';
  response.headers['cache-control'] = { value: 'no-cache' };

  return response;
}
