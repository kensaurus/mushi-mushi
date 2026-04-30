#!/usr/bin/env bash
##
# FILE: scripts/associate-cloudfront-docs-functions.sh
# PURPOSE: Idempotently attach the docs CloudFront Functions
#          (`mushi-mushi-docs-router` on viewer-request,
#           `mushi-mushi-docs-response` on viewer-response) to the
#          `/mushi-mushi/docs/*` cache behavior of the kensaur.us
#          distribution.
#
# WHY THIS EXISTS
# ---------------
# `aws cloudfront publish-function` only puts the function into the LIVE
# stage of the Functions service — it does NOT attach the function to any
# distribution behavior. Each cache behavior has to opt in via
# `FunctionAssociations`. Without this step, the editorial 404 body
# returned by mushi-mushi-docs-response is silently dropped and visitors
# see the raw S3 NoSuchKey XML for missing pages (regression observed in
# production after PR #77 deployed). This script closes that gap.
#
# The script is safe to re-run:
#   1. Fetches the current distribution config + ETag.
#   2. Locates the cache behavior whose PathPattern matches DOCS_PATH_PATTERN.
#   3. If FunctionAssociations already match desired (router on
#      viewer-request, response on viewer-response), exits 0 with no
#      mutation. Otherwise patches and calls UpdateDistribution with the
#      matching IfMatch ETag.
#
# INPUTS (env)
# ------------
# - CLOUDFRONT_DISTRIBUTION_ID — required
# - DOCS_PATH_PATTERN          — defaults to `/mushi-mushi/docs/*`
# - ROUTER_FUNCTION_NAME       — defaults to `mushi-mushi-docs-router`
# - RESPONSE_FUNCTION_NAME     — defaults to `mushi-mushi-docs-response`
# - DRY_RUN=1                  — print desired patch but skip UpdateDistribution
##

set -euo pipefail

DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:?CLOUDFRONT_DISTRIBUTION_ID env var is required}"
PATH_PATTERN="${DOCS_PATH_PATTERN:-/mushi-mushi/docs/*}"
ROUTER_NAME="${ROUTER_FUNCTION_NAME:-mushi-mushi-docs-router}"
RESPONSE_NAME="${RESPONSE_FUNCTION_NAME:-mushi-mushi-docs-response}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (apt-get install -y jq)" >&2
  exit 1
fi

# CloudFront Functions ARNs are global. DescribeFunction returns the
# canonical ARN so we don't have to assemble it from account ID.
get_fn_arn() {
  local name="$1"
  aws cloudfront describe-function \
    --name "$name" \
    --stage LIVE \
    --region us-east-1 \
    --query 'FunctionSummary.FunctionMetadata.FunctionARN' \
    --output text
}

ROUTER_ARN="$(get_fn_arn "$ROUTER_NAME")"
RESPONSE_ARN="$(get_fn_arn "$RESPONSE_NAME")"

if [ -z "$ROUTER_ARN" ] || [ "$ROUTER_ARN" = "None" ]; then
  echo "error: router function not in LIVE stage: $ROUTER_NAME" >&2
  exit 1
fi
if [ -z "$RESPONSE_ARN" ] || [ "$RESPONSE_ARN" = "None" ]; then
  echo "error: response function not in LIVE stage: $RESPONSE_NAME" >&2
  exit 1
fi

echo "router  ARN: $ROUTER_ARN"
echo "response ARN: $RESPONSE_ARN"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

aws cloudfront get-distribution-config \
  --id "$DIST_ID" \
  --region us-east-1 \
  > "$WORK/dist.json"

ETAG="$(jq -r '.ETag' "$WORK/dist.json")"
jq '.DistributionConfig' "$WORK/dist.json" > "$WORK/config.json"

# Surgical jq patch: locate the cache behavior whose PathPattern matches,
# replace its FunctionAssociations with the canonical 2-entry shape, and
# leave every other field untouched.
PATCHED="$(
  jq \
    --arg pattern "$PATH_PATTERN" \
    --arg router "$ROUTER_ARN" \
    --arg response "$RESPONSE_ARN" \
    '
    .CacheBehaviors.Items |= map(
      if .PathPattern == $pattern then
        .FunctionAssociations = {
          Quantity: 2,
          Items: [
            { EventType: "viewer-request",  FunctionARN: $router   },
            { EventType: "viewer-response", FunctionARN: $response }
          ]
        }
      else . end
    )
    ' "$WORK/config.json"
)"

# Sanity check: did the pattern actually match a behavior?
MATCHED="$(echo "$PATCHED" | jq --arg p "$PATH_PATTERN" '[.CacheBehaviors.Items[] | select(.PathPattern == $p)] | length')"
if [ "$MATCHED" -eq 0 ]; then
  echo "error: no cache behavior matches PathPattern=\"$PATH_PATTERN\"" >&2
  echo "       available patterns:" >&2
  jq -r '.CacheBehaviors.Items[].PathPattern' "$WORK/config.json" | sed 's/^/         - /' >&2
  exit 1
fi

# Compare current vs. desired so we can skip the API call when nothing
# would actually change. CloudFront UpdateDistribution is non-trivial
# (even a no-op churns the deployment graph), so idempotency matters.
CURRENT="$(jq --arg p "$PATH_PATTERN" '[.CacheBehaviors.Items[] | select(.PathPattern == $p)][0].FunctionAssociations // {Quantity:0,Items:[]}' "$WORK/config.json")"
DESIRED="$(echo "$PATCHED" | jq --arg p "$PATH_PATTERN" '[.CacheBehaviors.Items[] | select(.PathPattern == $p)][0].FunctionAssociations')"

if [ "$(echo "$CURRENT" | jq -cS '.Items |= sort_by(.EventType)')" = "$(echo "$DESIRED" | jq -cS '.Items |= sort_by(.EventType)')" ]; then
  echo "ok: cache behavior \"$PATH_PATTERN\" is already correctly associated. No change."
  exit 0
fi

echo "patching cache behavior \"$PATH_PATTERN\":"
echo "  current: $CURRENT"
echo "  desired: $DESIRED"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 — skipping UpdateDistribution call."
  exit 0
fi

echo "$PATCHED" > "$WORK/patched.json"

aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config "file://$WORK/patched.json" \
  --region us-east-1 \
  > "$WORK/update.json"

echo "ok: UpdateDistribution accepted. CloudFront propagation typically completes in 1–3 minutes."
