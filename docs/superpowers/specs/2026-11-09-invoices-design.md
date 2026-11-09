# Saved invoices — design

## Why
A saved invoice can't be found again: the only way in is the 🧾 on a service in an item's history.
The rider wants to see their invoices and fix them, because the AI sometimes reads a line wrong
and invoices sometimes get saved to the wrong bike. They also want to delete one together with
everything it created.

## Goals
1. **A list of invoices** on the 📷 Invoice tab, below the capture buttons. Newest first. Each row
   shows the shop (or "Invoice"), the date, the total and the bike. Invoices that aren't saved yet
   (`review`/`manual`) sit at the top marked "Not saved yet", so a half-done one is never lost.
   `reading` ones show "Reading…".
2. **Open any invoice** from that list, from the 🧾 on Costs and on History (it becomes a link), and,
   as today, from an item's service history.
3. **Change a saved invoice.** The saved invoice page gets a **Change** button. It turns the page into
   the review form you already know, filled with what is saved now: bike, date, shop, NIF/number
   (when there's no QR), hours/km of its service, and each line (description, amount, category,
   items it reset, or "To the shelf" with the same part and quantity). The rider fixes what's
   wrong, possibly picks another bike, and taps Save. Cancel goes back to the saved view with no
   changes.
4. **Delete a saved invoice** with everything it created. An in-app confirm (no browser dialog)
   lists what goes: "N costs · the garage service · shelf stock".

## How saving a change works (decided)
- It's **one atomic replace** on the server: in one transaction, undo everything the invoice
  created and then save the corrected version through the same code as the first save (same
  validation, same totals check with "Save anyway"). If anything fails, nothing changes. Leaving
  the form without saving leaves the invoice exactly as it was (no "reopened" state on the
  server).
- **What "everything it created" means**: the expenses with this `documentId` (their item links go
  with them), the service with this `documentId` (its item links go with it, so the bike's item
  status works itself out again), and the shelf movements with this `documentId` (the part's count
  is lowered by what was bought).
- Costs the rider edited one by one on the Costs screen after saving are what the form is
  filled with, so those edits are kept.
- Shelf parts: on Change, an existing part keeps its id, and the line points at it again. On Delete,
  a part the invoice created is removed only if its only movements were this invoice's.
  Otherwise it stays with its count lowered.
- **Stock already used**: if undoing would take a part below zero (bought 2, used 1, now
  changed to 0 or deleted), it's allowed. The confirm shows a warning first: "Gasket will
  go to −1 on the shelf."
- The photo and the QR fields are never touched by Change. The QR total stays the totals check.
  Delete removes the photo too.

## Server (the builder's shape, names may vary)
- `GET /api/documents`: the rider's invoices for the list (id, status, supplierName, issuedAt,
  total = sum of its expenses when saved, else `totalCents`, bikeId/bikeName, line count). Scoped by
  userId.
- `GET /api/documents/:id`: `saved` gains what the form needs (categoryId, itemIds, shelf
  partId/qty/name/unit per line, plus the service's hours/km), and the shelf warnings.
- `POST /api/documents/:id/confirm` with the document already confirmed and `replace: true` → the
  atomic replace. Without `replace` it stays the 409 "already saved" it is today (lost-answer
  retries).
- `DELETE /api/documents/:id`: deletes any status (unconfirmed = today's discard; confirmed =
  undo everything, then delete).
- Bad input → 400, bad id → 404, every new route added to `tests/e2e/bad-input.spec.ts`.

## Non-goals
- No editing of a single line in place on the saved view (Change → review form covers it).
- No re-reading a saved invoice with the AI.
- No offline queueing for Change or Delete. They're online-only like confirm, with the usual
  "you're offline" message.
- No search or filters on the list.

## Anti-goals
- A Change that half-applies, or that leaves costs missing after an abandoned edit.
- Duplicated costs after a Change.
- Touching anything that wasn't created by this invoice.

## Left to the builder
Exact layout of the list rows, the copy of the confirm sheet, how the Costs/History 🧾 links look,
the screenshot set (list, saved view with Change/Delete, delete confirm).
