FROM oven/bun:1.3.13 AS base
WORKDIR /app
ENV HUSKY=0
ENV TURBO_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/env/package.json ./packages/env/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/whatsapp/package.json ./packages/whatsapp/package.json
RUN bun install --frozen-lockfile

FROM base AS prod-deps
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/env/package.json ./packages/env/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/whatsapp/package.json ./packages/whatsapp/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM deps AS builder
ARG VITE_SERVER_URL=http://localhost:3000
ENV VITE_SERVER_URL=$VITE_SERVER_URL
COPY . .
RUN bun run build

FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun . .
USER bun
CMD ["bun", "run", "db:migrate"]

FROM base AS server
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=bun:bun /app/apps/server/dist ./apps/server/dist
RUN mkdir -p /app/uploads && chown -R bun:bun /app/uploads
WORKDIR /app/apps/server
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.mjs"]

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=node:node /app/apps/web/server.mjs ./apps/web/server.mjs
WORKDIR /app/apps/web
USER node
EXPOSE 3001
CMD ["node", "server.mjs"]
