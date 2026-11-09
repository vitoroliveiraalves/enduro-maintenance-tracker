# Voice: talk to the app to update records and ask questions

Status: approved in conversation 2026-11-09. Builds on `2026-11-08-enduro-tracker-design.md`
and `2026-11-09-shelf-design.md` (voice can use and stock shelf parts).

## Why

In the garage the rider's hands are dirty. They want to say "did the oil and filter on
the 300 at 143 h, used one filter" or ask "do I have a gasket?" / "has the oil done 20 h?"
inside the app itself, not in a separate assistant. An MCP server for outside assistants
was discussed and set aside: in-app voice needs no MCP; an MCP can be added later.

## Goals

1. **Mic button** reachable on the main screens; hold to talk (release sends) or tap to
   start / tap to stop.
2. **Updates by voice** become proposed changes the rider confirms on a review screen.
3. **Questions by voice** get a short answer from the rider's own data, with its source,
   shown as text and optionally read aloud by the phone.
4. Portuguese and English (and a mix) understood; answers in the language spoken.

## Non-goals

- No MCP server / outside assistants in this version.
- No always-listening or wake word.
- No free chat about things outside the rider's data (riding tips, general mechanics).
- No voice for invoice capture (camera already covers it), account or settings changes,
  deletions, or bike create/delete.

## Anti-goals

- Anything saved without the rider tapping Save (same rule as invoices).
- An answer that invents a number, date or count not in the rider's data. If the data
  doesn't hold it: "I don't know from your records" plus what is known.
- A guessed bike or item when the note is ambiguous: the card asks the rider to pick.
- One rider's data reaching another rider's answer (every lookup goes through `owned.ts`).
- A runaway AI bill.

## What the rider sees

### Mic
A round mic button above the bottom tabs on Bike, History, Costs, Garage and Shelf (not on
login/register, invoice capture, or while a sheet is open). Recording shows a level meter,
elapsed time and Cancel; max 60 s. First use asks for microphone permission through the
browser's own prompt; denied → calm text explaining how to allow it. `Permissions-Policy`
in nuxt.config must allow `microphone=(self)`.

### Voice sheet
After release: "Listening…" then the transcript (editable text field, so a misheard word
can be fixed and re-sent) and the result:

- **Updates** → one card per proposed change. Kinds: log ride / meters; mark maintenance
  done (items, date default today, hours/km, DIY/garage, notes, parts used from the shelf);
  use part from shelf; add part to shelf (by hand, no invoice); add shopping entry; add
  expense (amount, category, bike, description); add reminder (title, date, repeat yearly).
  Each card is editable with the same fields and validation as its normal sheet, and has
  remove (×). Ambiguity (two bikes match, unknown item) shows a picker on the card, never
  a guess. **Save** writes all remaining cards; each goes through the existing API routes
  (queued offline where those routes already queue), so voice adds no new write paths.
- **Question** → an answer card: one or two sentences, plus "From your records" lines
  naming the facts used (e.g. "Engine oil · last done 13 Sep at 122.5 h · now 143.0 h").
  A speaker button reads it with the browser's `speechSynthesis` (no cost, no server).
  The mic stays open for a follow-up ("and the filter?"): the previous question and answer
  are sent along (last 3 turns, this sheet only, not stored).
- A note that mixes both gets both.

### Offline
No network: the recording is kept on the device (IndexedDB) and shown as "1 voice note
waiting"; it is processed when back online and the review sheet opens then (or from the
pending list). Questions can't be answered offline: "Needs a connection — I'll keep it and
answer when you're back online" (same queue).

## How it works (server)

- `POST /api/voice` (multipart: audio, optional history, optional corrected transcript)
  → `{ transcript, answer?, sources?, proposals[] }`. Never writes data.
- OpenRouter, two steps (see decision 1), the second using **tool calling**: read-only lookup tools (bike list + meters; item status with
  last-done and since-values; service history for an item; shelf search; shopping list;
  costs total for a period/category/bike; reminders) executed server-side scoped to the
  user, and one `propose_changes` tool whose arguments are validated with the same
  `validate.ts` rules as the real routes (invalid proposals are dropped with a note, not
  saved). Bounded: at most 6 tool rounds, then answer with what's known.
