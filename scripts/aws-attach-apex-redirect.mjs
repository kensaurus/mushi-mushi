/**
 * FILE: scripts/aws-attach-apex-redirect.mjs
 * PURPOSE: Attach apex-domain redirects on kensaur.us by updating the distribution
 *          Default cache behavior with a combined viewer-request function.
 *
 * The kensaur.us distribution is at the 75 cache-behavior quota, so per-path
 * behaviors are not used. Default already carries glot-it-spa-router for glot.it;
 * this script builds cloudfront-kensaur-default-viewer.js (Mushi 301s + glot SPA)
 * and associates it on Default instead.
 *
 * RUN: node scripts/aws-attach-apex-redirect.mjs
 * ENV: CLOUDFRONT_DISTRIBUTION_ID (or CF_DIST_ID), AWS credentials via OIDC or keys
 */

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || process.env.CF_DIST_ID || 'E246VQ1C9QYZVB'
const COMBINED_FN_NAME = 'kensaur-default-viewer'
const LEGACY_GLOT_FN = 'glot-it-spa-router'
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

function publishFunction(name, codeFile) {
  const configJson = JSON.stringify({
    Comment: 'kensaur.us Default viewer — Mushi apex redirects + glot.it SPA routing',
    Runtime: 'cloudfront-js-2.0',
  })
  const posixCode = codeFile.replace(/\\/g, '/')

  let etag = ''
  try {
    etag = aws(`cloudfront describe-function --name ${name} --region us-east-1`).ETag
  } catch {
    etag = ''
  }

  if (!etag) {
    awsRawOrThrow(
      `cloudfront create-function --name ${name} --function-config '${configJson}' --function-code fileb://${posixCode} --region us-east-1`,
    )
  } else {
    awsRawOrThrow(
      `cloudfront update-function --name ${name} --if-match ${etag} --function-config '${configJson}' --function-code fileb://${posixCode} --region us-east-1`,
    )
  }

  etag = aws(`cloudfront describe-function --name ${name} --region us-east-1`).ETag
  awsRawOrThrow(
    `cloudfront publish-function --name ${name} --if-match ${etag} --region us-east-1`,
  )
}

function viewerRequestAssoc(behavior) {
  const items = behavior?.FunctionAssociations?.Items ?? []
  return items.find((item) => item.EventType === 'viewer-request') ?? null
}

console.log('Building combined Default viewer function...')
execSync('node scripts/build-kensaur-default-viewer.mjs', {
  cwd: join(SCRIPT_DIR, '..'),
  stdio: 'inherit',
})
const combinedCodeFile = join(SCRIPT_DIR, 'cloudfront-kensaur-default-viewer.js')

console.log(`Publishing ${COMBINED_FN_NAME}...`)
publishFunction(COMBINED_FN_NAME, combinedCodeFile)

const fnArn = getLiveFunctionArn(COMBINED_FN_NAME)
if (!fnArn) {
  console.error(`ERROR: ${COMBINED_FN_NAME} is not in LIVE stage after publish.`)
  process.exit(1)
}
console.log(`Combined function ARN: ${fnArn}`)

console.log(`Fetching distribution config for ${DIST_ID}...`)
const distResp = aws(`cloudfront get-distribution-config --id ${DIST_ID} --region us-east-1`)
const etag = distResp.ETag
const config = distResp.DistributionConfig

console.log(`Current ETag: ${etag}`)
console.log(`Ordered cache behavior count: ${config.CacheBehaviors?.Quantity ?? 0}`)

if ((config.CacheBehaviors?.Quantity ?? 0) >= BEHAVIOR_LIMIT) {
  console.warn(
    `::warning::At ${config.CacheBehaviors.Quantity}/${BEHAVIOR_LIMIT} cache behaviors — using Default-behavior combined router only.`,
  )
}

const defaultBehavior = config.DefaultCacheBehavior
if (!defaultBehavior) {
  console.error('ERROR: Distribution has no DefaultCacheBehavior')
  process.exit(1)
}

const existingViewer = viewerRequestAssoc(defaultBehavior)
if (existingViewer?.FunctionARN === fnArn) {
  console.log(`${COMBINED_FN_NAME} already attached on Default viewer-request. Nothing to do.`)
  process.exit(0)
}

const legacyGlotArn = getLiveFunctionArn(LEGACY_GLOT_FN)
if (
  existingViewer?.FunctionARN &&
  existingViewer.FunctionARN !== fnArn &&
  existingViewer.FunctionARN !== legacyGlotArn
) {
  console.error(
    'ERROR: Default cache behavior has an unexpected viewer-request function:',
    existingViewer.FunctionARN,
  )
  console.error(`Expected ${COMBINED_FN_NAME} or legacy ${LEGACY_GLOT_FN}.`)
  process.exit(1)
}

if (existingViewer?.FunctionARN === legacyGlotArn) {
  console.log(`Replacing legacy ${LEGACY_GLOT_FN} on Default with ${COMBINED_FN_NAME}.`)
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
console.log(`Attaching ${COMBINED_FN_NAME} to Default cache behavior (viewer-request)...`)

const resultRaw = awsRawOrThrow(
  `cloudfront update-distribution --id ${DIST_ID} --if-match ${etag} --distribution-config file://${tmpFile.replace(/\\/g, '/')} --region us-east-1`,
)
const parsed = JSON.parse(resultRaw)
console.log(`SUCCESS. New ETag: ${parsed.ETag}`)
console.log(`Distribution status: ${parsed.Distribution?.Status ?? parsed.Status}`)

console.log('\nDone. CloudFront will propagate changes in ~5 minutes.')
console.log('Verify with:')
console.log('  curl -sI https://kensaur.us/quickstart/incident-loop | grep -i location')
console.log('  curl -sI https://kensaur.us/glot-it/ | head -3')
