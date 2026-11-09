# Shelf and Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shelf of spare parts (stocked from invoices, used inside services, with a shopping list), then in-app voice notes that propose updates and answer questions from the rider's data.

**Architecture:** Shelf = four new user-scoped tables; every count change is a `part_movements` row applied in the same transaction as `parts.qty_hundredths`. Services and invoice confirm gain optional shelf fields; the computed shopping list reads item status from `itemRows()`. Voice = a client WAV recorder posting to `POST /api/voice`, which transcribes, then runs a bounded OpenRouter tool loop over read-only, user-scoped lookups and returns validated proposals that the client saves through the existing routes.

**Tech Stack:** Nuxt 4 SPA + Nitro, Postgres 16 + drizzle, better-auth, Dexie offline cache/outbox, Vitest, Playwright (phone 380×780), OpenRouter.

**Spec:** `docs/superpowers/specs/2026-11-09-shelf-design.md`, `docs/superpowers/specs/2026-11-09-voice-design.md` (both build on `docs/superpowers/specs/2026-11-08-enduro-tracker-design.md`). Each spec's "Decisions taken after the builder check" section is binding.

## Global Constraints

- Everything in `CLAUDE.md` applies: `useApi()` only from UI; `server/utils/validate.ts` for input; bad input 400, bad path id 404; every new route added to `tests/e2e/bad-input.spec.ts`; every query scoped through `server/utils/owned.ts`; every create carries `clientId` and upserts on `(userId, clientId)`; `.env.example` lists every new variable; never read or create a real `.env`.
- UI English; dark tokens from `app/assets/css/main.css`; 44 px tap targets; no browser `alert/confirm/prompt`.
- Quantities: integer hundredths in the DB and API (`qtyHundredths`), shown as `2` / `1.5 L`; inputs accept `1.5` and `1,5` via `parseDecimal`.
- Money integer cents, hours integer tenths, km integer (as today).
- Using a shelf part never creates an expense.
- Nothing from voice is written without the rider tapping Save; `POST /api/voice` never writes data.
- Validation loop per task: `pnpm test`, `pnpm check`, `pnpm e2e` for UI, screenshots for new screens (`tests/e2e/screenshots.spec.ts`, `SCREENSHOTS=1`), commit with the session attribution lines.
- Next migration number is `0005`. Generate with drizzle-kit as the existing migrations were; hand-edit only if needed and say so in the commit.

## Review Focus

1. **Offline replay of a service with parts after the part was deleted** → the service saves, the line keeps the snapshot name with `partId` null, no 400 (Task 4 test).
2. **Two queued +1/−1 movements for the same part from two devices** → final count is the sum, never last-write-wins (Task 2 test: two movements with different clientIds, one replayed twice).
3. **Deleting a service whose part was used past zero** → count returns exactly by the used amount (Task 4 test).
4. **Voice proposal with an id the user doesn't own** (another rider's bike id typed into the transcript or hallucinated) → dropped, never shown, never saved (Task 11 test).
5. **Voice answer when the data has nothing** ("when did I do the bearings?" with no bearings service) → "I don't know from your records" with no sources, not a made-up date (Task 11 mock-reader e2e).

---

## Part A: Shelf

### Task 1: Shelf schema and the movement core

**Files:**
- Modify: `server/db/schema.ts` (tables `parts`, `partItems`, `partMovements`, `shoppingEntries`)
- Create: `server/db/migrations/0005_shelf.sql` (+ drizzle meta)
- Create: `server/utils/parts.ts`
- Modify: `server/utils/owned.ts` (`ownedPart`, `ownedShoppingEntry`)
- Test: `tests/unit/server/parts.test.ts`

