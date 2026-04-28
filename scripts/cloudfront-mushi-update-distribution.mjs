#!/usr/bin/env node
/**
 * FILE: cloudfront-mushi-update-distribution.mjs
 * PURPOSE: Idempotently configure the kensaur.us CloudFront distribution to
 *          serve the unified `kensaur.us/mushi-mushi/*` topology:
 *
 *            /mushi-mushi/admin/*  -> S3   (apps/admin SPA)
 *            /mushi-mushi/docs/*   -> S3   (apps/docs static export)
 *            /mushi-mushi/*        -> Vercel (apps/cloud Next.js SSR)
 *
 *          The S3 origin already exists (it serves the legacy /mushi-mushi/*
 *          admin behavior). We add the Vercel origin and the three cache
 *          behaviors in priority order. Re-running the script is safe — it
 *          patches the live config rather than replacing it, and exits 0 if
 *          the desired state already matches.
 *
 * USAGE:   node scripts/cloudfront-mushi-update-distribution.mjs
 *
 * REQUIRED ENV:
 *   AWS_REGION                    (us-east-1; CF API is global but billed via us-east-1)
 *   CLOUDFRONT_DISTRIBUTION_ID    (e.g. E246VQ1C9QYZVB)
 *   VERCEL_CLOUD_HOSTNAME         (e.g. mushi-mushi-cloud.vercel.app)
 *   ADMIN_SPA_ROUTER_FUNCTION_ARN (output of `aws cloudfront describe-function ... --query 'FunctionSummary.FunctionMetadata.FunctionARN'`)
 *   ADMIN_SPA_RESPONSE_FUNCTION_ARN
 *   DOCS_ROUTER_FUNCTION_ARN
 *   DOCS_RESPONSE_FUNCTION_ARN
 *
 * NOTES:
 * - Designed to be invoked from .github/workflows/deploy-cloudfront.yml after
 *   the four CloudFront Functions exist (created/updated by the per-app
 *   deploy workflows). Running it locally with valid AWS creds works too.
 * - We use the AWS CLI rather than the SDK so this script works in the same
 *   minimal CI image the existing deploy-admin workflow uses.
 * - The Vercel origin uses TLSv1.2; CloudFront -> Vercel speaks HTTPS only.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const required = [
  'CLOUDFRONT_DISTRIBUTION_ID',
  'VERCEL_CLOUD_HOSTNAME',
  'ADMIN_SPA_ROUTER_FUNCTION_ARN',
  'ADMIN_SPA_RESPONSE_FUNCTION_ARN',
  'DOCS_ROUTER_FUNCTION_ARN',
  'DOCS_RESPONSE_FUNCTION_ARN',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`::error::Missing required env var ${key}`);
    process.exit(2);
  }
}

const distId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const vercelHost = process.env.VERCEL_CLOUD_HOSTNAME.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const adminRouterArn = process.env.ADMIN_SPA_ROUTER_FUNCTION_ARN;
const adminResponseArn = process.env.ADMIN_SPA_RESPONSE_FUNCTION_ARN;
const docsRouterArn = process.env.DOCS_ROUTER_FUNCTION_ARN;
const docsResponseArn = process.env.DOCS_RESPONSE_FUNCTION_ARN;
const tmp = mkdtempSync(join(tmpdir(), 'cf-mushi-'));

function aws(args) {
  return execSync(`aws ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

console.log(`[cf] fetching current distribution config for ${distId}…`);
const raw = aws(`cloudfront get-distribution-config --id ${distId} --region us-east-1 --output json`);
const wrapper = JSON.parse(raw);
const etag = wrapper.ETag;
const config = wrapper.DistributionConfig;

// ---------------------------------------------------------------------------
// 1. Ensure the cloud Vercel origin exists.
// ---------------------------------------------------------------------------
const VERCEL_ORIGIN_ID = 'mushi-cloud-vercel';
const hasVercelOrigin = config.Origins.Items.some((o) => o.Id === VERCEL_ORIGIN_ID);
if (!hasVercelOrigin) {
  console.log(`[cf] adding origin ${VERCEL_ORIGIN_ID} -> ${vercelHost}`);
  config.Origins.Items.push({
    Id: VERCEL_ORIGIN_ID,
    DomainName: vercelHost,
    OriginPath: '',
    CustomHeaders: { Quantity: 0, Items: [] },
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only',
      OriginSslProtocols: { Quantity: 1, Items: ['TLSv1.2'] },
      OriginReadTimeout: 30,
      OriginKeepaliveTimeout: 5,
    },
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
    OriginShield: { Enabled: false },
    OriginAccessControlId: '',
  });
  config.Origins.Quantity = config.Origins.Items.length;
} else {
  console.log(`[cf] origin ${VERCEL_ORIGIN_ID} already present`);
}

// ---------------------------------------------------------------------------
// 2. Ensure the three /mushi-mushi/* cache behaviors are present and ordered.
//    Priority is decided by the position in CacheBehaviors.Items; CloudFront
//    matches the first PathPattern that fits, so the *more specific* prefix
//    must come first. We replace the legacy `/mushi-mushi/*` -> S3 behavior
//    with a Vercel-pointing default and split admin/docs out underneath.
// ---------------------------------------------------------------------------
//
// AWS-managed cache policies (stable IDs documented in the CF API):
//   CachingOptimized   = 658327ea-f89d-4fab-a63d-7e88639e58f6
//   CachingDisabled    = 4135ea2d-6df8-44a3-9df3-4b5a84be39ad
// AWS-managed origin request policies:
//   AllViewerExceptHostHeader = b689b0a8-53d0-40ab-baf2-68738e2966ac
//   CORS-S3Origin             = 88a5eaf4-2fd4-4709-b370-b4c650ea3fcf
const CACHE_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const CACHE_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const ORIGIN_REQ_ALL_VIEWER = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';

const S3_ORIGIN_ID = config.Origins.Items.find((o) => o.S3OriginConfig)?.Id;
if (!S3_ORIGIN_ID) {
  console.error('::error::Could not locate the S3 origin in the existing distribution');
  process.exit(3);
}

const wantBehaviors = [
  {
    PathPattern: '/mushi-mushi/admin/*',
    TargetOriginId: S3_ORIGIN_ID,
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: { Quantity: 2, Items: ['GET', 'HEAD'], CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] } },
    Compress: true,
    CachePolicyId: CACHE_OPTIMIZED,
    FunctionAssociations: {
      Quantity: 2,
      Items: [
        { EventType: 'viewer-request', FunctionARN: adminRouterArn },
        { EventType: 'viewer-response', FunctionARN: adminResponseArn },
      ],
    },
    LambdaFunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: '',
    SmoothStreaming: false,
  },
  {
    PathPattern: '/mushi-mushi/docs/*',
    TargetOriginId: S3_ORIGIN_ID,
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: { Quantity: 2, Items: ['GET', 'HEAD'], CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] } },
    Compress: true,
    CachePolicyId: CACHE_OPTIMIZED,
    FunctionAssociations: {
      Quantity: 2,
      Items: [
        { EventType: 'viewer-request', FunctionARN: docsRouterArn },
        { EventType: 'viewer-response', FunctionARN: docsResponseArn },
      ],
    },
    LambdaFunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: '',
    SmoothStreaming: false,
  },
  {
    PathPattern: '/mushi-mushi/*',
    TargetOriginId: VERCEL_ORIGIN_ID,
    ViewerProtocolPolicy: 'redirect-to-https',
    // Cloud surface includes server actions (Stripe, Supabase auth) — never cache.
    AllowedMethods: {
      Quantity: 7,
      Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
    },
    Compress: true,
    CachePolicyId: CACHE_DISABLED,
    OriginRequestPolicyId: ORIGIN_REQ_ALL_VIEWER,
    FunctionAssociations: { Quantity: 0 },
    LambdaFunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: '',
    SmoothStreaming: false,
  },
];

// Drop any existing behavior whose pattern matches a slot we want to own —
// then prepend ours. Anything else (e.g. cross-app rules outside /mushi-mushi)
// is kept untouched.
const ownedPatterns = new Set(wantBehaviors.map((b) => b.PathPattern));
const keptBehaviors = (config.CacheBehaviors?.Items ?? []).filter(
  (b) => !ownedPatterns.has(b.PathPattern),
);
const newBehaviors = [...wantBehaviors, ...keptBehaviors];

config.CacheBehaviors = {
  Quantity: newBehaviors.length,
  Items: newBehaviors,
};

// ---------------------------------------------------------------------------
// 3. Submit the patched config back to CloudFront.
// ---------------------------------------------------------------------------
const patchPath = join(tmp, 'distribution-config.json');
writeFileSync(patchPath, JSON.stringify(config, null, 2));
console.log(`[cf] writing patched config to ${patchPath}`);

console.log(`[cf] updating distribution ${distId} (etag ${etag})…`);
const updateOut = aws(
  `cloudfront update-distribution --id ${distId} --if-match ${etag} ` +
    `--distribution-config file://${patchPath} --region us-east-1 --output json`,
);
const updated = JSON.parse(updateOut);
console.log(`[cf] update accepted; new ETag ${updated.ETag}`);

console.log(`[cf] creating invalidation for /mushi-mushi/*…`);
aws(
  `cloudfront create-invalidation --distribution-id ${distId} ` +
    `--paths "/mushi-mushi/*" --region us-east-1`,
);
console.log('[cf] done.');
