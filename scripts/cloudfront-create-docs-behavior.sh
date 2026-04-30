#!/usr/bin/env bash
##
# FILE: scripts/cloudfront-create-docs-behavior.sh
# PURPOSE: One-shot infra step that creates the `/mushi-mushi/docs/*` cache
#          behavior on the kensaur.us CloudFront distribution and attaches
#          the docs router/response functions to it.
#
# WHY THIS EXISTS
# ---------------
# The kensaur.us distribution historically routed both the admin SPA and the
# docs site through a single shared `/mushi-mushi/*` cache behavior. That
# means there was nowhere to attach `mushi-mushi-docs-response` (the editorial
# 404 function) without clobbering the admin's own viewer-response function —
# CloudFront allows only one function per event-type per behavior.
#
# `scripts/associate-cloudfront-docs-functions.sh` (added in PR #80) prints
# a `::warning::` and exits 0 in this state, so docs deploys still complete,
# but the docs synthetic 404 keeps leaking the raw S3 NoSuchKey XML. The fix
# is to add a more specific cache behavior that the existing script can then
# attach the functions to.
#
# This script is the one-time infra mutation that adds that behavior. It
# runs from a `workflow_dispatch` job so the GitHub-stored AWS credentials
# (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFRONT_DISTRIBUTION_ID`)
# are available; running locally requires the same env vars.
#
# IDEMPOTENCY
# -----------
# - Exits 0 with no mutation if `/mushi-mushi/docs/*` already exists.
# - Otherwise clones the parent `/mushi-mushi/*` behavior wholesale (origin,
#   cache policy, viewer protocol policy, allowed methods, etc.), overrides
#   `PathPattern` and `FunctionAssociations`, inserts the new behavior into
#   `CacheBehaviors.Items` immediately BEFORE the parent so CloudFront's
#   ordered cache-behavior matching evaluates the docs-specific pattern first,
#   bumps `CacheBehaviors.Quantity`, and calls `UpdateDistribution` with the
#   matching `IfMatch` ETag.
#
# CLOUDFRONT BEHAVIOR ORDERING
# ----------------------------
# Per AWS docs (Distributions / CacheBehaviors): "CloudFront sorts the cache
# behaviors that you create for a distribution based on the order that you
# specify. CloudFront evaluates the path patterns in the order of the cache
# behaviors you create until it finds a match." The default cache behavior is
# always last. So inserting `/mushi-mushi/docs/*` before `/mushi-mushi/*` is
# REQUIRED — putting it after would mean every docs request still matches the
# parent first and the new behavior is dead code.
#
# INPUTS (env)
# ------------
# - CLOUDFRONT_DISTRIBUTION_ID — required
# - DOCS_PATH_PATTERN          — defaults to `/mushi-mushi/docs/*`
# - PARENT_PATH_PATTERN        — defaults to `/mushi-mushi/*` (clone source)
# - ROUTER_FUNCTION_NAME       — defaults to `mushi-mushi-docs-router`
# - RESPONSE_FUNCTION_NAME     — defaults to `mushi-mushi-docs-response`
# - DRY_RUN=1                  — print the patched config and skip UpdateDistribution
##

set -euo pipefail

DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:?CLOUDFRONT_DISTRIBUTION_ID env var is required}"
DOCS_PATTERN="${DOCS_PATH_PATTERN:-/mushi-mushi/docs/*}"
PARENT_PATTERN="${PARENT_PATH_PATTERN:-/mushi-mushi/*}"
ROUTER_NAME="${ROUTER_FUNCTION_NAME:-mushi-mushi-docs-router}"
RESPONSE_NAME="${RESPONSE_FUNCTION_NAME:-mushi-mushi-docs-response}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (apt-get install -y jq)" >&2
  exit 1
fi

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
  echo "       deploy-docs.yml must run at least once before this script." >&2
  exit 1
fi
if [ -z "$RESPONSE_ARN" ] || [ "$RESPONSE_ARN" = "None" ]; then
  echo "error: response function not in LIVE stage: $RESPONSE_NAME" >&2
  echo "       deploy-docs.yml must run at least once before this script." >&2
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

# Idempotency: bail early if the docs behavior already exists. The
# associate-cloudfront-docs-functions.sh script will keep its associations
# in sync from then on.
EXISTS="$(jq --arg p "$DOCS_PATTERN" '[.CacheBehaviors.Items[] | select(.PathPattern == $p)] | length' "$WORK/config.json")"
if [ "$EXISTS" -gt 0 ]; then
  echo "ok: cache behavior \"$DOCS_PATTERN\" already exists. Nothing to do."
  exit 0
fi

PARENT_INDEX="$(jq --arg p "$PARENT_PATTERN" '[.CacheBehaviors.Items[].PathPattern] | index($p)' "$WORK/config.json")"
if [ "$PARENT_INDEX" = "null" ]; then
  echo "error: parent cache behavior \"$PARENT_PATTERN\" not found." >&2
  echo "       available patterns:" >&2
  jq -r '.CacheBehaviors.Items[].PathPattern' "$WORK/config.json" | sed 's/^/         - /' >&2
  exit 1
fi
echo "cloning parent behavior at index $PARENT_INDEX (\"$PARENT_PATTERN\") → \"$DOCS_PATTERN\""

# Build the new behavior by deep-copying the parent and overriding only the
# fields that need to differ. This keeps origin / cache policy / viewer
# protocol policy / compress / allowed-methods identical to whatever the
# parent has today, so any infrastructure change to the parent (e.g. a new
# cache policy) automatically applies to docs the next time this script
# is re-run on a fresh distribution where the docs behavior doesn't exist.
PATCHED="$(\
  jq \
    --arg docs "$DOCS_PATTERN" \
    --arg parent "$PARENT_PATTERN" \
    --arg router "$ROUTER_ARN" \
    --arg response "$RESPONSE_ARN" \
    '
    . as $config
    | ($config.CacheBehaviors.Items | map(.PathPattern) | index($parent)) as $idx
    | ($config.CacheBehaviors.Items[$idx]) as $template
    | ($template
        | .PathPattern = $docs
        | .FunctionAssociations = {
            Quantity: 2,
            Items: [
              { EventType: "viewer-request",  FunctionARN: $router   },
              { EventType: "viewer-response", FunctionARN: $response }
            ]
          }
      ) as $newBehavior
    | .CacheBehaviors.Items = (
        $config.CacheBehaviors.Items[0:$idx]
        + [$newBehavior]
        + $config.CacheBehaviors.Items[$idx:]
      )
    | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
    ' "$WORK/config.json"
)"

# Show the new behavior so a human can sanity-check before AWS applies it.
echo "new behavior:"
echo "$PATCHED" | jq --arg p "$DOCS_PATTERN" '.CacheBehaviors.Items[] | select(.PathPattern == $p)'
echo "behaviors after patch (in order):"
echo "$PATCHED" | jq -r '.CacheBehaviors.Items[].PathPattern' | sed 's/^/  - /'

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
echo "next: re-run \`Deploy Docs Site\` (or \`scripts/associate-cloudfront-docs-functions.sh\`) to confirm the no-op idempotent state."
