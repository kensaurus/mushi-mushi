/**
 * FILE: apps/admin/src/lib/sdkLockfileHelper.ts
 * PURPOSE: The host workflow that refreshes the lockfile on Mushi SDK upgrade
 *          branches (ADR 0019), shown as a copy block in SdkUpgradeCTA.
 *
 * Must equal docs/templates/mushi-sdk-lockfile.yml byte for byte;
 * sdkLockfileHelper.test.ts enforces it.
 */

export const SDK_LOCKFILE_WORKFLOW_PATH = '.github/workflows/mushi-sdk-lockfile.yml'

export const SDK_LOCKFILE_DOCS_URL = 'https://kensaur.us/mushi-mushi/docs/admin/sdk-upgrade-lockfile'

export const SDK_LOCKFILE_WORKFLOW_YAML = [
  "# Mushi SDK lockfile helper. Save as .github/workflows/mushi-sdk-lockfile.yml",
  "# on your default branch. Mushi then pushes each @mushi-mushi/* bump first,",
  "# this workflow refreshes the lockfile, and the upgrade PR opens after it.",
  "# Docs: https://kensaur.us/mushi-mushi/docs/admin/sdk-upgrade-lockfile",
  "name: Mushi SDK lockfile",
  "",
  "on:",
  "  push:",
  "    branches: ['mushi/sdk-upgrade-**']",
  "",
  "permissions:",
  "  contents: write",
  "",
  "concurrency:",
  "  group: mushi-lockfile-${{ github.ref }}",
  "  cancel-in-progress: true",
  "",
  "jobs:",
  "  lockfile:",
  "    # Never react to this workflow's own lockfile commit.",
  "    if: github.actor != 'github-actions[bot]'",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1",
  "        with:",
  "          fetch-depth: 2",
  "      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e  # v6.4.0",
  "        with:",
  "          # No version file? Replace with  node-version: 22",
  "          node-version-file: .nvmrc  # or .node-version / package.json",
  "      # Private registry? Write ~/.npmrc auth from a secret before this step, e.g.",
  "      #   - run: echo \"//npm.pkg.github.com/:_authToken=${NPM_TOKEN}\" >> ~/.npmrc",
  "      #     env:",
  "      #       NPM_TOKEN: ${{ secrets.NPM_TOKEN }}",
  "      - uses: kensaurus/mushi-mushi/.github/actions/sdk-lockfile-refresh@master",
  '',
].join('\n')
