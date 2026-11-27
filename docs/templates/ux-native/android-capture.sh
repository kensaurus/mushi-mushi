#!/usr/bin/env bash
# Capture the screen of the connected Android device or emulator for the UX
# scorecard (ADR 0073): pages/<screen>/settled.png plus its uiautomator dump,
# so the scorer reads the screen's words and buttons.
#
#   ./android-capture.sh welcome          # one screen, after you opened it
#   ./android-capture.sh sign-up 2        # wait 2 s first (default 1.5)
#   OUT=./captures ANDROID_SERIAL=emulator-5554 ./android-capture.sh home
#
# Then: npx @mushi-mushi/ux upload ./captures --platform android --source adb --device "<model>"
#
# Run in bash or Git Bash, never Windows PowerShell 5.1: its `>` re-encodes
# the bytes of `adb exec-out screencap -p` and corrupts the PNG.
set -euo pipefail

name="${1:?usage: android-capture.sh <screen-name> [wait-seconds]}"
wait="${2:-1.5}"
out="${OUT:-./captures}"
case "$name" in
  *[!a-zA-Z0-9._-]*|'') echo "screen name: letters, digits, dot, dash, underscore only" >&2; exit 2 ;;
esac
command -v adb >/dev/null || { echo "adb not found (Android platform-tools)" >&2; exit 2; }

dir="$out/pages/$name"
mkdir -p "$dir"

# about 1 s in: loading and placeholder states
adb exec-out screencap -p > "$dir/early.png"
sleep "$wait"
adb exec-out screencap -p > "$dir/settled.png"
# the screen's text and tappable labels; a dump can fail on a busy screen, so it is optional
if ! adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed -n 's/.*\(<?xml.*<\/hierarchy>\).*/\1/p' > "$dir/window.xml" || [ ! -s "$dir/window.xml" ]; then
  rm -f "$dir/window.xml"
  echo "note: no uiautomator dump for $name; it will be scored on pixels only" >&2
fi

# PNG check: the first 8 bytes are the PNG signature.
if [ "$(head -c 8 "$dir/settled.png" | od -An -tx1 | tr -d ' \n')" != "89504e470d0a1a0a" ]; then
  echo "$dir/settled.png is not a PNG (is the device unlocked and connected?)" >&2
  exit 1
fi
echo "captured $dir"
