# Enduro Tracker v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, phone-first PWA that tracks hours/km per enduro bike, tells what maintenance is due (hours / km / months, whichever first), reads garage invoices from photos, and shows running costs by month/year.

**Architecture:** One Nuxt 4 app in SPA mode (`ssr: false`, so the app shell is precached and opens offline) with Nitro server routes as the API, Postgres via drizzle, better-auth sessions. Pure domain logic lives in `app/lib/` and `server/domain/` and is unit-tested; each server slice lives in `server/api/<slice>/`. Offline = Dexie cache of last-synced data + an outbox of writes with idempotency keys.

**Tech Stack:** Nuxt 4, TypeScript, Tailwind 4, Pinia, @vueuse, @vite-pwa/nuxt, Dexie, drizzle-orm + Postgres 16, better-auth, Vitest, Playwright, web-push, zxing-wasm / barcode-detector (QR), pdfjs-dist, OpenRouter (`google/gemini-3.1-flash-lite`).

**Spec:** `docs/superpowers/specs/2026-11-08-enduro-tracker-design.md` (executors read both). Mockups: `.superpowers/brainstorm/58358-1794143707/content/bike-home.html` (layout **A**) and `costs-overview.html`.

## Global Constraints

- Ports: web **3010**, Postgres **5433** (3000, 3001, 3002 and 5432 are used by other local projects). E2E runs on **3210**.
- UI language **English**; money stored as **integer cents EUR**, displayed `1.234,56 €` via `useFormatters().money()`; hours stored as **tenths of an hour (integer)**, displayed one decimal (`142.5 h`); km integer, displayed with thin-space thousands (`3 812`).
- Numeric inputs accept both `142.5` and `142,5`.
- Dark UI, orange accent `#ff6a00`, red `#ff4d4f`, amber `#ffb020`, green `#3ecf8e`, background `#121417`, surface `#1c2026` — tokens in `app/assets/css/main.css`.
- **Open registration**: email + password sign-up at `/register` (better-auth, its built-in IP rate limit on), short privacy note on that page ("Your bikes, costs and invoice photos are stored on our server. Invoice photos are sent to an AI service (via OpenRouter) to read them."). Categories seeded on sign-up via a better-auth `databaseHooks.user.create.after` hook. `pnpm user:create <email> <password>` stays for tests/seeding. Settings has "Delete my account and data" (Task 11).
- Invoice reads also capped at **30 / user / day** (`NUXT_INVOICE_DAILY_CAP`, default 30) → 429 with "Daily invoice reading limit reached — you can still add the lines yourself."
- Every row the API returns is scoped by `userId` through `server/utils/owned.ts` — never query bikes/items/expenses without it.
- Invoice reading: QR first (Portaria 195/2020), AI only for lines; photos downscaled to **2400 px longest side, JPEG 0.85**; ≤ **5 photos** or one PDF ≤ **10 MB**; never save without the rider confirming; image always kept; rate limit **60 reads / user / 10 min**. Env: `NUXT_OPENROUTER_API_KEY`, `NUXT_OPENROUTER_MODEL` (default `google/gemini-3.1-flash-lite`). Reading disabled when no key → calm notice, manual entry.
- Ignore `~/moto-tracker`. Port code from `~/encomentio` by copying and adapting; never import from it. Never read `.env` or `deploy/` files there.
- **Validation loop for every task (non-negotiable):** (1) `pnpm test` (Vitest) green, (2) `pnpm check` (typecheck + lint) green, (3) a Playwright e2e under `tests/e2e/` for any UI, phone project 380×780, green, (4) browser-validate the screen at 380×780 with a screenshot saved to `tests/e2e/__screenshots__/<task>.png`. Loop fix → rerun until all four pass; if one is genuinely N/A, say why in the commit body.
- Commit after each task on branch `main` of the new repo (Task 1 runs `git init`). Commit messages end with the attribution lines from the session.

## Review Focus

1. **Decimal comma / typos in meter input** ("142,5", "1425" when 142.5 meant): comma parses; a reading lower than the previous one is rejected; a jump of > 50 h or > 1 500 km since the last reading asks "Are you sure?" before saving. → tests in Task 5.
2. **Backdated service** (logging an oil change done "last Sunday at 138.0 h" after newer readings exist): the item's status uses the service with the highest hours (then date), not the most recently created row. → test in Task 3 + Task 7.
3. **Duplicate writes from the offline outbox** (retry after a timeout, two taps): every POST carries `clientId` (uuid); the server upserts on `(userId, clientId)` so a replay creates nothing new. → tests in Task 5 and Task 12.
4. **Invoice reading fails** (no key, model timeout, blurry photo, no QR, non-JSON reply): the document and images are saved, status `manual`, review screen opens with empty lines and the notice; nothing crashes, nothing is invented. → tests in Task 9.
5. **Item with a months-limit but no known last-done date, or a bike with no readings yet**: status `unknown` (grey, "Set last done"), never overdue, sorts after red/amber. → test in Task 3.

