# Shelf: spare parts in stock, parts used in services, shopping list

Status: approved in conversation 2026-11-09. Extends `2026-11-08-enduro-tracker-design.md`
("v2 garage: spares on the shelf with 'in stock ✓' on reminders and a shopping list").

## Why

The rider is in the garage, needs a gasket, and doesn't know whether one is on the
shelf. The app already knows what's due and what parts cost; it doesn't know what
spares the rider owns. Success: type "gasket" and get a yes/no with how many, which
one, and for which bike, in a couple of seconds, offline.

## Goals

1. **Shelf** of spare parts with a count, searchable by name.
2. **Stock it from invoices**: on the existing invoice review, a line can go "to the shelf".
3. **Use parts inside the maintenance itself**: marking a maintenance done lets the
   rider pick parts from the shelf; counts go down.
4. **"✓ in stock / ✗ no spare"** on due maintenance items on the bike screen.
5. **Shopping list**: automatic entries plus the rider's own, ticked off by hand or by
   an invoice that restocks the part.

## Non-goals

- No parts ordering, prices from shops, or supplier catalogues (main spec non-goal).
- No barcode scanning of parts.
- No multi-location stock (one shelf per rider).
- No new bottom tab.

## Anti-goals

- Spend counted twice: using a shelf part in a service must never add a new expense.
- Counts silently drifting: every change to a count comes from a visible rider action
  (add, invoice confirm, service save/delete, manual +/−), and deleting a service
  puts its parts back.
- Invoice review gets slower for the rider who doesn't care about the shelf: "used now"
  stays the default and the extra choice is one tap.
- Bike screen gets cluttered: the stock mark is a small glyph on rows already shown.

## What the rider sees

### Shelf screen (`/shelf`)
Reached from the Garage screen (a "Shelf" row/button) and from the stock mark on a
bike-screen row. Top: a search box (matches name and notes, accent- and case-insensitive,
"junta" finds "Junta escape"). Below: two sections or a switch, **Shelf** and **To buy**.

Each part row: name, count with unit ("2", "1.5 L"), the bike it's for (or "Any bike"),
and a red mark when below its minimum. Tapping opens the part sheet: name, bike (optional),
unit, count with − / + buttons, optional "keep at least" minimum, linked maintenance items,
notes, and its history (bought: date, qty, unit price, garage, invoice link; used: date,
qty, service link; manual adjustments). "Add part" creates one by hand. A part at 0 stays
listed (greyed) so its link and history survive; it can be deleted (history goes with it,
services keep their own record of what was used — see data).

