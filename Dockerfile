# Enduro Tracker: Nuxt SPA + Nitro server. Build: docker build -t enduro-tracker .
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
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
