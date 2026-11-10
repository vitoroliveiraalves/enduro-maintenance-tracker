# Dirt Garage

A phone-first PWA for enduro (and street) riders: log rides, see which maintenance
items are due, record services and costs, and read garage invoices (QR code first,
an AI model only for the lines; saved invoices can be listed, changed, moved to another bike or deleted). Works offline: screens come from the last sync and
writes wait in an outbox until the phone is back online. Each bike counts hours & km,
km only (street bikes) or hours only, and every screen asks for and shows just those.

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

Voice notes use the same `NUXT_OPENROUTER_API_KEY` (model `NUXT_VOICE_MODEL`, default the
invoice model; caps `NUXT_VOICE_DAILY_CAP` 60/user/day, `NUXT_VOICE_GLOBAL_DAILY_CAP` 600/day, 20/user/10 min);
without a key the mic is hidden and Settings says voice isn't set up. Audio and transcripts are never stored.
Invoice reading needs `NUXT_OPENROUTER_API_KEY`; without it the app shows a calm
notice and riders type the lines. Push reminders need a VAPID key pair
(`pnpm vapid:generate`).

Admin: accounts listed in `NUXT_ADMIN_EMAILS` (comma-separated) get Settings → Admin, a list of
riders with last login, usage counts and an AI switch per account (on by default; off = no invoice
line reading, no voice notes). Everyone else gets 404 on `/api/admin/*`.

## Tests

```sh
pnpm test        # Vitest unit tests (fresh enduro_test database on 5433)
pnpm check       # typecheck + lint
pnpm e2e         # production build, then Playwright (phone 380×780) on port 3210
SCREENSHOTS=1 pnpm e2e:run tests/e2e/screenshots.spec.ts   # refresh tests/e2e/__screenshots__
```

The e2e run uses its own `enduro_e2e` database and never touches the dev one.

## Deploy

Production runs on one server with Docker Compose (`compose.prod.yml`), behind
**Nginx Proxy Manager** (NPM), running on another machine on the LAN, for HTTPS. The stack:

- `db`: Postgres 16 on a volume. Not published, no internet.
- `migrate`: applies pending migrations, then exits. The app waits for it.
- `app`: the server, published only on this server's LAN address
  (`APP_BIND:APP_PORT`, default port 3020), never on 0.0.0.0.
- `backup`: a `pg_dump` every 24 h into `BACKUP_DIR`, kept `BACKUP_KEEP_DAYS` days.

First deploy:

```sh
cp .env.example prod.env          # never commit it (git-ignored)
# set DOMAIN, APP_BIND (`hostname -I`, the LAN IP), APP_PORT if 3020 is taken, POSTGRES_PASSWORD (`openssl rand -hex 32`),
# BETTER_AUTH_SECRET (`openssl rand -base64 48`), NUXT_VAPID_* (`pnpm vapid:generate`),
# NUXT_OPENROUTER_API_KEY (invoices and voice notes; optional NUXT_VOICE_MODEL / NUXT_VOICE_*_CAP). DATABASE_URL and BETTER_AUTH_URL are set by the compose file.
docker compose -f compose.prod.yml --env-file prod.env up -d --build
```

Then in NPM add a **Proxy Host**:

- domain `DOMAIN`, scheme `http`, forward to `APP_BIND` port `APP_PORT`
  (e.g. `192.168.1.172` port `3020`);
- SSL tab: request a Let's Encrypt certificate, turn on **Force SSL**
  (HSTS is already sent by the app).

**Update:** `git pull`, then the same `up -d --build` command. It rebuilds, migrates,
then restarts the app. Expect a few seconds of downtime.

**Logs and status:** `docker compose -f compose.prod.yml --env-file prod.env ps`
(and `logs app`).

**Restore a backup:**

```sh
docker compose -f compose.prod.yml --env-file prod.env stop app
docker compose -f compose.prod.yml --env-file prod.env exec backup \
  pg_restore --clean --if-exists -d enduro /backups/enduro-YYYY-MM-DD-HHMM.dump
docker compose -f compose.prod.yml --env-file prod.env start app
```

Without Compose: build the image (`docker build -t enduro-tracker .`), then run
`node .output/migrate.mjs` in it before starting it. Or, without Docker: `pnpm build`,
`pnpm db:migrate:prod`, then `NODE_ENV=production node .output/server/index.mjs`.

Rules for a production host:

- **Run behind an https reverse proxy that overwrites `X-Real-IP`** with the real
  client address. NPM does this on every proxy host
  (`proxy_set_header X-Real-IP $remote_addr;`). The auth rate limiter reads that
  header (`AUTH_IP_HEADER`); if the proxy passes a client-set value through, the
  limit can be dodged. The published port is reachable by anything on the LAN,
  which could set its own `X-Real-IP`; keep the LAN trusted, or firewall
  `APP_PORT` to NPM's IP. If NPM itself sits behind Cloudflare or another proxy,
  `$remote_addr` is that proxy: set NPM's real-IP handling first, or every rider
  shares one rate limit.
- **`BETTER_AUTH_URL` must be the public https origin** riders open
  (e.g. `https://enduro.example.com`), or sign-in cookies and origin checks fail.
- **Single node only.** The invoice-reading rate limits live in memory and reset on
  restart; running several instances would multiply them. (Upload quotas are
  counted in Postgres.)
- **Set `NODE_ENV=production`** (the image does).
- **Run migrations before starting** a new version (the `migrate` service does it;
  otherwise `node .output/migrate.mjs` in the image, or `pnpm db:migrate:prod`).
- **Generate VAPID keys with `pnpm vapid:generate`** and set `NUXT_VAPID_*`;
  `NUXT_VAPID_SUBJECT` must be a real `mailto:` (Apple rejects placeholders).
- Set a long random `BETTER_AUTH_SECRET`; never reuse the example value.
- **The server refuses to start** with a missing, placeholder or short
  `BETTER_AUTH_SECRET`, or without `BETTER_AUTH_URL`; it logs `[config]` warnings
  for plain-http URLs and missing push/AI keys.
- **Health:** `GET /api/health` is 200 when the app and Postgres answer, 503 when
  the database is unreachable. The image has a Docker `HEALTHCHECK` on it; point
  your uptime monitor there too.
- **Back up Postgres daily** and keep copies off the host (the `backup` service writes
  the daily dumps; copying `BACKUP_DIR` elsewhere is up to you). It holds everything,
  including invoice photos (`document_files`), so expect it to grow. For example:
  `pg_dump --format=custom "$DATABASE_URL" > enduro-$(date +%F).dump`, restore with
  `pg_restore --clean --dbname "$DATABASE_URL" <file>`. Test a restore before launch.
- **Security headers** (nosniff, no framing, referrer policy, camera-only
  permissions, HSTS, `no-store` on `/api`) come from `routeRules` in
  `nuxt.config.ts`. Terminate TLS at the proxy; HSTS only takes effect over https.
