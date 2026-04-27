/**
 * FILE: cloudfront-mushi-spa-response.js
 * PURPOSE: CloudFront Function (viewer-response) that injects security headers
 *          and redirects page-route 403/404 errors to the admin SPA root.
 *
 * OVERVIEW:
 * - Injects security headers (CSP, HSTS, X-Frame-Options, etc.) on every response
 * - On 403/404 for page routes: redirects to /mushi-mushi/admin/ so React Router
 *   renders the appropriate page (or a 404 component)
 * - Static asset 403/404s pass through unchanged
 *
 * ASSOCIATIONS:
 * - Attached to the `/mushi-mushi/admin/*` cache behavior (S3 origin) on viewer-response.
 * - The cloud Vercel origin does NOT use this function — Vercel injects its own
 *   security headers for the Next.js app, and we don't want to double-CSP.
 * - The docs behavior uses cloudfront-mushi-docs-response.js (different fallback).
 *
 * NOTES:
 * - CSP allows connections to Supabase (*.supabase.co) for auth and API
 * - CSP allows Sentry and Langfuse for observability
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
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://kensaur.us https://*.sentry.io https://*.cloud.langfuse.com; frame-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  };

  if (status !== 403 && status !== 404) {
    return response;
  }

  // Static assets: pass error through unchanged so browsers handle correctly.
  if (/\.[a-zA-Z0-9]+$/.test(request.uri)) {
    return response;
  }

  // Page routes: redirect to admin SPA root so React Router handles navigation.
  response.statusCode = 302;
  response.statusDescription = 'Found';
  response.headers['location'] = { value: '/mushi-mushi/admin/' };
  response.headers['cache-control'] = { value: 'no-cache' };
  delete response.body;

  return response;
}