**Interfaces:**
- Produces:
  - Tables per shelf spec "Data", with: `parts(id, userId, clientId, bikeId → bikes set null, name text ≤ 80, unit text default 'pcs' ≤ 12, qtyHundredths int not null default 0, minHundredths int null, notes text null ≤ 500, createdAt, updatedAt)`, unique `(userId, clientId)`, index `(userId)`.
  - `partItems(partId → parts cascade, itemId → maintenanceItems cascade)`, unique pair.
  - `partMovements(id, userId, clientId, partId → parts set null, partName text, unit text, kind 'bought'|'used'|'adjust', qtyHundredths int signed, at date, expenseId → expenses set null, documentId → documents set null, serviceId → services cascade, note text null, createdAt)`, unique `(userId, clientId)`, indexes `(partId)`, `(serviceId)`.
  - `shoppingEntries(id, userId, clientId, text ≤ 120, bikeId → bikes set null, partId → parts set null, doneAt timestamptz null, createdAt, updatedAt)`, unique `(userId, clientId)`.
  - `applyMovement(tx: Tx, m: { userId: string; clientId: string; part: Part | null; partName: string; unit: string; kind: MovementKind; qtyHundredths: number; at: string; expenseId?: string; documentId?: string; serviceId?: string; note?: string }): Promise<{ applied: boolean }>` — inserts with `onConflictDoNothing` on `(userId, clientId)`; only when a row was inserted and `part` is non-null, does `qty_hundredths = qty_hundredths + delta` in SQL (never read-modify-write); on a 'bought' movement also ticks manual shopping entries linked to that part (`doneAt = now()` where `doneAt is null and createdAt <= now`).
  - `qty(v: unknown, field: string, { allowNegative?: boolean }): number` — integer hundredths in ±1 000 000 (=±10 000 units), 400 otherwise.
  - `ownedPart(event, id): Promise<Part>`, `ownedShoppingEntry(event, id)` — 404 on bad uuid or other user's row (copy `ownedNote`'s shape).

- [ ] **Step 1: Write failing unit tests** in `tests/unit/server/parts.test.ts` (against the dev DB like the other server tests): `applyMovement` adds to the count; replaying the same clientId leaves the count unchanged; two different clientIds (+100, −100) end at the start count; a 'used' past zero gives a negative count; a null `part` inserts the movement and changes nothing else; a 'bought' movement ticks a linked open shopping entry and leaves an unlinked one open; `qty` rejects `1.5` (not integer hundredths), `'12'`, `null`, `1_000_001`.
- [ ] **Step 2: Run** `pnpm test tests/unit/server/parts.test.ts` → FAIL (module missing).
- [ ] **Step 3: Add the tables, generate `0005_shelf.sql`, implement `parts.ts` and the two `owned*` helpers.** Run `pnpm db:migrate` against dev (5433).
- [ ] **Step 4: Run** the test file → PASS; `pnpm test`, `pnpm check` → green.
- [ ] **Step 5: Commit** `feat(shelf): schema and movement core`.

### Task 2: Shelf API

