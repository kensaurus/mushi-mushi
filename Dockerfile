# NOTE (2026-11-14): Glama does NOT build from this file. Its build spec lives in
# the Glama admin (it installs @mushi-mushi/mcp@latest and runs
# `mcp-proxy -- mushi-mcp`, with MUSHI_FEATURES=vibe in its placeholder
# parameters and env schema). Change the tool set there, not only here. This
# image is a local, offline reproduction of that inspection.
#
# Introspection image — installs the published @mushi-mushi/mcp from npm
# and starts the stdio MCP server with offline env vars so a build test
# and tools/list inspection succeed without live credentials. Pulling the
# published package is far more reliable for an external builder than compiling
# the whole monorepo (pnpm install across 43 packages).
# Base image pinned by digest (OpenSSF Scorecard Pinned-Dependencies). Refresh
# the digest with `docker buildx imagetools inspect node:22-alpine` on upgrade.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app

# @latest tracks released SDK versions without needing a Dockerfile bump.
RUN npm install -g @mushi-mushi/mcp@latest

# Offline placeholders: the server must boot and answer tools/list without
# reaching a live backend (Glama runs it in a sandbox during the build test).
ENV NODE_ENV=production \
    MUSHI_API_KEY=glama-introspection \
    MUSHI_PROJECT_ID=00000000-0000-0000-0000-000000000001 \
    MUSHI_API_ENDPOINT=http://127.0.0.1:1/offline \
    MUSHI_FEATURES=vibe
# vibe = the 12-tool preset new installs get (ADR 0063; PRESET_TOOLS in
# packages/mcp/src/feature-groups.ts); glama.json lists the same set. Glama
# scores tool count, and the full list (features=all) scored 1/5.

ENTRYPOINT ["mushi-mcp"]
