# Glama introspection image — installs the published @mushi-mushi/mcp from npm
# and starts the stdio MCP server with offline env vars so Glama's build test
# and tools/list inspection succeed without live credentials. Pulling the
# published package is far more reliable for an external builder than compiling
# the whole monorepo (pnpm install across 43 packages).
FROM node:22-alpine

WORKDIR /app

# @latest tracks released SDK versions without needing a Dockerfile bump.
RUN npm install -g @mushi-mushi/mcp@latest

# Offline placeholders: the server must boot and answer tools/list without
# reaching a live backend (Glama runs it in a sandbox during the build test).
ENV NODE_ENV=production \
    MUSHI_API_KEY=glama-introspection \
    MUSHI_PROJECT_ID=00000000-0000-0000-0000-000000000001 \
    MUSHI_API_ENDPOINT=http://127.0.0.1:1/offline \
    MUSHI_FEATURES=all

ENTRYPOINT ["mushi-mcp"]
