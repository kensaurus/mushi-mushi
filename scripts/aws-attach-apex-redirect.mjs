/**
 * FILE: scripts/aws-attach-apex-redirect.mjs
 * PURPOSE: Idempotently add CloudFront cache behaviors for every apex-domain
 *          SPA route prefix so the mushi-mushi-apex-redirect function can 301
 *          historical dead links to /mushi-mushi/admin/<path>.
 *
 * RUN: node scripts/aws-attach-apex-redirect.mjs
 * ENV: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (us-east-1)
 */

import { execSync } from 'node:child_process'

const DIST_ID = process.env.CF_DIST_ID || 'E246VQ1C9QYZVB'
const FN_ARN = 'arn:aws:cloudfront::590715976857:function/mushi-mushi-apex-redirect'
const MUSHI_ORIGIN_ID = 'kensaur.us/mushi-mushi'

// Every apex path prefix that could appear in a shared report/admin link.
// These mirror the SPA_PREFIXES in cloudfront-mushi-apex-redirect.js.
const SPA_PATTERNS = [
  '/reports/*',
  '/reports',
  '/dashboard',
  '/dashboard/*',
  '/inbox',
  '/inbox/*',
  '/login',
  '/projects',
  '/projects/*',
  '/settings',
  '/settings/*',
  '/fixes',
  '/fixes/*',
  '/graph',
  '/graph/*',
  '/inventory',
  '/inventory/*',
  '/billing',
  '/billing/*',
  '/organization',
  '/organization/*',
  '/users',
  '/users/*',
  '/notifications',
  '/notifications/*',
  '/integrations',
  '/integrations/*',
  '/marketplace',
  '/marketplace/*',
  '/mcp',
  '/mcp/*',
  '/onboarding',
  '/onboarding/*',
  '/health',
  '/health/*',
  '/compliance',
  '/compliance/*',
  '/storage',
  '/storage/*',
  '/query',
  '/query/*',
]

function aws(cmd) {
  return JSON.parse(execSync(`aws ${cmd} --output json 2>&1`, { encoding: 'utf8' }))
}
function awsRaw(cmd) {
  return execSync(`aws ${cmd} 2>&1`, { encoding: 'utf8' })
}

console.log(`Fetching distribution config for ${DIST_ID}...`)
const distResp = aws(`cloudfront get-distribution-config --id ${DIST_ID} --region us-east-1`)
const etag = distResp.ETag
const config = distResp.DistributionConfig

console.log(`Current ETag: ${etag}`)
console.log(`Current behavior count: ${config.CacheBehaviors.Quantity}`)

// Find the /mushi-mushi/* behavior to clone its settings
const mushiBehavior = config.CacheBehaviors.Items.find(cb => cb.PathPattern === '/mushi-mushi/*')
if (!mushiBehavior) {
  console.error('ERROR: Could not find /mushi-mushi/* behavior to clone settings from')
  process.exit(1)
}
console.log(`Found mushi behavior: origin=${mushiBehavior.TargetOriginId}, protocol=${mushiBehavior.ViewerProtocolPolicy}`)

// Build the apex-redirect function association
const apexFnAssoc = {
  Quantity: 1,
  Items: [
    {
      FunctionARN: FN_ARN,
      EventType: 'viewer-request',
    },
  ],
}

// Check which patterns already have a behavior
const existingPatterns = new Set(config.CacheBehaviors.Items.map(cb => cb.PathPattern))
const newPatterns = SPA_PATTERNS.filter(p => !existingPatterns.has(p))

if (newPatterns.length === 0) {
  console.log('All SPA patterns already have cache behaviors. Nothing to add.')
  process.exit(0)
}

console.log(`Adding ${newPatterns.length} new cache behaviors: ${newPatterns.join(', ')}`)

// Clone the mushi behavior for each new pattern (with the apex-redirect function).
// We deep-clone the mushi behavior so all required fields (SmoothStreaming,
// TrustedSigners, etc.) are present, then override only what differs.
const newBehaviors = newPatterns.map(pattern => ({
  ...JSON.parse(JSON.stringify(mushiBehavior)),
  PathPattern: pattern,
  TargetOriginId: MUSHI_ORIGIN_ID,
  FunctionAssociations: apexFnAssoc,
}))

// Insert new behaviors at the beginning (most specific first)
config.CacheBehaviors.Items = [
  ...newBehaviors,
  ...config.CacheBehaviors.Items,
]
config.CacheBehaviors.Quantity += newBehaviors.length

// Write updated config to temp file
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const tmpDir = 'C:\\tmp'
try { mkdirSync(tmpDir, { recursive: true }) } catch {}
const tmpFile = join(tmpDir, 'cf-update-config.json')
writeFileSync(tmpFile, JSON.stringify(config))
console.log(`Config written to ${tmpFile}`)

// Apply the update
console.log('Applying distribution update...')
try {
  const result = awsRaw(
    `cloudfront update-distribution --id ${DIST_ID} --if-match ${etag} --distribution-config file://${tmpFile} --region us-east-1`
  )
  const parsed = JSON.parse(result)
  console.log(`SUCCESS. New ETag: ${parsed.ETag}`)
  console.log(`Distribution status: ${parsed.Distribution.Status}`)
} catch (err) {
  console.error('Update failed:', err.message)
  process.exit(1)
}

console.log('\nDone. CloudFront will propagate changes in ~5 minutes.')
console.log('Verify with: curl -I https://kensaur.us/reports/<any-uuid>')
