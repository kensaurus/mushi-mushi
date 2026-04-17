#!/bin/bash
#
# FILE: setup-aws-infra.sh
# PURPOSE: Documents the one-time AWS infrastructure setup that was performed
#          for the Mushi Mushi admin console deployment at kensaur.us/mushi-mushi
#
# OVERVIEW:
# This script is a reference — the setup has already been completed.
# It documents what was configured so it can be reproduced or debugged.
#
# ARCHITECTURE:
# - Dedicated S3 bucket: kensaur.us-mushi-mushi (ap-northeast-1)
# - Static website hosting enabled (index.html / index.html)
# - Public read bucket policy for CloudFront custom origin
# - Two CloudFront cache behaviors: /mushi-mushi and /mushi-mushi/*
# - Two CloudFront Functions: mushi-mushi-spa-router (viewer-request)
#   and mushi-mushi-spa-response (viewer-response)
# - GitHub Actions workflow (deploy-admin.yml) handles all subsequent deploys
#
# NOTES:
# - The S3 bucket kensaur.us-glot-it already had static website hosting enabled
# - The github-actions-deploy IAM user already had write access to this bucket
# - CloudFront Functions were created and published via the deploy user
# - The distribution update added behaviors pointing to the existing origin
#

set -euo pipefail

DIST_ID="E246VQ1C9QYZVB"

echo "=== Step 1: Create CloudFront Functions ==="

for FUNC in mushi-mushi-spa-router mushi-mushi-spa-response; do
  if [ "$FUNC" = "mushi-mushi-spa-router" ]; then
    COMMENT="SPA routing for mushi-mushi admin console"
    FILE="scripts/cloudfront-mushi-spa-router.js"
  else
    COMMENT="Security headers and 404 handling for mushi-mushi"
    FILE="scripts/cloudfront-mushi-spa-response.js"
  fi

  EXISTING_ETAG=$(aws cloudfront describe-function --name "$FUNC" --region us-east-1 \
    --query 'ETag' --output text 2>/dev/null || echo "")

  if [ -z "$EXISTING_ETAG" ] || [ "$EXISTING_ETAG" = "None" ]; then
    aws cloudfront create-function \
      --name "$FUNC" \
      --function-config "{\"Comment\":\"$COMMENT\",\"Runtime\":\"cloudfront-js-2.0\"}" \
      --function-code "fileb://$FILE" \
      --region us-east-1
  else
    aws cloudfront update-function \
      --name "$FUNC" \
      --if-match "$EXISTING_ETAG" \
      --function-config "{\"Comment\":\"$COMMENT\",\"Runtime\":\"cloudfront-js-2.0\"}" \
      --function-code "fileb://$FILE" \
      --region us-east-1
  fi

  ETAG=$(aws cloudfront describe-function --name "$FUNC" --region us-east-1 \
    --query 'ETag' --output text)
  aws cloudfront publish-function --name "$FUNC" --if-match "$ETAG" --region us-east-1
  echo "Published: $FUNC"
done

echo ""
echo "=== Step 2: Add cache behaviors to CloudFront distribution ==="
echo "This was done via AWS CLI update-distribution."
echo "Added /mushi-mushi and /mushi-mushi/* behaviors pointing to kensaur.us/mushi-mushi origin."
echo "The /mushi-mushi/* behavior has both CF functions associated."
echo ""
echo "=== Setup Complete ==="
echo "Deploy via: git push to master (triggers .github/workflows/deploy-admin.yml)"
echo "URL: https://kensaur.us/mushi-mushi/"
