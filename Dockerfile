# Dirt Garage: Nuxt SPA + Nitro server. Build: docker build -t enduro-tracker .
# Migrate: docker run --rm --env-file <your env> enduro-tracker node .output/migrate.mjs
# Run:     docker run -p 3000:3000 --env-file <your env> enduro-tracker
ARG NODE_IMAGE=node:22.21.1-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
# Dependencies first (cached while only the source changes); `nuxt prepare` runs with `pnpm build`.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# .output/ (server + client) and .output/migrate.mjs (drizzle migrator bundled, no drizzle-kit at runtime)
RUN pnpm build && pnpm build:migrate

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/server/db/migrations ./server/db/migrations
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER node
EXPOSE 3000
# Fails when the server or its database is down (GET /api/health → 503).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
