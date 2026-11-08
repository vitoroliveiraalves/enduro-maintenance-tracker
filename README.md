# Enduro Tracker

A phone-first PWA for enduro riders: log rides (hours and km), see which maintenance
items are due, record services and costs, and read garage invoices (QR code first,
an AI model only for the lines). Works offline: screens come from the last sync and
writes wait in an outbox until the phone is back online.

Nuxt 4 SPA (`ssr: false`) with a Nitro server, Postgres + drizzle, better-auth
(email + password, open registration).

## Local development

Requirements: Node 22 LTS, pnpm (via `corepack enable`), Docker.

```sh
pnpm install
docker compose up -d          # Postgres on localhost:5433
cp .env.example .env          # placeholders; fill in what you need
pnpm db:migrate               # apply migrations (drizzle-kit)
pnpm dev                      # http://localhost:3010
```

Create a user from the command line (or sign up at `/register`):

```sh
pnpm user:create rider@example.com some-password
```

Invoice reading needs `NUXT_OPENROUTER_API_KEY`; without it the app shows a calm
notice and riders type the lines. Push reminders need a VAPID key pair
(`pnpm vapid:generate`).

## Tests

```sh
pnpm test        # Vitest unit tests (fresh enduro_test database on 5433)
pnpm check       # typecheck + lint
pnpm e2e         # production build, then Playwright (phone 380×780) on port 3210
SCREENSHOTS=1 pnpm e2e:run tests/e2e/screenshots.spec.ts   # refresh tests/e2e/__screenshots__
```

The e2e run uses its own `enduro_e2e` database and never touches the dev one.

## Deploy

The `Dockerfile` builds a production image (Node 22, `node .output/server/index.mjs`,
`NODE_ENV=production`, `PORT=3000`, `HOST=0.0.0.0`). Every variable is listed with
a comment in `.env.example`.

```sh
docker build -t enduro-tracker .
docker run --rm --env-file /path/to/prod.env enduro-tracker node .output/migrate.mjs   # migrations first
docker run -d -p 3000:3000 --env-file /path/to/prod.env enduro-tracker
```

Without Docker: `pnpm build`, then `pnpm db:migrate:prod` (drizzle's runtime
migrator, no drizzle-kit), then `NODE_ENV=production node .output/server/index.mjs`.

Rules for a production host:

- **Run behind an https reverse proxy that overwrites `X-Real-IP`** with the real
  client address (nginx: `proxy_set_header X-Real-IP $remote_addr;`). The auth rate
  limiter reads that header (`AUTH_IP_HEADER`); if the proxy passes a client-set
  value through, the limit can be dodged. Alternatively list your proxies in
  `AUTH_TRUSTED_PROXIES`.
- **`BETTER_AUTH_URL` must be the public https origin** riders open
  (e.g. `https://enduro.example.com`), or sign-in cookies and origin checks fail.
- **Single node only.** The invoice-reading rate limits live in memory and reset on
  restart; running several instances would multiply them. (Upload quotas are
  counted in Postgres.)
- **Set `NODE_ENV=production`** (the image does).
- **Run migrations before starting** a new version (`node .output/migrate.mjs` in the
  image, or `pnpm db:migrate:prod`).
- **Generate VAPID keys with `pnpm vapid:generate`** and set `NUXT_VAPID_*`;
  `NUXT_VAPID_SUBJECT` must be a real `mailto:` (Apple rejects placeholders).
- Set a long random `BETTER_AUTH_SECRET`; never reuse the example value.
