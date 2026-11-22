/**
 * FILE: cloudfront-kensaur-www-redirect.js
 * PURPOSE: Minimal viewer-request CF Function on kensaur.us (E246VQ1C9QYZVB):
 *   - 301 www.kensaur.us → apex, query kept;
 *   - 301 a slashless app root (`/glot-it`, `/yen-yen`, …) to its slash form,
 *     query kept, before the request reaches S3. The S3 website endpoint
 *     answers a directory key with a 302 that DROPS the query string, so a
 *     campaign link `kensaur.us/glot-it?utm_source=x` lost its UTM (seen
 *     2026-11-13 on all ten exact-path app behaviours).
 * Attach to cache behaviors that have no other viewer-request function: the
 * exact app roots (`/glot-it`, `/the-wanting-mind`, …) and project path
 * prefixes (`/babuu-ai/*`, `/bento-chat/*`, …). A one-segment path only
 * reaches this function through an exact app-root behaviour; under a `/x/*`
 * prefix every path has a second segment.
 * RUNTIME: cloudfront-js-2.0
 */

/** One path segment, no dot (not a file), no trailing slash: an app root. */
var APP_ROOT = /^\/[A-Za-z0-9_-]+$/;

/**
 * The query as CloudFront passed it. Keys and values arrive still
 * percent-encoded, so they are re-emitted as is; empty ones stay as `key=`
 * and a repeated key keeps every value.
 */
function serializeQuery(qs) {
  var parts = [];
  if (qs && typeof qs === 'object') {
    var key;
    for (key in qs) {
      var entry = Object.prototype.hasOwnProperty.call(qs, key) ? qs[key] : null;
      if (!entry) continue;
      if (entry.multiValue && entry.multiValue.length) {
        for (var i = 0; i < entry.multiValue.length; i++) {
          parts.push(key + '=' + (entry.multiValue[i].value || ''));
        }
      } else {
        parts.push(key + '=' + (entry.value || ''));
      }
    }
  }
  return parts.join('&');
}

function redirect301(location, qs) {
  var query = serializeQuery(qs);
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: query ? location + '?' + query : location },
      'cache-control': { value: 'public, max-age=31536000' },
    },
  };
}

function handler(event) {
  var request = event.request;
  var hostHeader = request.headers && request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value.toLowerCase() : '';
  var uri = request.uri || '/';
  if (host === 'www.kensaur.us') {
    return redirect301('https://kensaur.us' + uri, request.querystring);
  }
  if (APP_ROOT.test(uri)) {
    return redirect301(uri + '/', request.querystring);
  }
  return request;
}
