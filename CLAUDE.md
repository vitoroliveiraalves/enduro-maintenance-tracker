# Enduro Tracker

Nuxt 4 SPA (`ssr: false`) PWA for enduro bike maintenance and costs. Postgres + drizzle + better-auth on the Nitro server.

## Ports
- Web dev: **3010** (`pnpm dev`); E2E production build: **3210**
- Postgres: **5433** (`docker compose up -d`, container `enduro-postgres`, db/user/password `enduro`)
- 3000, 3001, 3002 and 5432 belong to other local projects.

## Validation loop (non-negotiable, every task)
1. `pnpm test` (Vitest) green
2. `pnpm check` (typecheck + lint) green
3. Playwright e2e under `tests/e2e/` for any UI, phone project 380x780: `pnpm e2e`
4. Browser-validate the screen at 380x780; screenshots are opt-in: add a test to `tests/e2e/screenshots.spec.ts` (skipped unless `SCREENSHOTS=1`), run `SCREENSHOTS=1 pnpm e2e:run tests/e2e/screenshots.spec.ts`, look at the PNG in `tests/e2e/__screenshots__/` and commit it. No other spec writes screenshots.

Loop fix and rerun until all pass; if one is N/A, say why in the commit body.

## Code rules
- **API calls from UI code go through `useApi()`** (`app/composables/useApi.ts`): `get(url)` (network first, cached screens fall back to the last synced copy after 4 s) and `mutate(url, body, opts)`. Never `$fetch` from pages/components. Writes are online-only by default; queueing in the offline outbox is opt-in with `{ queue: true }`, and only for readings, services, expenses, reminders, bike/item create/patch, shelf parts (create, patch, movements) and shopping entries (create, patch).
- **Server input validation uses `server/utils/validate.ts`** (`day`, `timestamp`, `uuid`, `int` and their `is*` forms). Bad input is a 400 (bad id in the path: 404), never a 500; `tests/e2e/bad-input.spec.ts` covers every route — add new routes to it.
- **Env**: every variable is listed with a comment in `.env.example` (placeholders only). Never read or create a real `.env`. Deploy notes in `README.md`.

## Global constraints
- UI language English. Money = integer cents EUR, shown `1.234,56 €` via `useFormatters().money()`; hours = integer tenths, shown `142.5 h`; km integer, shown with thin-space thousands (`3 812 km`).
- Numeric inputs accept `142.5` and `142,5` (`parseDecimal`).
- Dark UI; tokens in `app/assets/css/main.css`: accent `#ff6a00`, red `#ff4d4f`, amber `#ffb020`, green `#3ecf8e`, background `#121417`, surface `#1c2026`.
- Open registration (email + password at `/register`, better-auth IP rate limit on) with a short privacy note; categories seeded on sign-up via `databaseHooks.user.create.after`. `pnpm user:create <email> <password>` for tests/seeding.
- Invoice reads capped at 30/user/day (`NUXT_INVOICE_DAILY_CAP`) -> 429 "Daily invoice reading limit reached — you can still add the lines yourself."
- Invoice uploads: 30/user/24 h and at most 20 unconfirmed per user -> 429 (`server/utils/documents.ts`).
- Every API row is scoped by `userId` through `server/utils/owned.ts`; never query bikes/items/expenses without it.
- Invoice reading: QR first (Portaria 195/2020), AI only for lines; photos downscaled to 2400 px longest side, JPEG 0.85; <= 5 photos or one PDF <= 10 MB; never save without rider confirmation; image always kept; rate limit 60 reads/user/10 min. Env: `NUXT_OPENROUTER_API_KEY`, `NUXT_OPENROUTER_MODEL` (default `google/gemini-3.1-flash-lite`). No key -> calm notice, manual entry.
- Port code from `~/encomentio` by copying and adapting; never import from it. Ignore `~/moto-tracker`.
- Every create POST carries a `clientId` (uuid); server upserts on `(userId, clientId)`.
- Commit after each task; messages end with the session attribution lines.
