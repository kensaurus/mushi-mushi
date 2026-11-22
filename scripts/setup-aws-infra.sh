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
# - One Mushi-owned CloudFront Function published from here:
#   mushi-mushi-spa-response (viewer-response)
# - GitHub Actions workflow (deploy-admin.yml) handles all subsequent deploys
#
# NOT HERE: the kensaur.us distribution (E246VQ1C9QYZVB) config — cache
# behaviours, function associations and the routing functions — is owned by
# kensaurus/kensaur.us `infra/edge/`.
#
# NOTES:
# - The S3 bucket kensaur.us-mushi-mushi already had static website hosting enabled
# - The github-actions-deploy IAM user already had write access to this bucket
# - CloudFront Functions were created and published via the deploy user
#

set -euo pipefail

echo "=== Publish CloudFront Function code (Mushi-owned) ==="

FUNC="mushi-mushi-spa-response"
COMMENT="Security headers and 404 handling for mushi-mushi"
FILE="scripts/cloudfront-mushi-spa-response.js"

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

echo ""
echo "Behaviours and associations on kensaur.us: kensaurus/kensaur.us infra/edge/"
echo "Deploy via: git push to master (triggers .github/workflows/deploy-admin.yml)"
echo "URL: https://kensaur.us/mushi-mushi/"
