/**
 * FILE: cloudfront-kensaur-www-redirect.js
 * PURPOSE: Minimal viewer-request CF Function — 301 www.kensaur.us → apex.
 * Attach to cache behaviors that have no other viewer-request function
 * (project path prefixes like /babuu-ai/*, /bento-chat/*, …).
 * RUNTIME: cloudfront-js-2.0
 */
function handler(event) {
  var request = event.request;
  var hostHeader = request.headers && request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value.toLowerCase() : '';
  if (host === 'www.kensaur.us') {
    var uri = request.uri || '/';
    var qs = request.querystring;
    var parts = [];
    if (qs && typeof qs === 'object') {
      var key;
      for (key in qs) {
        if (Object.prototype.hasOwnProperty.call(qs, key) && qs[key] && qs[key].value !== undefined && qs[key].value !== '') {
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(qs[key].value));
        }
      }
    }
    var location = 'https://kensaur.us' + uri;
    if (parts.length) location += '?' + parts.join('&');
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: location },
        'cache-control': { value: 'public, max-age=31536000' },
      },
    };
  }
  return request;
}
