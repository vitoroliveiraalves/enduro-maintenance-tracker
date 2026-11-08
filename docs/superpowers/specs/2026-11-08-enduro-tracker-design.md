# Enduro Tracker — design

Date: 2026-11-08 · Status: draft for approval

## Intent

A phone-first PWA for an enduro rider to answer, standing in the garage after a ride:

- "Has the oil done 20 hours already?"
- "When did I last clean the air filter?"
- "When did I do the bearings, where, and what did it cost?"

…and to know what the bikes actually cost to run, by month and by year. Garage work should not have to be typed: you photograph the invoice, the app reads it, you confirm.

**Success:** the rider opens the app after a ride, updates the meters in a few seconds, and immediately sees what is due. Every expense, DIY or garage, ends up in one place with its invoice image.

## Goals (v1)

1. **Bikes.** Add any number of custom bikes (name, make, model, year, 2T/4T, optional photo). Each bike keeps a current **hours** and **km** reading.
2. **Meter updates.** "Log ride / update meters": enter what the hour meter and odometer read now (not the ride delta). The app stores each reading with its date, so hours/km at any past date can be derived. A reading can optionally carry ride **conditions** (normal / mud / sand / dust / race).
3. **Maintenance items with intervals.** Per bike, a list of items (engine/gear oil, oil filter, air filter clean, chain & sprockets, wheel bearings, piston & rings, spark plug, fork service, shock service, brake fluid, coolant…). A new bike is seeded from a starter template (2T and 4T variants); everything is editable, and you can add your own items. Each item has one or more interval limits — **hours, km, and/or months** — and is due at **whichever comes first**.
4. **Condition multipliers.** Hours ridden in mud/sand/dust/race count extra toward selected items (default e.g. ×1.5 for air filter and oil; user-editable per item). Plain hours are still shown; the multiplied figure drives due-ness.
5. **Service log.** Mark an item done (DIY or garage), at the current or a past date/hours/km, with optional cost, notes, parts and photo. Doing it resets that item's counter. One service entry can cover several items (e.g. "oil + oil filter").
6. **Invoice capture.** Photograph (up to 5 pages) or upload a PDF of a garage invoice. The app:
   - reads the **Portuguese invoice QR code** (Portaria 195/2020) in the browser for supplier NIF, date, number and totals — ground truth when present;
   - sends the images to a vision model via **OpenRouter** (`google/gemini-3.1-flash-lite` default, as in encomentio) to read the lines;
   - proposes: the garage, date, each line as a part/labour with price, and which maintenance items it matches (e.g. "Rolamentos roda" → Wheel bearings);
   - the rider reviews, fixes, picks the bike and the hours/km at the time, and confirms. Nothing is saved without confirmation; nothing is made up. If reading fails or is off, the image is kept and the rider fills lines by hand.
   - The invoice image is always stored and viewable from the service entry and the expense.
7. **Prices.** Every line confirmed from an invoice or typed by hand is kept as a price history per part/item, so the app can say "last time this cost 24,90 €" and estimate upcoming costs.
8. **Expenses beyond maintenance.** Log any cost with a category: maintenance, parts, tyres & mousse, fuel & 2T oil, race entries, insurance / IUC / inspection, upgrades, gear, other. Categories are editable.
9. **Bike screen** (approved mockup layout A): bike name, big hours and km, the "Log ride / update meters" button, and one maintenance list **sorted by urgency** with a progress bar, "left / overdue" in red/amber/green, time since last done, interval, date, and DIY/garage. Tapping a row opens that item's history with costs and invoice images.
10. **Costs screen** (mockup shown): toggle Month / Year / All time, and All bikes or one bike. Shows the total (with comparison to the same point last year), a by-month bar chart, spend by category, spend by bike, the list of expenses in the period, and "coming up" estimates from last prices paid. A small €/hour figure is shown but is not a headline (the rider did not pick cost-per-hour as a priority).
11. **Date-based reminders** that aren't service intervals: insurance renewal, IUC, inspection, licence, etc. — a date and optional repeat yearly.
12. **Push notifications** (Web Push): an item becomes due or close; a renewal date is near; a nudge to update meters after a weekend with no reading.
13. **Tabs:** Bike · History · Invoice (camera) · Costs. Plus a Garage list to switch bikes and Settings.

## Later (not v1, but don't paint into a corner)

