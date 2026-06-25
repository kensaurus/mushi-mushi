/**
 * FILE: scripts/aws-attach-apex-redirect.mjs
 * PURPOSE: Idempotently attach the mushi-mushi-apex-redirect CloudFront Function
 *          to the distribution's Default cache behavior (viewer-request).
 *
 * WHY DEFAULT (not per-path behaviors):
 *   The kensaur.us distribution is near the 75 cache-behavior quota. The redirect
 *   function in cloudfront-mushi-apex-redirect.js already filters which URIs to
 *   301 — everything else passes through unchanged.
 *
 * RUN: node scripts/aws-attach-apex-redirect.mjs
 * ENV: CLOUDFRONT_DISTRIBUTION_ID (or CF_DIST_ID), AWS credentials via OIDC or keys
 */

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || process.env.CF_DIST_ID || 'E246VQ1C9QYZVB'
const FN_NAME = 'mushi-mushi-apex-redirect'
const BEHAVIOR_LIMIT = 75

function aws(cmd) {
  return JSON.parse(execSync(`aws ${cmd} --output json 2>&1`, { encoding: 'utf8' }))
}

function awsRawOrThrow(cmd) {
  try {
    return execSync(`aws ${cmd} 2>&1`, { encoding: 'utf8' })
  } catch (err) {
    const detail = err.stdout?.toString() || err.stderr?.toString() || err.message
    console.error('AWS CLI error:')
    console.error(detail)
    process.exit(1)
  }
}

function getLiveFunctionArn(name) {
  try {
    const resp = aws(
      `cloudfront describe-function --name ${name} --stage LIVE --region us-east-1`,
    )
    return resp?.FunctionSummary?.FunctionMetadata?.FunctionARN ?? ''
  } catch (err) {
    const msg = err.stdout?.toString() || err.message || ''
    if (/NoSuchFunctionExists|cannot be found|not.*found/i.test(msg)) {
      return ''
    }
    console.error(`describe-function failed for ${name}:`, msg)
    process.exit(1)
  }
}

function viewerRequestAssoc(behavior) {
  const items = behavior?.FunctionAssociations?.Items ?? []
  return items.find((item) => item.EventType === 'viewer-request') ?? null
}

console.log(`Fetching distribution config for ${DIST_ID}...`)
const distResp = aws(`cloudfront get-distribution-config --id ${DIST_ID} --region us-east-1`)
const etag = distResp.ETag
const config = distResp.DistributionConfig

console.log(`Current ETag: ${etag}`)
console.log(`Ordered cache behavior count: ${config.CacheBehaviors?.Quantity ?? 0}`)

if ((config.CacheBehaviors?.Quantity ?? 0) >= BEHAVIOR_LIMIT) {
  console.warn(
    `::warning::At ${config.CacheBehaviors.Quantity}/${BEHAVIOR_LIMIT} cache behaviors — per-path apex behaviors are disabled; using Default behavior only.`,
  )
}

const fnArn = getLiveFunctionArn(FN_NAME)
if (!fnArn) {
  console.error(`ERROR: ${FN_NAME} is not published to LIVE stage. Run deploy-docs or deploy-admin first.`)
  process.exit(1)
}
console.log(`Apex redirect function ARN: ${fnArn}`)

const defaultBehavior = config.DefaultCacheBehavior
if (!defaultBehavior) {
  console.error('ERROR: Distribution has no DefaultCacheBehavior')
  process.exit(1)
}

const existingViewer = viewerRequestAssoc(defaultBehavior)
if (existingViewer?.FunctionARN === fnArn) {
  console.log('Default cache behavior already has mushi-mushi-apex-redirect on viewer-request. Nothing to do.')
  process.exit(0)
}

if (existingViewer?.FunctionARN && existingViewer.FunctionARN !== fnArn) {
  console.error(
    'ERROR: Default cache behavior already has a different viewer-request function:',
    existingViewer.FunctionARN,
  )
  console.error('Merge redirect logic manually or remove the existing association before re-running.')
  process.exit(1)
}

const otherAssocs = (defaultBehavior.FunctionAssociations?.Items ?? []).filter(
  (item) => item.EventType !== 'viewer-request',
)
defaultBehavior.FunctionAssociations = {
  Quantity: otherAssocs.length + 1,
  Items: [...otherAssocs, { FunctionARN: fnArn, EventType: 'viewer-request' }],
}

const tmpDir = join(tmpdir(), 'mushi-cf-apex-redirect')
try {
  mkdirSync(tmpDir, { recursive: true })
} catch {
  /* exists */
}
const tmpFile = join(tmpDir, 'cf-update-config.json')
writeFileSync(tmpFile, JSON.stringify(config))
console.log(`Attaching ${FN_NAME} to Default cache behavior (viewer-request)...`)
console.log(`Config written to ${tmpFile}`)

const resultRaw = awsRawOrThrow(
  `cloudfront update-distribution --id ${DIST_ID} --if-match ${etag} --distribution-config file://${tmpFile.replace(/\\/g, '/')} --region us-east-1`,
)
const parsed = JSON.parse(resultRaw)
console.log(`SUCCESS. New ETag: ${parsed.ETag}`)
console.log(`Distribution status: ${parsed.Distribution?.Status ?? parsed.Status}`)

console.log('\nDone. CloudFront will propagate changes in ~5 minutes.')
console.log('Verify with:')
console.log('  curl -sI https://kensaur.us/quickstart/incident-loop | grep -i location')
console.log('  curl -sI https://kensaur.us/reports/<any-uuid> | grep -i location')
