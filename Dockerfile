# Glama introspection image — builds the stdio MCP server from the monorepo
# and starts it with offline env vars so tools/list succeeds without live credentials.
FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY tooling ./tooling
COPY patches ./patches

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mushi-mushi/mcp build

FROM node:22-alpine AS release

WORKDIR /app

COPY --from=builder /app/packages/mcp/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV MUSHI_API_KEY=glama-introspection
ENV MUSHI_PROJECT_ID=00000000-0000-0000-0000-000000000001
ENV MUSHI_API_ENDPOINT=http://127.0.0.1:1/offline

ENTRYPOINT ["node", "/app/dist/index.js"]