Picked by the rider as wanted; sequenced after v1 (builder's call on order — suggested):

- **v2 garage:** spares on the shelf with "in stock ✓" on reminders and a shopping list; bike spec sheet (capacities, torques, part numbers, plug gap, jetting); 2T premix calculator; tyre & mousse life (hours per tyre/mousse, compare brands); suspension & tyre-pressure setup log with a baseline per track/terrain.
- **v3:** service-history PDF for selling the bike (dates, hours, invoices); yearly budget; **sharing a bike** with a mechanic or riding mate.

Sharing means multi-user. v1 therefore uses real accounts and stores data server-side per user, with bikes owned by a user, so that a bike can later get extra members without migration pain.

## Non-goals

- Not a ride/GPS tracker; no route recording.
- No shop/garage-side features, no marketplace, no parts ordering.
- No social features in v1.
- No native iOS/Android apps — PWA only.

## Anti-goals (fails even if it "works")

- Updating meters takes more than a few taps, or the bike screen needs scrolling/thinking to see what's due.
- The invoice reader silently invents or saves data the rider didn't confirm.
- An invoice image is lost, or a price can't be traced back to its invoice.
- The app is useless without signal in the garage/at the trail (see offline below).

## Constraints & decisions

- **PWA, phone-first**, works installed on the home screen. Dark UI with an orange accent as in the mockups.
- **Offline:** the bike screen, history and costs must open offline from the last sync; meter updates, service entries and expenses made offline are queued and synced later. Invoice reading needs a connection; capturing photos offline queues them for reading.
- **Invoice reading reuses encomentio's approach** (`~/encomentio/features/faturas.md`, `apps/web/server/utils/fatura-extract.ts`, `fatura-validation.ts`): QR first, AI for lines, downscale photos to 2400 px / JPEG 0.85 in the browser, PDFs accepted (≤10 MB), never fatal on a bad row, rate limited, model and key via env. Port the code rather than depending on that repo.
- Ignore `~/moto-tracker` (rider's instruction).
- Money in cents, EUR, `1.234,56 €` formatting. Hours to one decimal.

### Decided by the rider (2026-11-08)

- **Open registration** (rider changed this on 2026-11-08, replacing "private app"). Anyone can create an account with email + password. Each user sees only their own data. Bike sharing in v3 is by invitation. Builder's calls that follow from it: invoice reading rate limit 60 / user / 10 min **plus a daily cap of 30 reads per user** (`NUXT_INVOICE_DAILY_CAP`); a short privacy note on the sign-up page (what is stored, that invoice images are sent to an AI provider via OpenRouter); a "Delete my account and data" action in Settings; no email verification in v1 (no SMTP yet) — sign-up is rate-limited per IP by better-auth.
- **iPhone and Android.** Design to iOS limits: Web Push only after "Add to Home Screen" (iOS 16.4+) — the app must explain this and offer install; no Background Sync, so the offline queue flushes when the app is open/foregrounded; don't rely on IndexedDB surviving long for queued photos (warn when items are pending).
- **No past history to import.** Start fresh; "last done at" per item during bike onboarding is the only seeding. No CSV import in v1.

### Builder's calls (made by Claude, not confirmed by the rider — flag if wrong)

- **Stack:** mirror encomentio minus the separate API — **Nuxt 4 + TypeScript, Nitro server routes, Postgres + drizzle, better-auth, Tailwind 4, `@vite-pwa/nuxt`, Docker**. Single app, no monorepo.
- **UI language: English** (the rider wrote in English). Invoices are Portuguese, so matching works on PT text.
- **Auth:** email + password / magic link via better-auth; one user for now.
- Starter templates and default intervals: builder researches sensible defaults for common 2T/4T enduro bikes; all editable.
- Invoice files stored in Postgres (as encomentio) or object storage — builder's call.
- Hosting/deploy target — builder's call, Docker-based.
- **Invoice → expenses per line.** A confirmed invoice is one document holding its image(s), header (garage, NIF, date, number, totals) and lines. **Each line carries its own category** (tyres, oil, labour, upgrade…), so Costs is correct for mixed invoices. The camera tab accepts **any receipt** (fuel, gear shop, race entry): the flow is *expense first, service optional* — linking lines to maintenance items is what creates/resets service entries.
- **Line ↔ item link is many-to-many.** A line ("Óleo + filtro") can be linked to several maintenance items; a service can be made of several lines. Labour lines get category *labour* and may be linked to the items they cover. Price history is per line (with its invoice); "last time it cost X" / "coming up" estimates for an item = sum of the lines linked to that item's last service (a line linked to N items counts in full for each estimate — good enough; no cost splitting in v1).
- **Adding a bike with hours on it.** Onboarding shows the seeded items and lets the rider optionally enter "last done at" (hours/km/date) per item. Items left blank show as grey **"Unknown — set last done"**, not as overdue, and sort after overdue/amber items. Doing the item once fixes it.
- **Ride conditions** apply to **all hours since the previous reading** (one condition per reading; if a week mixed conditions, the rider picks the dominant one). Multipliers apply to **hours only**, never km.

## Left to the builder

Data model details, sync/conflict strategy for offline (last-write-wins is acceptable for a single user), exact screens beyond the two mockups, test strategy, notification scheduling mechanics.

## Reference mockups

`.superpowers/brainstorm/*/content/bike-home.html` (layout A chosen) and `costs-overview.html`.