## File structure (decomposition)

```
app/
  assets/css/main.css          tokens + Tailwind
  lib/                         pure, unit-tested, client-side
    format.ts  parse-number.ts  qr-invoice.ts  image-downscale.ts  costs.ts
  composables/ useFormatters.ts useApi.ts useOffline.ts usePush.ts
  stores/ bikes.ts
  offline/ db.ts (Dexie)  outbox.ts  sync.ts
  components/ (BottomTabs, MeterCard, ItemRow, ProgressBar, Sheet, …)
  pages/ login.vue  index.vue (garage)  bikes/new.vue  bikes/[id]/index.vue
         bikes/[id]/items/[itemId].vue  history.vue  invoice/index.vue
         invoice/[docId].vue  costs.vue  settings.vue
server/
  db/ schema.ts  client.ts  migrations/
  domain/ maintenance-status.ts  templates.ts  invoice-match.ts  costs-query.ts
  utils/ auth.ts  require-user.ts  owned.ts  rate-limit.ts  invoice-extract.ts  push.ts
  api/ bikes/ readings/ items/ services/ expenses/ categories/ documents/ reminders/ push/ costs/ sync/
  tasks/ notify.ts             scheduled due-check (Nitro task, hourly)
scripts/ user-create.ts  pwa-icons.mjs
tests/ unit/ (mirrors source)  e2e/
```

## Dependency graph (for parallel dispatch)

T1 → T2 → {T3, T8} in parallel → T4 → {T5, T7} → T6 → {T9 (needs T7, T8), T10 (needs T7), T11} → T12.

---

### Task 1: Scaffold the app with the validation loop wired

**Files:** Create `package.json`, `nuxt.config.ts`, `docker-compose.yml`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `.gitignore` (include `.superpowers/`, `.env`), `.env.example`, `app/app.vue`, `app/assets/css/main.css`, `app/lib/format.ts`, `app/lib/parse-number.ts`, `server/api/health.get.ts`, `tests/unit/lib/format.test.ts`, `tests/unit/lib/parse-number.test.ts`, `tests/e2e/smoke.spec.ts`, `CLAUDE.md`.

**Interfaces — Produces:**
- `formatMoney(cents: number): string` → `formatMoney(123456) === '1.234,56 €'`, `formatMoney(-990) === '-9,90 €'`
- `formatHours(tenths: number): string` → `formatHours(1425) === '142.5 h'`
- `formatKm(km: number): string` → `formatKm(3812) === '3 812 km'` (U+202F thin space)
- `parseDecimal(input: string): number | null` → `'142,5'→142.5`, `'142.5'→142.5`, `' 3 812 '→3812`, `'abc'→null`, `''→null`
- `useFormatters()` returning `{ money, hours, km, date }` (date: `'6 Oct 2026'`)
- Scripts: `dev`, `build`, `test`, `check`, `e2e`, `db:generate`, `db:migrate`, `user:create`.

- [ ] Step 1: `git init`; create Nuxt 4 app with `ssr: false`, Tailwind 4, Pinia, vueuse, `@vite-pwa/nuxt` (manifest name "Enduro Tracker", `theme_color #121417`, `display standalone`, `start_url /`, `navigateFallback: '/index.html'` since SPA). Dev port 3010. docker-compose: `postgres:16-alpine` on 5433, db `enduro`.
- [ ] Step 2: Write `format.test.ts` and `parse-number.test.ts` with the exact cases above; run `pnpm test` → FAIL.
- [ ] Step 3: Implement `format.ts`, `parse-number.ts`, `useFormatters.ts`; run `pnpm test` → PASS.
- [ ] Step 4: `server/api/health.get.ts` returns `{ ok: true }`; Playwright config with `phone` project (380×780, webServer on 3210 running built output); `smoke.spec.ts` loads `/` and expects HTTP 200 and the text "Enduro Tracker". Run `pnpm e2e` → PASS.
- [ ] Step 5: `pnpm check` green. Write `CLAUDE.md` with ports, the validation loop and the Global Constraints. Commit `chore: scaffold enduro tracker`.

### Task 2: Database schema, auth, ownership guard

