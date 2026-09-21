/**
 * FILE: scripts/aws-configure-docs-errors.test.mjs
 * PURPOSE: Unit tests for the pure planning half of aws-configure-docs-errors.mjs
 *          (no AWS calls).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CSP_MAX_CHARS,
  DOCS_ERROR_KEY,
  DOCS_PATH_PATTERN,
  POLICY_NAME,
  REMOVED_HEADERS,
  attachPolicyToDocsBehavior,
  buildResponseHeadersPolicyConfig,
  desiredWebsiteConfig,
  loadDocsSecurityHeaders,
} from './aws-configure-docs-errors.mjs'

describe('response headers policy from the docs response function', () => {
  const headers = loadDocsSecurityHeaders()
  const config = buildResponseHeadersPolicyConfig(headers)

  it('reads the headers the viewer-response function sets on 2xx', () => {
    assert.equal(headers['x-content-type-options'], 'nosniff')
    assert.match(headers['strict-transport-security'], /max-age=\d+/)
    assert.match(headers['content-security-policy'], /default-src 'self'/)
  })

  it('carries every header, so a 404 gets the same set as a 200', () => {
    const sec = config.SecurityHeadersConfig
    assert.deepEqual(sec.ContentTypeOptions, { Override: true })
    assert.equal(sec.FrameOptions.FrameOption, headers['x-frame-options'])
    assert.equal(sec.ReferrerPolicy.ReferrerPolicy, headers['referrer-policy'])
    assert.equal(sec.ContentSecurityPolicy.ContentSecurityPolicy, headers['content-security-policy'])
    assert.deepEqual(sec.StrictTransportSecurity, {
      AccessControlMaxAgeSec: 63072000,
      IncludeSubdomains: true,
      Preload: true,
      Override: true,
    })
    const custom = Object.fromEntries(config.CustomHeadersConfig.Items.map((h) => [h.Header, h.Value]))
    assert.equal(custom['permissions-policy'], headers['permissions-policy'])
    assert.equal(config.CustomHeadersConfig.Quantity, config.CustomHeadersConfig.Items.length)
  })

  it('stays inside the CloudFront CSP length cap', () => {
    assert.ok(headers['content-security-policy'].length <= CSP_MAX_CHARS)
  })

  it('strips the S3 error headers that name the missing key', () => {
    const removed = config.RemoveHeadersConfig.Items.map((h) => h.Header)
    assert.deepEqual(removed, REMOVED_HEADERS)
    assert.ok(removed.includes('x-amz-error-detail-key'))
    assert.equal(config.RemoveHeadersConfig.Quantity, removed.length)
    assert.equal(config.Name, POLICY_NAME)
  })

  it('refuses values a policy cannot express instead of dropping them', () => {
    assert.throws(() => buildResponseHeadersPolicyConfig({ 'x-frame-options': 'ALLOW-FROM x' }))
    assert.throws(() => buildResponseHeadersPolicyConfig({ 'content-security-policy': 'a'.repeat(CSP_MAX_CHARS + 1) }))
    assert.throws(() => buildResponseHeadersPolicyConfig({ 'strict-transport-security': 'preload' }))
  })
})

describe('bucket website ErrorDocument', () => {
  const live = {
    IndexDocument: { Suffix: 'index.html' },
    ErrorDocument: { Key: 'index.html' },
  }

  it('points the missing index.html error document at the docs 404 page', () => {
    assert.deepEqual(desiredWebsiteConfig(live), {
      IndexDocument: { Suffix: 'index.html' },
      ErrorDocument: { Key: DOCS_ERROR_KEY },
    })
  })

  it('keeps routing rules', () => {
    const rules = [{ Redirect: { ReplaceKeyWith: 'x' } }]
    assert.deepEqual(desiredWebsiteConfig({ ...live, RoutingRules: rules }).RoutingRules, rules)
  })

  it('is a no-op once configured', () => {
    assert.equal(desiredWebsiteConfig({ ...live, ErrorDocument: { Key: DOCS_ERROR_KEY } }), null)
  })

  it('refuses a bucket that is not serving a website', () => {
    assert.throws(() => desiredWebsiteConfig({}))
    assert.throws(() => desiredWebsiteConfig({ RedirectAllRequestsTo: { HostName: 'x' } }))
  })
})

describe('attaching the policy to the docs behavior', () => {
  const dist = () => ({
    CacheBehaviors: {
      Items: [{ PathPattern: '/mushi-mushi/*' }, { PathPattern: DOCS_PATH_PATTERN }],
    },
  })

  it('attaches to the docs behavior only', () => {
    const config = dist()
    assert.equal(attachPolicyToDocsBehavior(config, 'pol-1'), true)
    assert.equal(config.CacheBehaviors.Items[1].ResponseHeadersPolicyId, 'pol-1')
    assert.equal(config.CacheBehaviors.Items[0].ResponseHeadersPolicyId, undefined)
  })

  it('is a no-op when already attached', () => {
    const config = dist()
    config.CacheBehaviors.Items[1].ResponseHeadersPolicyId = 'pol-1'
    assert.equal(attachPolicyToDocsBehavior(config, 'pol-1'), false)
  })

  it('will not replace a different policy', () => {
    const config = dist()
    config.CacheBehaviors.Items[1].ResponseHeadersPolicyId = 'someone-elses'
    assert.throws(() => attachPolicyToDocsBehavior(config, 'pol-1'), /already uses/)
  })

  it('fails loudly when the docs behavior is missing', () => {
    assert.throws(() => attachPolicyToDocsBehavior({ CacheBehaviors: { Items: [] } }, 'pol-1'))
  })
})
