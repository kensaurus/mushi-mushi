#!/usr/bin/env bash
# Capture the booted iOS simulator's screen for the UX scorecard (ADR 0073):
# pages/<screen>/early.png and settled.png. simctl has no view hierarchy; for
# the screen's words and buttons, use the Maestro flow (maestro-flow.yaml),
# which can dump one, or write facts.json yourself.
#
#   ./ios-simulator-capture.sh welcome         # after you opened the screen
#   ./ios-simulator-capture.sh sign-up 2       # wait 2 s first (default 1.5)
#   OUT=./captures SIM=<udid> ./ios-simulator-capture.sh home
#
# Then: npx @mushi-mushi/ux upload ./captures --platform ios --source simctl --device "<model> simulator" --scale 3
set -euo pipefail

name="${1:?usage: ios-simulator-capture.sh <screen-name> [wait-seconds]}"
wait="${2:-1.5}"
out="${OUT:-./captures}"
sim="${SIM:-booted}"
case "$name" in
  *[!a-zA-Z0-9._-]*|'') echo "screen name: letters, digits, dot, dash, underscore only" >&2; exit 2 ;;
esac
command -v xcrun >/dev/null || { echo "xcrun not found (Xcode command line tools)" >&2; exit 2; }

dir="$out/pages/$name"
mkdir -p "$dir"
xcrun simctl io "$sim" screenshot --type=png "$dir/early.png" >/dev/null
sleep "$wait"
xcrun simctl io "$sim" screenshot --type=png "$dir/settled.png" >/dev/null
echo "captured $dir"