### Invoice review
Each line gets a small choice **Used now** (default, today's behaviour) / **To the shelf**.
"To the shelf" shows: part name (prefilled from the line description, editable), quantity
(from the invoice line if the reader gave one, else 1), unit, and "same as an existing
part" picker (search the shelf; picking one adds to it instead of creating a new part).
The expense for the line is created exactly as today (it is real spend). Confirming adds
the quantity to the part and records a "bought" movement pointing at the expense and document.

### Mark maintenance done (MarkDoneSheet)
New **Parts used** section: parts linked to the selected maintenance items are listed
first, pre-ticked with qty 1 if count > 0; "Add from shelf" searches the rest. Each
picked part has a quantity. Saving records "used" movements and lowers counts. A part
can be used past zero only with an explicit "use anyway" (count shows negative in red)
so a stale count never blocks logging a real service. No expense is created for used
parts. Item history shows "Parts: oil filter, 1 L Motorex 10W-50".

### Bike screen
Due/soon rows with at least one linked part get a small mark: "✓ in stock" (every linked
part count ≥ 1) or "✗ no spare" (some linked part at ≤ 0). Rows with no linked parts show
nothing. Tapping the mark opens the shelf filtered to that item's parts.

### Shopping list ("To buy")
- **Automatic**, computed (not stored): (a) a part linked to an item that is due or soon
  and has count ≤ 0; (b) a part with a minimum whose count is below it. Shows the reason
  ("Engine oil on KTM 300 due in 3 h", "keep 2, have 1") and the bike.
- **Manual**: free-text entries, optional bike, optional link to a part.
- Ticking: an automatic entry disappears when the count recovers (invoice or + button);
  a manual entry is ticked off by hand, or automatically when an invoice restocks its
  linked part. Ticked manual entries hide after 7 days.
- One list across all bikes.

## Data (new tables, all scoped by `userId`, all creates carry `clientId`)

- `parts`: id, userId, clientId, bikeId (nullable, set null on bike delete), name, unit
  (text, default 'pcs'), qtyHundredths (integer, current count ×100, may go negative),
  minHundredths (nullable), notes, timestamps. (No archive: a part is kept at 0 or deleted.)
- `part_items`: partId ↔ maintenance item link (unique pair, cascade both).
- `part_movements`: id, userId, clientId, partId (nullable, set null on part delete),
  partName + unit (snapshot, so a service still reads right after the part is renamed or
  deleted), kind
  ('bought' | 'used' | 'adjust'), qtyHundredths (signed), at (date), expenseId (nullable,
  set null), documentId (nullable, set null), serviceId (nullable, cascade — deleting the
  service deletes its 'used' movements and the count goes back up), note.
  `parts.qtyHundredths` is kept equal to the sum of movements, updated in the same
  transaction.
- `shopping_entries`: id, userId, clientId, text, bikeId (nullable), partId (nullable),
  doneAt (nullable), timestamps.
- A service's "parts used" are its 'used' movements (serviceId set); their snapshot
  columns are what the history shows.

Quantities: decimals with up to 2 places, accepting `1.5` and `1,5` (`parseDecimal`).

## Decisions taken after the builder check (my calls, not the rider's)

1. A "To the shelf" invoice line creates its expense (real spend, category as chosen)
   and a 'bought' movement, and **nothing else**: no service, no maintenance-item link,
   so no item looks done because a spare was bought.
2. Counts are never sent by the client. Every change is a movement with its own
   `clientId` (idempotent upsert); the server applies it and updates
   `parts.qtyHundredths` in the same transaction. The client updates its Dexie copy
   optimistically by the same delta. Two devices therefore never overwrite each other.
3. `POST /api/services` takes an optional `partsUsed: [{ clientId, partId, qtyHundredths }]`
   and writes the service, its movements and the count changes in one transaction.
   If a part no longer exists when a queued service replays, that line is saved with
   `partId` null and the snapshot name (no 400, the service is not lost).
4. A manual shopping entry linked to a part is ticked by any 'bought' movement on that
   part after the entry's creation; it does not reopen when the part is used again.
5. "✗ no spare" = any part linked to the item has count ≤ 0 (all-of; no alternatives in
   this version).
6. Deleting a service deletes its 'used' movements and adds their quantities back to
   parts that still exist. Deleting a part sets `partId` null on its movements and keeps
   every expense; manual shopping entries linked to it lose the link.
7. Search is client-side over the full shelf (online and offline alike), normalised
   with NFD + accent strip + lowercase; a rider has hundreds of parts at most.

## Offline

Shelf list, search, part +/−, manual shopping entries and parts used in a service work
offline and queue in the outbox like services do (`{ queue: true }`; add these routes to
the allowed set). Invoice-to-shelf needs the network (invoice confirm already does).
The shelf is cached in Dexie for offline search.

## Constraints (from CLAUDE.md, all apply)

`useApi()` only; `validate.ts` for input, bad input 400/404 and new routes added to
`tests/e2e/bad-input.spec.ts`; `owned.ts` scoping; English UI; dark tokens; 44 px tap
targets; no browser dialogs; e2e on the phone project and screenshots for new screens.

## Left to the builder

Exact layout of the shelf screen (sections vs. switch), the stock-mark glyph, how the
part sheet groups history, migration numbering, API route shapes, and how the computed
shopping list is served (one endpoint is fine).
