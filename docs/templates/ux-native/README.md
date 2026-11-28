# Score a native app's screens on the UX scorecard

The UX scorecard judges every screen on one written rubric (ADR 0067). A
browser run captures web pages itself; for a phone app, any driver captures
the screens and `mushi-ux upload` sends them (ADR 0073). Mushi never drives
your device: these scripts run on your own machine or CI.

## The layout

```
captures/
  pages/
    welcome/
      settled.png        required: the screen once it stopped changing
      early.png          optional: about 1 s after it opened (loading states)
      facts.json         optional: any page facts you know (key, label, text, controls, viewport)
      window.xml         optional: Android `uiautomator dump` (the screen's text and buttons)
      hierarchy.json     optional: `maestro hierarchy` (Android and iOS)
    sign-up/
      settled.png
      window.xml
```

One folder per screen; the folder name is the screen's name unless
`facts.json` gives a `key`. With `window.xml` or `hierarchy.json` the scorer
reads the screen's words and buttons; with a bare PNG it scores pixels only.
Settle time and accessibility checks are not measured on a device and show as
"not measured".

## The templates

| File | Driver | Captures |
|---|---|---|
| [`maestro-flow.yaml`](maestro-flow.yaml) | [Maestro](https://maestro.mobile.dev) (Android and iOS) | Walks your onboarding and takes a screenshot per screen; `maestro hierarchy` on a screen adds its words and buttons |
| [`android-capture.sh`](android-capture.sh) | `adb` | The screen on the connected device or emulator, with its `uiautomator` dump |
| [`ios-simulator-capture.sh`](ios-simulator-capture.sh) | `xcrun simctl` | The booted iOS simulator's screen |

Run the shell scripts in bash or Git Bash. **Not in Windows PowerShell 5.1:**
`adb exec-out screencap -p > x.png` there re-encodes the bytes and corrupts the
PNG (`mushi-ux upload` refuses it and says why).

## Upload and score

```bash
npx @mushi-mushi/ux upload ./captures --platform android --device "Pixel 8 (API 35)" --source adb --scale 2.625
# or through the CLI login:
npx @mushi-mushi/cli ux upload ./captures --platform ios --device "iPhone 16 simulator" --source simctl --scale 3
```

- `--platform`: ios, android, flutter, react_native, capacitor, web or other.
- `--scale`: the device's pixels per point, so the run's viewport is in points
  (most phones 2 to 3). Without it the viewport is in pixels.
- `--max-cost <usd>`: the most this run may spend on scoring. The run reserves
  one estimate per screen plus one grouping call before it starts, and a call
  past the reservation is refused.
- `--file`: file the top root causes as reports (at most five a run).
- `--no-score`: only upload; the run waits on the console.

It needs `MUSHI_API_KEY` (an `mcp:write` key: `mushi login`) and
`MUSHI_PROJECT_ID`. The public SDK key cannot upload. From an editor, the MCP
tool `upload_ux_captures` does the same (with `dir` on the stdio server).

The run shows under Check → UX runs → Scorecard with a platform badge.

## The SDKs' debug screenshot

The iOS, Android, Flutter and Capacitor SDKs attach a screenshot to a bug
report (`ScreenshotCapture.captureBase64` on iOS and Android, the
`RepaintBoundary` capture on Flutter). It is a base64 **JPEG** of the current
window, made for reports, not for the scorecard. To use it in a debug build:
write the decoded bytes to the app's files directory, pull the file
(`adb pull`, or `xcrun simctl get_app_container booted <bundle id> data` on
iOS), convert it to PNG (`sips -s format png in.jpg --out settled.png` on
macOS, or ImageMagick `magick in.jpg settled.png`), and put it in
`pages/<screen>/settled.png`. A device screenshot from `adb` or `simctl` is
sharper and needs no app change, so prefer the scripts above.