- Answers must cite tool results; the prompt forbids numbers not returned by a tool, and
  the server checks every number in `sources` came from a tool result.
- Audio is not stored after the request. Transcript is not stored.
- Limits: `NUXT_VOICE_DAILY_CAP` per user (default 60) → 429 "Daily voice limit reached —
  you can still use the app as usual."; a global daily cap like invoices
  (`NUXT_VOICE_GLOBAL_DAILY_CAP`, default 600); 20 notes/user/10 min.
  Audio ≤ 60 s (WAV, see decision 5).
- No OpenRouter key → mic hidden; Settings says voice isn't set up on this server.

**Spike (first voice task):** a script the rider runs with their own key checks that the
default model transcribes a WAV clip and makes tool calls through OpenRouter; the result
is written into the plan. If it fails, set `NUXT_VOICE_MODEL` to a model that passes.

## Decisions taken after the builder check (my calls, not the rider's)

1. **Two steps per note**: (a) transcribe the audio, (b) a text-only tool-calling call on
   the transcript. A corrected transcript skips (a). Optional `NUXT_VOICE_MODEL` for (a)
   and (b), defaulting to `NUXT_OPENROUTER_MODEL`. The spike checks the default model does
   audio in and tool calling; if not, it records which model to use as the default.
2. **Sources are structured, rendered by our code**: the model returns
   `sources: [{ tool, ref }]` pointing at tool results; the server keeps only refs that
   exist in this request's tool results and the UI formats them with `useFormatters()`.
   The prose answer is not number-checked; the prompt forbids numbers not from a tool,
   and the sources are shown under every answer so the rider can see the facts. (Cost if
   wrong: a wrong number in prose next to correct sources.)
3. **Proposals carry ids from lookup tools**, never names. When unsure, a field may carry
   `candidates: [id, …]` instead of one id; the server checks every id is owned by the
   user (drops unknown ones) and the card shows a picker over the candidates, or over all
   bikes/items when none are left.
4. **What counts as a use**: every request that reaches the model counts once (including
   a corrected-transcript resend); requests rejected before the model (bad audio, auth,
   size) don't. Voice caps are separate counters from the invoice caps.
5. **Recording format and size**: the client records PCM through Web Audio and encodes
   **WAV, 16 kHz mono, 16-bit** itself (same on iOS and Android; WAV is accepted as
   OpenRouter `input_audio` by the default model), so no MediaRecorder formats and no
   server conversion. 60 s ≈ 1.9 MB; the server refuses > 2.5 MB or > 62 s with a 400.
   Queued notes that fail on reconnect stay in the waiting list with the reason, Retry
   and Discard (like the outbox). A processed queued note shows "Voice note ready" in the
   pending badge; the review sheet opens only when the rider taps it.
6. **Saving cards**: the client gives each card a `clientId` when it builds it; Save
   writes cards one by one through `useApi().mutate` (queued where the route allows).
   Each card shows saved / failed; failed cards stay for Retry, and a retry is safe
   because creates upsert on `clientId`.
7. **Order**: the shelf ships first; the voice tasks come after it, so shelf kinds are
   available to voice from the start.

## Privacy

Register-page privacy note becomes: "Your bikes, costs and invoice photos are stored on
our server. Invoice photos and voice notes are sent to an AI service (via OpenRouter) to
read them; voice notes aren't kept." Settings repeats it next to the voice setting.

## Constraints (from CLAUDE.md, all apply)

`useApi()` only; `validate.ts`; new routes in `tests/e2e/bad-input.spec.ts`; `owned.ts`;
English UI; dark tokens; 44 px tap targets; no browser dialogs; `.env.example` lists the
new variables; e2e on the phone project with a mock voice reader (like
`NUXT_INVOICE_READER=mock`), screenshots for the mic, the review sheet and an answer.

## Left to the builder

Mic button placement details, recording UI, prompt wording, the exact tool schemas, how
proposals map onto existing sheets' components, and the offline voice-queue storage shape.
