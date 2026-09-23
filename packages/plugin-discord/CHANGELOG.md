# @mushi-mushi/plugin-discord

## 0.1.6

### Patch Changes

- f5e94ce: npm metadata. The author link on the npm page now points at an account that exists: the maintainer's GitHub profile, instead of a Bluesky handle that was never registered. The Node floor is `>=20.19.0`, the same as `@mushi-mushi/core`. The `funding` field is gone, because it pointed at a GitHub Sponsors page that is not enabled and `npm fund` listed a dead link.
- f5e94ce: Smaller install. The package no longer ships the repository's `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md` — 32 KB in every tarball, more than the code in some packages. They are still in the GitHub repository the npm page links to.
- Updated dependencies [f5e94ce]
- Updated dependencies [f5e94ce]
  - @mushi-mushi/plugin-sdk@0.8.1

## 0.1.5

### Patch Changes

- 4af54f0: Broaden npm keywords on the packages that had the thinnest discovery surface.

  The flagship packages carry 18–32 keywords; these twelve carried 4–9, which is
  what npm ranks package search on. Each now also carries the tail the
  well-indexed plugins already use (`bug-reporting`, `integration`) plus the
  category terms a reader would actually search for — `error-monitoring` and
  `crash-reporting` on the crash plugins, `chatops` and `alerting` on the chat
  plugins, `issue-tracker` and `issue-sync` on the tracker plugins.

  Metadata only; no runtime change. Keywords reach npm only on publish, so this
  needs a release to take effect.

- Updated dependencies [4af54f0]
  - @mushi-mushi/plugin-sdk@0.8.0

## 0.1.4

### Patch Changes

- Updated dependencies [ae878a1]
  - @mushi-mushi/plugin-sdk@0.7.0

## 0.1.3

### Patch Changes

- Updated dependencies [0c66aa9]
  - @mushi-mushi/plugin-sdk@0.6.0

## 0.1.2

### Patch Changes

- Updated dependencies
  - @mushi-mushi/plugin-sdk@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [84118af]
  - @mushi-mushi/plugin-sdk@0.4.0