**Files:** Create `server/db/schema.ts`, `server/db/client.ts`, `server/utils/auth.ts`, `server/utils/require-user.ts`, `server/utils/owned.ts`, `server/api/auth/[...all].ts`, `scripts/user-create.ts`, `app/pages/login.vue`, `app/middleware/auth.global.ts`, `app/lib/auth-client.ts`; tests `tests/unit/server/owned.test.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/helpers/login.ts`.

**Interfaces — Produces (tables; all have `id uuid pk`, `createdAt`, `updatedAt`, and every user-data table has `userId` + nullable unique `(userId, clientId)`):**
- better-auth tables (`user`, `session`, `account`, `verification`); email+password enabled, **sign-up enabled**, min password length 8, `rateLimit.enabled: true`; user-create hook seeds categories.
- `bikes(userId, name, make, model, year int, stroke '2T'|'4T', photoDocumentId?, archivedAt?)`
- `meterReadings(bikeId, at timestamptz, hoursTenths int, km int, condition 'normal'|'mud'|'sand'|'dust'|'race')`
- `maintenanceItems(bikeId, name, everyHoursTenths?, everyKm?, everyMonths?, conditionMultipliers jsonb {mud?,sand?,dust?,race?: number}, sortOrder, archivedAt?)`
- `services(bikeId, at date, hoursTenths?, km?, by 'diy'|'garage', garageName?, notes?, documentId?)` and `serviceItems(serviceId, itemId)` (m:n)
- `categories(userId, name, kind 'maintenance'|'parts'|'tyres'|'fuel'|'race'|'insurance'|'upgrades'|'gear'|'labour'|'other')` seeded per user on creation.
- `expenses(userId, bikeId?, at date, amountCents int, categoryId, description, documentId?, documentLine int?, serviceId?)` and `expenseItems(expenseId, itemId)` (m:n — line ↔ items)
- `documents(userId, status 'reading'|'review'|'manual'|'confirmed', supplierName?, supplierNif?, number?, issuedAt?, totalCents?, qrRaw?, extracted jsonb?, error?)` and `documentFiles(documentId, page int, mime, bytes bytea, sha256 unique per user)`
- `reminders(userId, bikeId?, title, dueOn date, repeatYearly bool, doneAt?)`
- `pushSubscriptions(userId, endpoint unique, p256dh, auth)` and `notificationsSent(userId, key unique)` (dedupe)
- `requireUser(event): Promise<{ id: string; email: string }>` (401 otherwise)
- `ownedBike(event, bikeId): Promise<Bike>` (404 if not the user's), same pattern `ownedItem`, `ownedDocument`, `ownedExpense`.
- E2E helper `loginAs(page)` using a user created in global setup.

- [ ] Step 1: Test `owned.test.ts`: user A's bike requested by user B → throws 404; requested by A → returns it. Run → FAIL.
- [ ] Step 2: Schema + migration (`pnpm db:generate && pnpm db:migrate`), auth, guards. Run → PASS.
- [ ] Step 3: `app/pages/register.vue` (email, password, confirm, privacy note; link from login) + `user:create` script. E2E `auth.spec.ts`: unauthenticated `/` redirects to `/login`; register a new email → lands on `/` (empty garage) and has the default categories; registering the same email again shows "An account with this email already exists"; password < 8 chars rejected; wrong password shows "Wrong email or password"; user A cannot GET user B's bike (404). Run → PASS.
- [ ] Step 4: Validation loop (screenshot `login.png`). Commit `feat: schema, auth and ownership guard`.

### Task 3: Maintenance status engine and starter templates (pure)

**Files:** Create `server/domain/maintenance-status.ts`, `server/domain/templates.ts`; test `tests/unit/server/maintenance-status.test.ts`, `tests/unit/server/templates.test.ts`.

**Interfaces — Produces:**
```ts
type Condition = 'normal'|'mud'|'sand'|'dust'|'race'
type Reading = { at: Date; hoursTenths: number; km: number; condition: Condition }
type ItemDef = { everyHoursTenths?: number; everyKm?: number; everyMonths?: number; conditionMultipliers: Partial<Record<Condition, number>> }
type LastDone = { at: Date; hoursTenths?: number; km?: number } | null
type Status = {
  state: 'overdue'|'soon'|'ok'|'unknown'
  ratio: number | null                     // max used/limit over the limits, 0..∞
  driver: 'hours'|'km'|'months'|null       // limit with the highest ratio
  sinceHoursTenths: number | null          // plain hours since last done
  effectiveHoursTenths: number | null      // with multipliers
  sinceKm: number | null; sinceMonths: number | null
  remaining: { hoursTenths?: number; km?: number; days?: number }
}
computeStatus(def: ItemDef, last: LastDone, readings: Reading[], now: Date): Status
pickLastDone(services: { at: Date; hoursTenths?: number; km?: number }[]): LastDone  // highest hours, then km, then date
sortByUrgency<T extends { status: Status }>(rows: T[]): T[]  // overdue, soon, ok by ratio desc; unknown last
TEMPLATES: Record<'2T'|'4T', Array<{ name: string } & ItemDef>>
```
Rules: `soon` when ratio ≥ **0.8**; `overdue` when ≥ **1**. Effective hours = Σ over readings after `last` of (Δhours since the previous reading × multiplier of that reading's condition; default 1). Multipliers never apply to km. A limit whose baseline is missing (no `last`, or no readings) contributes nothing; if no limit can be computed → `unknown`.

Template defaults (builder may refine, keep these names): 2T — Gearbox oil 15 h; Air filter clean 5 h (mud/sand/dust ×1.5, race ×1.5); Spark plug 30 h; Piston & rings 80 h; Chain & sprockets 1 500 km; Wheel bearings 50 h; Fork service 50 h or 12 months; Shock service 50 h or 12 months; Brake fluid 12 months; Coolant 24 months. 4T — Engine oil + filter 15 h (mud/sand/dust/race ×1.5); Air filter clean 5 h (×1.5 as 2T); Valve clearance check 30 h; Spark plug 30 h; Chain & sprockets 1 500 km; Wheel bearings 50 h; Fork/Shock service 50 h or 12 months; Brake fluid 12 months; Coolant 24 months.

- [ ] Step 1: Tests (each its own `it`):
  - oil every 200 tenths, last at 1220, latest reading 1425, all normal → `overdue`, `sinceHoursTenths 205`, `driver 'hours'`.
  - air filter every 50, last at 1385, readings 1385→1425 with condition `mud` ×1.5 → `effectiveHoursTenths 60`, `overdue`; same with `normal` → `40`, `soon`.
  - fork 500 tenths **or** 12 months, done 13 months ago at 1400, now 1425 → `overdue`, `driver 'months'`.
  - chain 1 500 km, 1 280 km since → `soon`, `remaining.km 220`, and multipliers on km ignored under `mud`.
  - no `last` → `unknown`; bike with zero readings and hours-only item → `unknown` (Review Focus 5).
  - `pickLastDone` with a backdated service at 1380 created after one at 1220 → returns 1380 (Review Focus 2).
  - `sortByUrgency`: [ok 0.2, unknown, overdue 1.02, soon 0.85] → [overdue, soon, ok, unknown].
  - templates: every item has at least one limit; names unique per stroke.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: Run → PASS; `pnpm check`. (E2E/browser N/A: pure logic — state in commit.) Commit `feat: maintenance status engine and templates`.

### Task 4: Garage + add bike with onboarding

**Files:** `server/api/bikes/index.get.ts`, `index.post.ts`, `[id].get.ts`, `[id].patch.ts`, `server/api/items/[bikeId].get.ts`, `server/api/items/index.post.ts`, `[id].patch.ts`; `app/pages/index.vue`, `app/pages/bikes/new.vue`, `app/stores/bikes.ts`, `app/components/BottomTabs.vue`; tests `tests/unit/server/bikes-api.test.ts`, `tests/e2e/bikes.spec.ts`.

**Interfaces:**
- Consumes: `TEMPLATES`, `computeStatus`, `pickLastDone`, `sortByUrgency`, `ownedBike`.
- Produces: `POST /api/bikes` body `{ clientId, name, make, model, year, stroke, hoursTenths, km, items: Array<{ name, everyHoursTenths?, everyKm?, everyMonths?, conditionMultipliers, lastDone?: { at, hoursTenths?, km? } }> }` → creates bike, an initial reading, items, and a `services` row (by `'diy'`, notes "Initial") for each item with `lastDone`. `GET /api/bikes/:id` → `{ bike, latestReading, items: Array<ItemRow> }` where `ItemRow = { id, name, def: ItemDef, last: LastDone & { by, garageName? } | null, status: Status }` sorted by `sortByUrgency`. `GET /api/bikes` → list with `{ id, name, year, latestReading, counts: { overdue, soon } }`.

- [ ] Step 1: Unit test: POST with stroke `2T`, 1425 tenths, and lastDone only for "Gearbox oil" at 1220 → GET returns Gearbox oil `overdue` first and items without lastDone `unknown` last; POST twice with the same `clientId` → one bike (Review Focus 3). Run → FAIL → implement → PASS.
- [ ] Step 2: UI: Garage (`/`) lists bikes with red/amber counts and "+ Add bike". `/bikes/new`: step 1 details + current hours/km; step 2 the seeded item list (editable intervals, remove, add custom) each with an optional collapsible "Last done at" (date, hours, km). Save → bike screen.
- [ ] Step 3: E2E `bikes.spec.ts`: add "KTM 300 EXC" 2T at `142,5` h / `3812` km with Gearbox oil last done at 122 h → bike page shows "Gearbox oil" with "overdue 0.5h" text pattern `/overdue/` and an "Unknown — set last done" row. Validation loop (screenshots `garage.png`, `bike-new.png`). Commit `feat: garage and add-bike onboarding`.

### Task 5: Meter readings — "Log ride / update meters"

**Files:** `server/api/readings/index.post.ts`, `server/api/readings/[bikeId].get.ts`, `server/domain/reading-validation.ts`; `app/components/LogRideSheet.vue`; tests `tests/unit/server/reading-validation.test.ts`, `tests/e2e/readings.spec.ts`.

**Interfaces — Produces:** `validateReading(prev: Reading | null, next: { hoursTenths: number; km: number }): { ok: true; warn?: 'big-jump' } | { ok: false; error: 'hours-decreased'|'km-decreased' }` — big jump = > 500 tenths or > 1 500 km. `POST /api/readings { clientId, bikeId, at?, hoursTenths, km, condition, confirmBigJump?: boolean }` → 422 `{ error }` on decrease, 409 `{ warn: 'big-jump' }` unless `confirmBigJump`.

- [ ] Step 1: Unit tests for decrease (hours and km separately), equal values ok, big jump warn, null prev ok. Run → FAIL → implement → PASS.
- [ ] Step 2: Sheet: two big numeric inputs prefilled with current values (accept comma), condition chips (Normal default, Mud, Sand, Dust, Race), Save. Big jump → inline "That's 1 282.5 h more than last time. Save anyway?".
- [ ] Step 3: E2E: enter `144,0` with Mud → hours card shows `144.0 h` and the air-filter row moves up; enter `1440` → confirm prompt appears; enter `140` → "Hours can't go down (last: 144.0 h)". Replaying the same POST body (same `clientId`) creates one reading. Validation loop (`log-ride.png`). Commit `feat: meter readings`.

### Task 6: Bike screen (layout A) and item history

**Files:** `app/pages/bikes/[id]/index.vue`, `app/pages/bikes/[id]/items/[itemId].vue`, `app/components/{MeterCard,ItemRow,ProgressBar}.vue`, `server/api/items/[id]/history.get.ts`; tests `tests/e2e/bike-screen.spec.ts`.

**Interfaces:** Consumes `GET /api/bikes/:id`. Produces `GET /api/items/:id/history` → `{ item, status, services: Array<{ id, at, hoursTenths?, km?, by, garageName?, costCents: number, documentId? }> }` newest-by-hours first; `costCents` = sum of expenses linked to that service.

- [ ] Step 1: Build the screen exactly as mockup A: header (bike name, "‹ Garage", settings cog), Hours/Km cards, orange "+ Log ride / update meters", "Maintenance · due soonest first" list. Row text: right side `overdue 0.5h` / `1h left` / `220 km left` / `3 months left` (driver's unit) or grey `Set last done`; subline `20.5h since change (every 20h) · 12 Sep` plus `· garage` when by garage. Bar colour by state; width `min(ratio,1)`.
- [ ] Step 2: Item page: status header, interval editor, "Mark done" button (opens Task 7 sheet — until then hidden), service list with cost and 🧾 link to `/invoice/:docId`.
- [ ] Step 3: E2E: seeded bike → order of rows matches `sortByUrgency`; tapping "Wheel bearings" opens its history. Validation loop: screenshot `bike-screen.png` compared by eye to mockup A. Commit `feat: bike screen and item history`.

### Task 7: Service log, expenses and categories

**Files:** `server/api/services/index.post.ts`, `[id].delete.ts`; `server/api/expenses/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`; `server/api/categories/*`; `app/components/MarkDoneSheet.vue`, `app/components/ExpenseSheet.vue`, `app/pages/history.vue`; tests `tests/unit/server/services-api.test.ts`, `tests/e2e/services.spec.ts`.

**Interfaces — Produces:** `POST /api/services { clientId, bikeId, at, hoursTenths?, km?, by, garageName?, notes?, itemIds: string[], expenses?: Array<{ amountCents, categoryId, description }>, documentId? }` (one service can reset several items; expenses created linked to the service and to all `itemIds` via `expenseItems`). `POST /api/expenses { clientId, bikeId?, at, amountCents, categoryId, description, itemIds?: string[] }` for non-service costs. `GET /api/expenses?bikeId&from&to` → list with category name and `documentId`. History page = merged timeline of services and expenses, newest first.

- [ ] Step 1: Unit tests: service with itemIds [oil, oilFilter] resets both statuses; backdated service at 1380 after one at 1420 does **not** change status (still counts from 1420) (Review Focus 2); deleting a service restores the previous last-done. Run → FAIL → implement → PASS.
- [ ] Step 2: MarkDone sheet: date (today), hours/km (prefilled current, editable), DIY/Garage toggle (+ garage name), other items to include (checkboxes), optional cost + category. Expense sheet: amount (comma ok), category, bike (optional), description, date. "+ Expense" on the History tab.
- [ ] Step 3: E2E: mark "Gearbox oil" done with 24,90 € → row turns green, history shows "24,90 €"; add a fuel expense 41,60 € with no item. Validation loop (`mark-done.png`, `history.png`). Commit `feat: service log and expenses`.

### Task 8: Invoice capture — upload, storage, QR in the browser

**Files:** `app/lib/qr-invoice.ts` (port `~/encomentio/apps/web/app/lib/fatura-qr.ts`), `app/lib/image-downscale.ts`, `app/composables/useQrScan.ts` (barcode-detector + zxing-wasm served from own origin; pdf.js page 1 for PDFs), `server/api/documents/index.post.ts`, `[id].get.ts`, `[id]/files/[page].get.ts`, `server/utils/upload-guard.ts`; `app/pages/invoice/index.vue`; tests `tests/unit/lib/qr-invoice.test.ts`, `tests/unit/server/upload-guard.test.ts`, `tests/e2e/invoice-upload.spec.ts` (+ fixture images generated with `qrcode` dev dep).

**Interfaces — Produces:**
- `parseInvoiceQr(raw: string): { supplierNif, buyerNif, type, issuedAt, number, atcud, totalCents, taxCents, bases: Array<{ rateLabel, baseCents, vatCents }> } | null` — rejects non-invoice types (RC, PF, OR… → `null` with `reason`), garbled values → `null`.
- `downscaleImage(file: File, maxSide = 2400, quality = 0.85): Promise<Blob>`
- `POST /api/documents` multipart: `files[]` (≤5 images or 1 PDF ≤10 MB; magic-byte check; Content-Length required; 12 MB cap), `qrRaw?` → `{ id, duplicate: boolean }`; same sha256 → existing doc `duplicate: true`. Status starts `reading` (or `manual` when reading disabled). Files served with `X-Content-Type-Options: nosniff`.

- [ ] Step 1: Port the QR tests from encomentio (adapt names) + upload-guard tests (wrong magic bytes → 400, 6 images → 400, PDF 11 MB → 413). Run → FAIL → implement → PASS.
- [ ] Step 2: Invoice tab: **Take photos** (camera, add pages up to 5, thumbnails, remove) and **Choose file**; disabled offline with a banner. QR decoded client-side before upload.
- [ ] Step 3: E2E: upload a fixture JPEG with a PT QR → document created, header shows supplier NIF and total from QR; uploading the same file again opens the same document with "This invoice was already uploaded". Validation loop (`invoice-capture.png`). Commit `feat: invoice capture and QR`.

### Task 9: Invoice reading (AI) and review → expenses + services

**Files:** `server/utils/invoice-extract.ts` (port `fatura-extract.ts`: request shape, JSON schema, euros→cents, row-tolerant parsing, header validation), `server/domain/invoice-match.ts`, `server/utils/rate-limit.ts`, `server/api/documents/[id]/read.post.ts`, `[id]/confirm.post.ts`, `[id]/discard.delete.ts`; `app/pages/invoice/[docId].vue`; tests `tests/unit/server/invoice-extract.test.ts` (fetch mocked), `tests/unit/server/invoice-match.test.ts`, `tests/e2e/invoice-review.spec.ts` (server uses a mock reader when `NUXT_INVOICE_READER=mock`).

**Interfaces:**
- Consumes: documents (T8), `POST /api/services` semantics (T7), items (T4).
- Produces: `extractInvoice(docs: Array<{ mime: string; bytes: Buffer }>, cfg: { apiKey: string; model: string }, fetchImpl?: typeof fetch): Promise<{ ok: true; data: { supplierName?, supplierNif?, number?, issuedAt?, totalCents?, lines: Array<{ description: string; qty?: number; unitCents?: number | null; totalCents: number | null; kind: 'part'|'labour'|'fluid'|'tyre'|'other' }> } } | { ok: false; error: string }>`.
- `matchLineToItems(description: string, items: Array<{ id: string; name: string }>): string[]` — keyword table PT/EN (e.g. `óleo|oil`→ oil items, `filtro de ar|air filter`, `rolamento|bearing`→ wheel bearings, `corrente|cremalheira|pinhão|chain|sprocket`, `pneu|tyre|tire`→ none (category tyres), `mão de obra|labour`→ none, `kit suspensão|retentores|fork|amortecedor|shock`, `vela|spark plug`, `pastilhas|pads`, `líquido de travões|brake fluid`, `pistão|piston`).
- `defaultCategory(kind, description): CategoryKind`.
- `POST /api/documents/:id/confirm { bikeId, at, hoursTenths?, km?, garageName, lines: Array<{ description, amountCents, categoryId, itemIds: string[] }>, forceTotals?: boolean }` → in one transaction: one expense per line (`documentId`, `documentLine`), and if any line has items: one `services` row (by `'garage'`, `documentId`) linked to the union of items; `409 { error: 'totals-mismatch', diffCents }` when lines sum ≠ QR/doc total beyond max(50 cents, 1 %) unless `forceTotals`. Status → `confirmed`.

- [ ] Step 1: Unit tests: extract with mocked fetch returning valid JSON → lines in cents; model returns prose / 500 / timeout → `{ ok:false }` (Review Focus 4); one row without description dropped, others kept; match "Rolamentos roda traseira" → [Wheel bearings]; "Óleo Motul 300V + filtro" → [Engine oil + filter] for 4T / [Gearbox oil] for 2T; "Mão de obra" → []. 31st read in a day → 429 with the daily-limit copy. Confirm: mixed invoice (tyre 129,00 + labour 30,00 + bearings 56,40) → 3 expenses with categories tyres/labour/maintenance, one service resetting Wheel bearings; totals mismatch → 409 unless forced. Run → FAIL → implement → PASS.
- [ ] Step 2: After upload, server reads (status `reading`, client polls; stuck > 120 s → `manual`). Review page: image viewer (pinch/zoom, pages), header (garage name/NIF/date/number, QR fields read-only with a QR badge), bike picker + hours/km at the time (default: reading nearest to the invoice date), editable lines (description, amount, category, linked items as chips with suggested ones pre-selected), "+ Add line", totals check line ("Lines match the invoice total ✓" / "Lines are 12,30 € short of the total"), Confirm / Discard. Failure or no key → notice "Couldn't read this invoice automatically. The photos are saved — add the lines yourself." (Review Focus 4).
- [ ] Step 3: E2E with mock reader: upload → review shows 3 lines with suggested items → confirm → bike screen shows Wheel bearings green with `· garage`, item history shows 🧾 linking to the image; mock reader failure → manual notice, add one line by hand, confirm works. Validation loop (`invoice-review.png`). Commit `feat: invoice reading and review`.

### Task 10: Costs screen

**Files:** `server/domain/costs-query.ts`, `server/api/costs/index.get.ts`, `app/pages/costs.vue`, `app/components/{BarChart,CategoryBars}.vue`; tests `tests/unit/server/costs-query.test.ts`, `tests/e2e/costs.spec.ts`.

**Interfaces — Produces:** `GET /api/costs?period=month|year|all&date=YYYY-MM-DD&bikeId?` → `{ totalCents, compare: { previousToDateCents, pct } | null, perHourCents: number | null, perKmCents: number | null, hoursTenths, km, byMonth: Array<{ month: 1..12; cents }> (year only), byCategory: Array<{ categoryId, name, cents }> desc, byBike: Array<{ bikeId, name, cents, hoursTenths, km }>, expenses: Array<…> (month only), upcoming: Array<{ itemId, name, state, estimateCents | null }> (one bike only) }`. Hours/km in a period = readings delta within the period (last reading ≤ end minus last reading ≤ start). `upcoming` = items with state overdue/soon, estimate = sum of expenses linked to that item's last service, null when none.

- [ ] Step 1: Unit tests: year-to-date vs same day last year (`pct` 18 when 2 486 vs 2 107); per-hour null when 0 hours; month view lists only that month's expenses; upcoming estimate from last service lines. Run → FAIL → implement → PASS.
- [ ] Step 2: Screen as `costs-overview.html`: bike picker ("All bikes ▾"), Month/Year/All time segmented control, period arrows, big total with comparison, small €/h · €/km · hours row (not headline), month bars (Year), category bars, by-bike list, expenses list + "Coming up · estimated" with "Estimates use the last price you paid." (Month + one bike). Export CSV button (`GET /api/costs/export.csv?…`).
- [ ] Step 3: E2E: seed expenses across two bikes and months → Year shows correct total `formatMoney`, switching to Month + one bike lists its expenses; CSV downloads with header row. Validation loop (`costs-year.png`, `costs-month.png`). Commit `feat: costs screen`.

### Task 11: Date reminders and push notifications

**Files:** `server/api/reminders/*`, `server/api/push/subscribe.post.ts`, `unsubscribe.post.ts`, `vapid-key.get.ts`, `server/utils/push.ts` (web-push), `server/tasks/notify.ts` (Nitro scheduled task, hourly: `experimental.tasks` + `scheduledTasks: { '0 * * * *': ['notify'] }`), `server/domain/notify-rules.ts`, `app/composables/usePush.ts`, `app/pages/settings.vue`, `app/components/InstallPrompt.vue`, service-worker push handler via `@vite-pwa/nuxt` `strategies: 'injectManifest'` (`app/sw.ts`); tests `tests/unit/server/notify-rules.test.ts`, `tests/e2e/reminders.spec.ts`.

**Interfaces — Produces:** `notificationsDue(input: { now: Date; items: Array<{ bikeName, itemId, itemName, status: Status }>; reminders: Array<{ id, title, dueOn: Date }>; lastReadingAt: Date | null }): Array<{ key: string; title: string; body: string; url: string }>` — keys dedupe via `notificationsSent`: `item:<id>:soon`, `item:<id>:overdue:<lastServiceId>`, `reminder:<id>:7d`, `reminder:<id>:0d`, `nudge:<isoWeek>` (Monday 09:00 local if a reading is older than the previous Friday). `reminders` with `repeatYearly` roll `dueOn` +1 year when marked done. Env `NUXT_VAPID_PUBLIC_KEY`, `NUXT_VAPID_PRIVATE_KEY`, `NUXT_VAPID_SUBJECT`.

- [ ] Step 1: Unit tests: item crossing to soon → one notification, same state next hour → none (dedupe); reminder 7 days out and on the day; nudge only on Monday with stale readings. Run → FAIL → implement → PASS.
- [ ] Step 2: Settings: "Delete my account and data" (type DELETE to confirm, in-page — no browser `confirm()` dialog; cascades all user rows and files; e2e asserts login then fails); notifications toggle; on iOS not installed → explain "Add to Home Screen first, then turn notifications on" with share-sheet hint; Android → standard permission. Reminders list on Settings and per bike (insurance, IUC, inspection presets), mark done.
- [ ] Step 3: E2E: create IUC reminder, see it on the bike's screen header area as a chip when ≤ 30 days; subscribe endpoint stores subscription (permission granted via Playwright context). Validation loop (`settings.png`). Commit `feat: reminders and push notifications`.

### Task 12: Offline cache, outbox and sync

**Files:** `app/offline/db.ts` (Dexie: `bikes`, `bikeDetail`, `itemHistory`, `costs`, `outbox`, `pendingPhotos`), `app/offline/outbox.ts`, `app/offline/sync.ts`, `app/composables/{useApi,useOffline}.ts`, `app/components/OfflineBanner.vue`, `app/components/PendingBadge.vue`; tests `tests/unit/offline/outbox.test.ts` (fake-indexeddb), `tests/e2e/offline.spec.ts`.

**Interfaces — Produces:** `useApi().get(url)` → network first, falls back to Dexie cache, writes cache on success; `useApi().mutate(url, body)` → adds `clientId` if missing, POSTs when online, else `outbox.add({ url, body, createdAt })` and applies an optimistic local update to cached `bikeDetail` (readings, services, expenses). `flushOutbox(): Promise<{ sent: number; failed: number }>` in FIFO order, stops on network error, drops on 4xx with the error surfaced in PendingBadge, runs on `online`, `visibilitychange→visible` and app start (no Background Sync — iOS). Photos captured offline go to `pendingPhotos` and upload on flush; banner "1 invoice waiting to upload — keep the app open when online".

- [ ] Step 1: Unit tests: offline mutate queues; flush sends in order; flush retry after a network error replays same `clientId` (server dedupes — Review Focus 3); 422 is dropped and reported. Run → FAIL → implement → PASS.
- [ ] Step 2: Wire every write from Tasks 4–11 through `useApi().mutate`; reads through `get`. Offline banner on all screens; invoice reading/confirm disabled offline.
- [ ] Step 3: E2E: load bike screen, `context.setOffline(true)`, reload → bike screen still renders from cache; log a ride offline → hours card updates and "1 change waiting" badge; go online → badge clears and the server has exactly one reading. Validation loop (`offline.png`). Final: full `pnpm test && pnpm check && pnpm e2e`. Commit `feat: offline cache and outbox`.