**Files:**
- Create: `server/api/parts/index.get.ts`, `index.post.ts`, `[id].get.ts`, `[id].patch.ts`, `[id].delete.ts`, `[id]/movements.post.ts`
- Modify: `server/utils/parts.ts`, `server/utils/account.ts` (account delete covers the new tables if it doesn't cascade from `user`)
- Test: `tests/unit/server/parts-api.test.ts` (or e2e API spec `tests/e2e/shelf-api.spec.ts` using `request`, like `bad-input.spec.ts`), `tests/e2e/bad-input.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces (JSON):
  - `GET /api/parts` → `PartRow[]`, `PartRow = { id, name, unit, qtyHundredths, minHundredths, notes, bikeId, bikeName, itemIds: string[] }`, sorted by name (`localeCompare` with `pt`).
  - `POST /api/parts` body `{ clientId, name, unit?, bikeId?, minHundredths?, notes?, itemIds?, qtyHundredths? }` → `PartRow`. A starting `qtyHundredths > 0` is written as an 'adjust' movement whose clientId is the body's `startClientId` (uuid, required when `qtyHundredths` is given), so a replayed create adds nothing twice. `itemIds` must belong to the part's bike when `bikeId` is set, else to any of the user's bikes.
  - `PATCH /api/parts/:id` body any of `{ name, unit, bikeId|null, minHundredths|null, notes|null, itemIds }` → `PartRow`. Never changes the count.
  - `DELETE /api/parts/:id` → `{ ok: true }` (movements keep snapshot, `partId` null; expenses untouched).
  - `GET /api/parts/:id` → `PartRow & { history: Array<{ id, kind, qtyHundredths, at, note, expenseId, documentId, serviceId, unitCents: number|null, garageName: string|null }> }`, newest first; `unitCents` from the expense amount ÷ qty for 'bought'.
  - `POST /api/parts/:id/movements` body `{ clientId, qtyHundredths (non-zero, signed), note? }` → `PartRow`, kind 'adjust', at = today.

- [ ] **Step 1: Write failing tests:** create/list/patch/delete round-trip; user B gets 404 on user A's part (all five id routes); `itemIds` from another bike → 400; replayed movement clientId → count unchanged (Review Focus 2); delete keeps a 'bought' expense. Add every route to `bad-input.spec.ts` (bad ids in path → 404, bad qty/name/unit/min → 400).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the routes on top of `parts.ts`.
- [ ] **Step 4: Run** tests + `pnpm e2e tests/e2e/bad-input.spec.ts` → PASS; `pnpm check`.
- [ ] **Step 5: Commit** `feat(shelf): parts API`.

### Task 3: Shopping list API (computed + manual)

**Files:**
- Create: `server/api/shopping/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`
- Create: `server/utils/shopping.ts`
- Test: `tests/unit/server/shopping.test.ts`, `tests/e2e/bad-input.spec.ts`

**Interfaces:**
- Consumes: Task 1–2; `itemRows(bikeId, userId, now)` from `server/utils/bikes.ts` (status `state` in `'overdue'|'soon'|'ok'|'unknown'`).
- Produces: `GET /api/shopping` → `{ auto: AutoEntry[], manual: ManualEntry[] }`.
  - `AutoEntry = { key: string /* `${reason}:${partId}` */, partId, partName, unit, bikeId|null, bikeName|null, reason: 'due' | 'min', detail: string }`. `due`: part linked to an item whose state is `overdue` or `soon` and part count ≤ 0; detail like `"Engine oil on KTM 300 — overdue"` / `"— soon"`. `min`: `minHundredths != null && qty < min`; detail `"keep 2, have 1"`. A part matching both appears once with reason `due`.
  - `ManualEntry = { id, text, bikeId|null, bikeName|null, partId|null, doneAt|null }`; done entries older than 7 days are not returned.
  - `POST /api/shopping` `{ clientId, text, bikeId?, partId? }`; `PATCH /api/shopping/:id` `{ text?, done?: boolean }`; `DELETE`.
- `computeAuto(parts, itemsByBike)` is a pure function in `shopping.ts` so it is unit-tested without a DB.

- [ ] **Step 1: Failing tests** for `computeAuto` (due+0 → listed; due+1 → not; ok+0 → not; min 200 qty 100 → listed with "keep 2, have 1"; both → one `due` entry) and for the 7-day hide; bad-input cases for the four routes.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, `pnpm check`.
- [ ] **Step 5: Commit** `feat(shelf): shopping list API`.

### Task 4: Parts used in services

**Files:**
- Modify: `server/utils/services.ts` (`insertService`, `deleteService`, `listServices`), `server/utils/item-history.ts`
- Test: `tests/unit/server/services-parts.test.ts`

**Interfaces:**
- Consumes: `applyMovement`, `qty`.
- Produces:
  - `POST /api/services` accepts optional `partsUsed: Array<{ clientId: uuid, partId: uuid, qtyHundredths: int > 0 }>` (≤ 20). Inside the existing transaction, after the service row: for each line, look up the part scoped to the user; found → `applyMovement(kind 'used', qty negative, at = service.at, serviceId)`; not found (deleted while queued) → movement with `part: null`, `partName` = the body's optional `partName` string or `'Removed part'`, so the service still saves (Review Focus 1). A malformed line is a 400.
  - `deleteService`: before deleting, for each 'used' movement of the service with a non-null `partId`, add its quantity back (`qty_hundredths - movement.qty`), then the cascade removes the movements (Review Focus 3).
  - `listServices` rows and item history entries gain `partsUsed: Array<{ name: string, qtyHundredths: number, unit: string }>` from the movements' snapshot.

- [ ] **Step 1: Failing tests:** service with two parts lowers both counts; replay of the same service clientId lowers nothing more; part deleted before replay → service saved, history shows the snapshot name; delete a service used past zero → count back to the exact start; `partsUsed` with qty 0 / bad uuid → 400 (add to `bad-input.spec.ts`).
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS, `pnpm check`.
- [ ] **Step 5: Commit** `feat(shelf): parts used in services`.

### Task 5: Invoice lines to the shelf

**Files:**
- Modify: `server/utils/invoice-confirm.ts`, `app/pages/invoice/[docId].vue`
- Test: `tests/unit/server/invoice-confirm-shelf.test.ts`, `tests/e2e/invoice-review.spec.ts`

**Interfaces:**
- Consumes: `applyMovement`, Task 2 part creation helper (export `createPart(tx, userId, raw)` from `parts.ts` in this task if Task 2 kept it inline).
- Produces: each confirm line may carry `shelf: { clientId: uuid, partId?: uuid, name?: string, unit?: string, qtyHundredths: int > 0, bikeId?: uuid|null }`. With `shelf`: the line's expense is created as today (its category as chosen), the line's `itemIds` are ignored (no service, no `expense_items`), and a 'bought' movement is applied to `partId` (must be owned) or to a new part created from `name`/`unit`/`bikeId` (the movement's `expenseId` and `documentId` set). If every line is a shelf line, no service is created at all.
- UI: each line gets a two-option toggle **Used now** (default) / **To the shelf** (`data-testid="line-shelf"`). To the shelf shows name (prefilled from the description), quantity (from the read line's `qty`, else 1), unit, and "Same as a part on the shelf" search (`data-testid="line-shelf-pick"`); the item-matching chips hide for that line.

- [ ] **Step 1: Failing tests:** shelf line with a new part → part exists with qty, expense exists with `serviceId` null, no `service_items`; shelf line onto an existing part adds to it; mixed invoice (one used, one shelf) → service links only the used line's items; other user's `partId` → 400; manual shopping entry linked to the part gets `doneAt`. E2E: mock invoice, set line 3 to the shelf, confirm, `/api/parts` shows "Rolamentos roda traseira" with 1.
- [ ] **Step 2–4:** run → FAIL, implement server then UI, run → PASS; `pnpm e2e`.
- [ ] **Step 5: Commit** `feat(shelf): invoice lines to the shelf`.

### Task 6: Shelf screen, part sheet, offline

**Files:**
- Create: `app/pages/shelf.vue`, `app/components/PartSheet.vue`, `app/lib/search.ts`
- Modify: `app/pages/index.vue` (Garage: "Shelf" row, `data-testid="garage-shelf"`), `app/offline/db.ts` (`cacheTableFor`: `/api/parts`, `/api/shopping` → `lists`; `/api/parts/:id` → `lists`), `app/offline/api.ts` + `app/offline/overlay.ts` (queueable: `POST /api/parts`, `PATCH /api/parts/:id`, `POST /api/parts/:id/movements`, shopping POST/PATCH; overlay applies a queued movement's delta to the cached `GET /api/parts` row and shows queued new parts), the queue comment in `useApi.ts`/`api.ts`, `CLAUDE.md` (queue list)
- Test: `tests/unit/app/search.test.ts`, `tests/unit/app/overlay-parts.test.ts`, `tests/e2e/shelf.spec.ts`, screenshot `shelf.png`, `part-sheet.png`

**Interfaces:**
- Produces: `normalise(s: string): string` (NFD, strip combining marks, lowercase, trim) and `matches(query: string, ...fields: Array<string | null | undefined>): boolean` (every whitespace-separated query word appears in some field) in `app/lib/search.ts`.
- Screen: search box (`shelf-search`), section switch **Shelf** / **To buy** (`shelf-tab-parts`, `shelf-tab-buy`; Task 8 fills To buy), part rows (`part-row`: name, count + unit, bike or "Any bike", red when below min, greyed at ≤ 0), "Add part" → `PartSheet`. Query param `?item=<itemId>` filters to parts linked to that item (used by Task 7).
- `PartSheet`: fields per shelf spec, − / + buttons post a movement of ∓100 (`{ queue: true }`), "keep at least", linked items (chips from the chosen bike's items, or all bikes'), notes, history list, delete with in-sheet confirm.

- [ ] **Step 1: Failing unit tests:** `matches('junta', 'Junta escape')`, `matches('JUNTA esc', 'junta de escape')`, `matches('óleo', 'Oleo motor')` true; `matches('filtro ar', 'Filtro óleo')` false. Overlay: cached part qty 200 + queued movement −100 → 100; queued new part appears.
- [ ] **Step 2: Failing e2e** `shelf.spec.ts`: add "Junta escape" qty 2 for a bike; search "junta" finds it with "2"; tap − → "1"; offline (`context.setOffline(true)`), tap − → "0" and pending badge "1 change waiting"; back online → badge gone, server count 0.
- [ ] **Step 3: Implement.** **Step 4: Run** unit + e2e → PASS; screenshots, look at them.
- [ ] **Step 5: Commit** `feat(shelf): shelf screen and part sheet`.

### Task 7: Parts used in Mark done, and the stock mark on the bike screen

**Files:**
- Modify: `app/components/MarkDoneSheet.vue`, `app/components/ItemRow.vue`, `server/utils/bikes.ts` (`itemRows` adds `stock`), the item-history page/components that list services
- Test: `tests/unit/server/bike-stock.test.ts`, `tests/e2e/services.spec.ts` (new test), screenshots `mark-done-parts.png`, `bike-stock.png`

**Interfaces:**
- Consumes: Tasks 2, 4, 6 (`/api/parts` cached; `?item=` filter).
- Produces: `ItemRow.stock: 'in' | 'none' | null` — null when no part is linked; 'none' when any linked part has `qtyHundredths <= 0`; else 'in'.
- MarkDoneSheet: **Parts used** section (`parts-used`) listing parts linked to the ticked items first, pre-ticked qty 1 when count > 0; "Add from shelf" search (`parts-add`); qty field per part; a part whose count would go below zero needs "Use anyway" (`parts-use-anyway`) before Save. Posts `partsUsed` with a client-made `clientId` per line and `partName` snapshot; works queued offline.
- ItemRow: for `soon`/`overdue` rows only, a small "✓ in stock" (green) or "✗ no spare" (red) after the status text (`item-stock`); tapping it opens `/shelf?item=<id>` without opening the row.
- History lists show "Parts: oil filter, 1 L Motorex 10W-50".

- [ ] **Step 1: Failing tests:** `itemRows` stock null/in/none cases; e2e: link "Oil filter" (qty 1) to Engine oil, bike row shows "✓ in stock" when soon, mark done with the pre-ticked filter → count 0, row (after a reading making it soon again) shows "✗ no spare"; history shows "Parts: Oil filter".
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS; screenshots.
- [ ] **Step 5: Commit** `feat(shelf): parts used in services and stock marks`.

### Task 8: To buy list UI

**Files:**
- Modify: `app/pages/shelf.vue`; Create: `app/components/ShoppingSheet.vue` (add/edit manual entry)
- Test: `tests/e2e/shelf.spec.ts` (new tests), screenshot `shopping.png`

**Interfaces:**
- Consumes: Task 3 (`GET /api/shopping`).
- Produces: To buy tab: automatic entries first (`buy-auto`: part name, detail, bike; tap opens the part sheet), then manual (`buy-manual`: checkbox tick → `PATCH done`, queued; ticked ones struck through until they age out), "Add to list" (`buy-add`) → `ShoppingSheet` (text, optional bike, optional part). A count badge on the To buy switch shows auto + open manual.

- [ ] **Step 1: Failing e2e:** part with min 2 qty 1 shows "keep 2, have 1"; add manual "Chain lube", tick it, reload → still shown ticked; linked manual entry disappears from open entries after an invoice puts that part on the shelf (reuse Task 5 mock flow).
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS; screenshot.
- [ ] **Step 5: Commit** `feat(shelf): to-buy list`.

---

## Part B: Voice

### Task 9: Model spike (rider runs it)

**Files:**
- Create: `scripts/voice-spike.mjs`, `tests/fixtures/voice/oil-change-pt.wav` (a short clip: generate with macOS `say -v Joana "troquei o óleo e o filtro da KTM às cento e quarenta e três horas" -o x.aiff` then `afconvert -f WAVE -d LEI16@16000 -c 1 x.aiff oil-change-pt.wav`), `tests/fixtures/voice/question-en.wav` (`say -v Samantha "do I have an exhaust gasket"`)

**Interfaces:**
- Produces: a script that reads `NUXT_OPENROUTER_API_KEY` and optional `NUXT_VOICE_MODEL` from the process environment (never a file it opens itself), sends (1) a transcription request with the WAV as `input_audio` `{ data: base64, format: 'wav' }` and (2) a text request with one dummy tool, and prints PASS/FAIL per step with the transcript. The implementer does not run it with a key; the controller asks the rider to run `! node --env-file=.env scripts/voice-spike.mjs` and records the output here:

> Spike result (2026-11-09, rider's key): `google/gemini-3.1-flash-lite` PASSES both. WAV transcription 1.6 s → "Trocar e o óleo e o filtro da KTM às 143 horas." (synthetic voice; "troquei" heard as "trocar e", so prompts must not depend on exact verb forms); tool call 0.8 s → `item_status({"bikeName":"KTM"})`. No separate default voice model needed: `NUXT_VOICE_MODEL` stays optional, defaulting to `NUXT_OPENROUTER_MODEL`. Task 9 is done (commit 5ef5dd4).

- [ ] **Step 1:** Create fixtures and script; `node scripts/voice-spike.mjs` without a key prints "NUXT_OPENROUTER_API_KEY not set" and exits 1.
- [ ] **Step 2: Commit** `chore(voice): model spike script and fixtures`.

### Task 10: Read-only voice tools

**Files:**
- Create: `server/utils/voice-tools.ts`
- Test: `tests/unit/server/voice-tools.test.ts`

**Interfaces:**
- Produces: `VOICE_TOOLS: ToolDef[]` (OpenAI-style function schemas) and `runTool(userId: string, name: string, args: unknown, now = new Date()): Promise<{ ref: string; result: unknown }>` for:
  - `list_bikes()` → bikes with id, name, latest hours/km.
  - `item_status({ bikeId })` → items with id, name, state, sinceHoursTenths, sinceKm, last done date/hours/km, interval.
  - `item_history({ itemId, limit? ≤ 10 })` → services: date, hours, km, by, garage, parts used, total cents.
  - `search_shelf({ query })` → matching parts (uses a server copy of `matches`/`normalise`: move `app/lib/search.ts` logic to a shared module importable by both, e.g. `shared/search.ts`, if Nuxt 4 `shared/` is set up; otherwise duplicate with a test that both agree).
  - `shopping_list()` → Task 3 shape.
  - `costs({ period: 'month'|'year'|'all', date?, bikeId?, categoryKind? })` → total cents and by-category, via the existing costs query.
  - `reminders()` → upcoming reminders.
  Every id argument is checked owned by `userId` (unknown → `{ error: 'not found' }`, not a throw). `ref` is `${name}#${n}` unique per request; results carry raw values (tenths, cents, ISO dates).

- [ ] **Step 1: Failing tests:** each tool returns the seeded rider's data; another rider's bikeId → `{ error: 'not found' }`; `search_shelf('junta')` finds "Junta escape".
- [ ] **Step 2–4:** FAIL → implement → PASS, `pnpm check`.
- [ ] **Step 5: Commit** `feat(voice): read-only lookup tools`.

### Task 11: `POST /api/voice`

**Files:**
- Create: `server/api/voice/index.post.ts`, `server/utils/voice.ts`, `server/utils/voice-proposals.ts`
- Modify: `server/utils/rate-limit.ts` (voice counters, copy), `nuxt.config.ts` (`runtimeConfig.voiceModel`, `voiceDailyCap: 60`, `voiceGlobalDailyCap: 600`, `voiceReader: ''`), `.env.example` (`NUXT_VOICE_MODEL`, `NUXT_VOICE_DAILY_CAP`, `NUXT_VOICE_GLOBAL_DAILY_CAP`, `NUXT_VOICE_READER`), `server/api/voice/status.get.ts` (`{ available: boolean }`), `playwright.config.ts` (e2e server env `NUXT_VOICE_READER=mock`)
- Test: `tests/unit/server/voice.test.ts`, `tests/unit/server/voice-proposals.test.ts`, `tests/e2e/voice-api.spec.ts`, `tests/e2e/bad-input.spec.ts`

**Interfaces:**
- Consumes: Task 10; `parseDecimal`-free (server gets numbers).
- Produces:
  - Request: multipart `audio` (WAV, ≤ 2.5 MB, duration from the header ≤ 62 s) and/or field `transcript` (≤ 2000 chars; when given, step (a) is skipped), optional field `history` (JSON, ≤ 3 `{ q, a }`), optional `tz` (IANA zone for "today").
  - Response: `VoiceResult = { transcript: string; answer: string | null; sources: Array<{ tool: string; ref: string; data: unknown }>; proposals: Proposal[]; notes: string[] }`.
  - `Proposal` = `{ kind: 'reading', bikeId|candidates, hoursTenths?, km? }` | `{ kind: 'service', bikeId|candidates, itemIds|itemCandidates, at, hoursTenths?, km?, by, garageName?, notes?, partsUsed?: [{ partId, qtyHundredths }] }` | `{ kind: 'use_part', partId|candidates, qtyHundredths }` | `{ kind: 'add_part', name, unit, qtyHundredths, bikeId? }` | `{ kind: 'shopping', text, bikeId?, partId? }` | `{ kind: 'expense', amountCents, categoryId|candidates, bikeId?, at, description }` | `{ kind: 'reminder', title, dueOn, repeatYearly, bikeId? }`, where `candidates: string[]` replaces the single id when unsure.
  - `validateProposals(userId, raw): { proposals: Proposal[]; notes: string[] }` — every id/candidate checked owned (unknown dropped; a proposal left with neither id nor candidates gets `candidates: []` so the card shows a full picker); every field checked with `validate.ts` rules; invalid proposals dropped with a note "Couldn't understand: …". Review Focus 4.
  - Loop: system prompt (Portuguese/English, today's date in `tz`, tool rules, "never state a number not returned by a tool; if the records don't say, answer that you don't know from the records"), ≤ 6 tool rounds, final tool `answer({ answer, sources: [ref…], proposals })`. `sources` kept only for refs that exist this request.
  - Mock reader (`voiceReader === 'mock'`): no network; transcript from the `transcript` field or `"mock transcript"`; a fixed rule set for e2e: transcript containing "oil" → one `service` proposal for the first bike's first item matching /oil/i; containing "gasket" → `answer` from a real `search_shelf` call with its source; containing "bearings" with no bearings history → "I don't know from your records." with no sources.
  - Limits via `assertVoiceAllowed(userId, dailyCap, now, globalCap)` mirroring `assertReadAllowed` with separate buckets and copy `"Daily voice limit reached — you can still use the app as usual."`; counted only after input validation passed (spec decision 4). No key and not mock → 503 `"Voice isn't set up on this server."`.
  - Audio never written to disk or DB; log only sizes and timings.

- [ ] **Step 1: Failing unit tests:** `validateProposals` drops a foreign bikeId, keeps owned candidates, rejects `hoursTenths: 1.5`, `at: '2026-02-30'`; the loop with a fake `fetch` stops after 6 rounds; sources with an unknown ref are dropped; a WAV header claiming 90 s → 400; non-WAV bytes → 400.
- [ ] **Step 2: Failing e2e** `voice-api.spec.ts` with the mock reader covering the three mock rules (Review Focus 5) and the daily cap (set cap 2 via env in the e2e config only if the config already supports per-spec env; otherwise unit-test the cap); add `/api/voice` bad cases to `bad-input.spec.ts` (no audio and no transcript, 3000-char transcript, bad history JSON → 400).
- [ ] **Step 3: Implement.** **Step 4: Run** → PASS, `pnpm check`.
- [ ] **Step 5: Commit** `feat(voice): voice endpoint with tool loop and validated proposals`.

### Task 12: Recorder, mic button, offline voice queue

**Files:**
- Create: `app/lib/wav.ts`, `app/composables/useRecorder.ts`, `app/components/MicButton.vue`
- Modify: `app/app.vue`, `nuxt.config.ts` (`Permissions-Policy` `microphone=(self)`), `app/offline/db.ts` (Dexie `version(3)`: `pendingVoice: '++id, clientId'`), `app/composables/useOffline.ts` + `app/components/PendingBadge.vue` (voice notes waiting / ready / failed with Retry, Discard)
- Test: `tests/unit/app/wav.test.ts`, `tests/e2e/voice.spec.ts` (recording via a fake `getUserMedia` stream from `--use-fake-device-for-media-stream` or an `addInitScript` stub), screenshot `mic.png`

**Interfaces:**
- Produces: `encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer` (16-bit PCM mono) and `downsample(samples: Float32Array, from: number, to: 16000): Float32Array` in `wav.ts`; `useRecorder()` → `{ state: Ref<'idle'|'asking'|'recording'|'denied'|'unsupported'>, level: Ref<number>, seconds: Ref<number>, start(): Promise<void>, stop(): Promise<ArrayBuffer | null>, cancel(): void }` (AudioWorklet where available, ScriptProcessor fallback; auto-stop at 60 s).
- `MicButton`: fixed round button above the tabs on `/`, `/bikes/:id`, `/history`, `/costs`, `/shelf`; hidden when `/api/voice/status` says unavailable, on other routes, or while any `Sheet` is open (expose an `openSheets` counter from `Sheet.vue` via a tiny composable). Press-and-hold ≥ 300 ms = hold mode (release sends); shorter tap = toggle mode. Denied → in-page text on how to allow the mic.
- Offline / network error: the WAV goes to `pendingVoice` with `{ clientId, userId, data, createdAt, attempts, error?, result? }`; the flush processes it when online and stores `result`; PendingBadge shows "Voice note ready" (tap opens the Task 13 sheet with that result) and failures with Retry/Discard.

- [ ] **Step 1: Failing unit tests:** `encodeWav` header (RIFF, 16000 Hz, 1 channel, 16-bit, data length = 2 × samples); `downsample` 48000→16000 length ÷ 3; clipping at ±1.
- [ ] **Step 2: Failing e2e:** mic hidden on `/login`; visible on the bike screen when mock voice is on; hold → recording UI with seconds; release → `POST /api/voice` called (route intercepted); offline → "1 voice note waiting", online → "Voice note ready".
- [ ] **Step 3–4:** implement → PASS; screenshot.
- [ ] **Step 5: Commit** `feat(voice): recorder, mic button and offline voice queue`.

### Task 13: Voice review sheet, answers, privacy copy

**Files:**
- Create: `app/components/VoiceSheet.vue`, `app/components/voice/ProposalCard.vue` (+ per-kind field partials as needed)
- Modify: `app/pages/register.vue` (privacy note per voice spec "Privacy"), `app/pages/settings.vue` (voice status line + the same privacy sentence), `README.md` (voice env and limits)
- Test: `tests/e2e/voice.spec.ts`, screenshots `voice-review.png`, `voice-answer.png`

**Interfaces:**
- Consumes: `VoiceResult`, `Proposal` (Task 11), the existing routes for saving: readings `POST /api/readings`, services `POST /api/services` (with `partsUsed`), part movements, `POST /api/parts`, `POST /api/shopping`, `POST /api/expenses`, `POST /api/reminders`.
- Produces: sheet states Listening → transcript (editable textarea `voice-transcript`, "Send again" re-posts with `transcript` and `history`) → result. Proposal cards (`voice-card`) with kind title, editable fields reusing the same parsing (`parseDecimal`) and pickers (bike/item/part/category) when `candidates` is set, × remove; **Save** (`voice-save`) writes cards one by one through `useApi().mutate` with a client `clientId` per card (`{ queue: true }` where the route is queueable), each card then shows Saved / Failed with Retry. Answer card (`voice-answer`): text, "From your records" lines rendered from `sources[].data` with `useFormatters()`, speaker button (`voice-speak`) using `speechSynthesis` with `lang` guessed from the transcript (`pt-PT` when it contains Portuguese markers, else `en-GB`), and the mic for a follow-up (history ≤ 3 turns, sheet-local).

- [ ] **Step 1: Failing e2e (mock reader, transcript path to avoid audio):** "changed the oil at 143" → one service card for Engine oil; edit hours to 143,5; Save → bike screen item reset and history shows 143.5 h. "do I have a gasket" with "Junta escape" on the shelf → answer card with a source line naming the part and "2". "when did I do the bearings" with none → "I don't know from your records." and no source lines. Remove (×) a card → Save writes nothing for it. Register page shows the new privacy sentence.
- [ ] **Step 2–4:** FAIL → implement → PASS; screenshots, look at them.
- [ ] **Step 5: Commit** `feat(voice): review sheet, answers and privacy note`.

### Task 14: Wrap-up

- [ ] Full `pnpm test`, `pnpm check`, `pnpm e2e`; README "Deploy" lists the new env vars and that voice uses the same OpenRouter key; `.env.example` complete; CLAUDE.md queue list and voice caps line updated.
- [ ] Commit `docs: shelf and voice in README and CLAUDE.md`.
