#!/usr/bin/env node
/**
 * setup-aws-github-oidc.mjs
 *
 * One-time script: creates the GitHub Actions OIDC identity provider and an
 * IAM role that the deploy-admin.yml / deploy-docs.yml workflows can assume
 * in place of long-lived IAM keys.
 *
 * Requires: AWS credentials with IAM admin permissions in the environment.
 *
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=yyy node scripts/setup-aws-github-oidc.mjs
 *
 * After success the script prints the role ARN and sets it as the
 * GITHUB_REPO secret AWS_ROLE_ARN via the `gh` CLI (already authenticated).
 */

import { execSync } from 'child_process'

// ── Config ────────────────────────────────────────────────────────────────────
const ACCOUNT_ID       = '590715976857'
const GITHUB_ORG_REPO  = 'kensaurus/mushi-mushi'
const ROLE_NAME        = 'github-actions-mushi-mushi-deploy'
const S3_BUCKET        = 'kensaur.us-mushi-mushi'
const CF_DISTRIBUTION  = 'E246VQ1C9QYZVB'
const REGION           = process.env.AWS_REGION ?? 'ap-northeast-1'

// GitHub Actions OIDC thumbprint (root certificate for token.actions.githubusercontent.com)
const OIDC_THUMBPRINT  = '6938fd4d98bab03faadb97b34396831e3780aea1'
const OIDC_URL         = 'https://token.actions.githubusercontent.com'
const OIDC_ARN         = `arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com`
const ROLE_ARN         = `arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}`

function aws(cmd, region = REGION) {
  const env = { ...process.env, AWS_REGION: region }
  try {
    return execSync(`aws ${cmd}`, { env, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim()
  } catch (e) {
    return e.stderr?.trim() ?? ''
  }
}

function awsRequired(cmd, region = REGION) {
  const env = { ...process.env, AWS_REGION: region }
  return execSync(`aws ${cmd}`, { env, encoding: 'utf-8' }).trim()
}

console.log('─── Step 1: Verify AWS identity ──────────────────────────────────────')
const identity = JSON.parse(awsRequired('sts get-caller-identity', 'us-east-1'))
console.log(`  Account : ${identity.Account}`)
console.log(`  ARN     : ${identity.Arn}`)

if (identity.Account !== ACCOUNT_ID) {
  console.error(`ERROR: expected account ${ACCOUNT_ID}, got ${identity.Account}`)
  process.exit(1)
}

// ── Step 2: OIDC provider ────────────────────────────────────────────────────
console.log('\n─── Step 2: GitHub Actions OIDC identity provider ────────────────────')
const providerList = aws('iam list-open-id-connect-providers', 'us-east-1')
if (providerList.includes(OIDC_ARN)) {
  console.log('  ✓ OIDC provider already exists — skipping creation')
} else {
  console.log('  Creating OIDC provider …')
  awsRequired(
    `iam create-open-id-connect-provider ` +
    `--url "${OIDC_URL}" ` +
    `--client-id-list "sts.amazonaws.com" ` +
    `--thumbprint-list "${OIDC_THUMBPRINT}"`,
    'us-east-1'
  )
  console.log(`  ✓ Created: ${OIDC_ARN}`)
}

// ── Step 3: IAM role trust policy ────────────────────────────────────────────
console.log('\n─── Step 3: IAM role ─────────────────────────────────────────────────')
const trustPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Federated: OIDC_ARN },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          // Allow all branches/events from this repo (master push + workflow_dispatch)
          'token.actions.githubusercontent.com:sub': `repo:${GITHUB_ORG_REPO}:*`,
        },
      },
    },
  ],
})

const existingRole = aws(`iam get-role --role-name ${ROLE_NAME}`, 'us-east-1')
if (existingRole.includes(ROLE_NAME)) {
  console.log(`  ✓ Role ${ROLE_NAME} already exists — updating trust policy`)
  awsRequired(
    `iam update-assume-role-policy --role-name ${ROLE_NAME} --policy-document '${trustPolicy}'`,
    'us-east-1'
  )
} else {
  console.log(`  Creating role ${ROLE_NAME} …`)
  awsRequired(
    `iam create-role --role-name ${ROLE_NAME} ` +
    `--assume-role-policy-document '${trustPolicy}' ` +
    `--description "Used by GitHub Actions OIDC for mushi-mushi deploy workflows"`,
    'us-east-1'
  )
  console.log(`  ✓ Created role: ${ROLE_ARN}`)
}

// ── Step 4: Inline permissions policy ────────────────────────────────────────
console.log('\n─── Step 4: Permissions policy ───────────────────────────────────────')
const permissionsPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    // S3: full access to the deploy bucket
    {
      Sid: 'S3DeployBucket',
      Effect: 'Allow',
      Action: [
        's3:GetObject', 's3:PutObject', 's3:DeleteObject',
        's3:ListBucket', 's3:GetBucketLocation',
        's3:GetObjectAcl', 's3:PutObjectAcl',
      ],
      Resource: [
        `arn:aws:s3:::${S3_BUCKET}`,
        `arn:aws:s3:::${S3_BUCKET}/*`,
      ],
    },
    // CloudFront: invalidations on the deploy distribution
    {
      Sid: 'CloudFrontInvalidation',
      Effect: 'Allow',
      Action: [
        'cloudfront:CreateInvalidation',
        'cloudfront:GetDistribution',
        'cloudfront:GetDistributionConfig',
        'cloudfront:UpdateDistribution',
        'cloudfront:ListDistributions',
      ],
      Resource: [
        `arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${CF_DISTRIBUTION}`,
      ],
    },
    // CloudFront Functions: SPA router + response functions
    {
      Sid: 'CloudFrontFunctions',
      Effect: 'Allow',
      Action: [
        'cloudfront:CreateFunction',
        'cloudfront:UpdateFunction',
        'cloudfront:PublishFunction',
        'cloudfront:DescribeFunction',
        'cloudfront:ListFunctions',
        'cloudfront:GetFunction',
      ],
      Resource: ['*'],
    },
  ],
})

awsRequired(
  `iam put-role-policy --role-name ${ROLE_NAME} ` +
  `--policy-name mushi-mushi-deploy-policy ` +
  `--policy-document '${permissionsPolicy}'`,
  'us-east-1'
)
console.log('  ✓ Inline policy attached')

// ── Step 5: Set GitHub secret ─────────────────────────────────────────────────
console.log('\n─── Step 5: Set AWS_ROLE_ARN GitHub secret ───────────────────────────')
try {
  execSync(
    `gh secret set AWS_ROLE_ARN --body "${ROLE_ARN}" --repo ${GITHUB_ORG_REPO}`,
    { encoding: 'utf-8', stdio: 'inherit' }
  )
  console.log(`  ✓ GitHub secret AWS_ROLE_ARN set to ${ROLE_ARN}`)
} catch {
  console.error(`  ✗ Could not set GitHub secret via gh CLI. Set it manually:`)
  console.error(`      gh secret set AWS_ROLE_ARN --body "${ROLE_ARN}" --repo ${GITHUB_ORG_REPO}`)
}

console.log('\n══════════════════════════════════════════════════════════════════════')
console.log(`  ✅ Done! Role ARN: ${ROLE_ARN}`)
console.log('')
console.log('  Next: delete the old AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY')
console.log('  GitHub secrets to complete the migration:')
console.log(`    gh secret delete AWS_ACCESS_KEY_ID --repo ${GITHUB_ORG_REPO}`)
console.log(`    gh secret delete AWS_SECRET_ACCESS_KEY --repo ${GITHUB_ORG_REPO}`)
console.log('══════════════════════════════════════════════════════════════════════')
