# Meters per bike: hours, km, or both (street bikes)

Status: approved in conversation 2026-11-09. Changes `2026-11-08-enduro-tracker-design.md`
(which assumed every bike has an hour meter and an odometer). Ships before voice
(`2026-11-09-voice-design.md`), so voice is built on it.

## Why

Not every bike counts hours. The rider wants the app useful for street bikes too
(commuter, scooter — the kind doesn't matter): those only have an odometer. Today
adding a bike demands current hours, every ride log demands hours and km, and the
starting maintenance list is enduro-only and mostly in hours.

## Goals

1. Each bike chooses what it counts: **hours and km** (enduro), **km only** (street),
   or **hours only** (motocross bike with no odometer). Chosen when adding the bike,
   changeable later in the bike's settings.
2. Every screen asks for and shows only the bike's counted meters.
3. Street bikes (km only) get their own starting list, in km and months.
4. Existing bikes keep hours and km; nothing changes for them.

## Non-goals

- No conversions between hours and km, no guessing hours from km.
- No new bike types beyond the three meter choices (no "scooter" vs "touring" kinds).
- No riding-condition multipliers for km-only bikes.

## Anti-goals

- A km-only bike showing "0.0 h", an hours field, or an hours interval anywhere.
- An existing enduro bike losing data or changing behaviour.
- Switching a bike's meters destroying its history (hidden is fine, deleted is not).

## What the rider sees

- **Add bike**: a choice "Counts: Hours & km / Km only / Hours only" (default
  Hours & km) next to the 2T/4T choice. The current-meter fields shown follow it. The
  starting list follows it and reloads on change, exactly as changing 2T/4T does today
  (see Templates). Interval and last-done fields only
  show the counted units (months always).
- **Log ride**: only the counted meters. The riding-condition picker (mud, sand, dust,
  race) only shows when the bike counts hours (conditions only weigh hours).
- **Mark done, item edit, item detail, history, invoice review**: only counted meters.
- **Bike screen and home card**: latest reading shows only counted meters
  ("3 812 km" for a street bike).
- **Costs**: per-bike line shows "€/h" for bikes that count hours and "€/km" for
  km-only bikes, by current meters. The hours KPI sums only bikes currently counting
  hours; a km KPI sums only bikes currently counting km; a KPI with no such bike is hidden.
- **Bike settings**: the same "Counts" choice (online only, not queued; allowed with
  no readings). Switching off a meter hides it and its
  intervals (kept in the database, shown again if switched back). Switching on a
  meter: the next ride log asks for it; until a reading has it, items timed on it
  show as unknown for that unit (months still work).
- **Toasts and outbox errors** mention only counted meters.

## Data

- `bikes.meters`: text enum `'hours_km' | 'km' | 'hours'`, not null, default
  `'hours_km'` (migration sets every existing bike to it).
- `meter_readings.hours_tenths` and `meter_readings.km` become nullable. A new reading
  must carry every counted meter (missing → 400) and stores null for an uncounted one.
- **One rule for uncounted values on writes: ignored, never a 400** (readings, services,
  set-up last-done, item intervals, invoice-created services). Ignored reading/service
  meters are stored null; an ignored interval leaves the stored interval unchanged.
  This keeps queued offline writes from stalling after a meters switch.
- Services and mark-done keep today's rule: their meters are optional.
- **Switching never rewrites stored data.** Status, costs and every screen read only
  the bike's *current* counted units; old values in a switched-off unit stay in the
  database and count again if the unit is switched back on.
- A queued reading is validated against the bike's meters at replay; if it lacks a
  newly counted meter it fails like any other outbox 400 (reason shown, Retry/Discard).
- Status (`computeStatus`) only computes units the bike counts, skips readings with a null value for the unit it is
  computing; sorting falls back to date only when hours are null.

## Templates

`/api/templates/:stroke` gains `?meters=`. `hours_km` and `hours` keep today's lists
(`hours`: items with only a km interval are dropped, except "Chain & sprockets",
which becomes every 30 h; km parts of mixed intervals are dropped). `km` gets a
street list (my call, the rider edits it at set-up anyway):

- 4T: Engine oil + filter 6 000 km / 12 months; Air filter 12 000 km; Spark plug
  12 000 km; Valve clearance check 24 000 km; Chain & sprockets 20 000 km; Chain clean
  & lube 1 000 km; Tyres 10 000 km; Brake pads check 6 000 km / 12 months; Brake fluid
  24 months; Coolant 24 months.
- 2T: same without engine oil + filter and valve clearance; Gearbox oil 10 000 km /
  24 months; Spark plug 6 000 km.

## Decisions taken (my calls, not the rider's)

1. A bike-level enum, not per-reading flags, so every screen decides from one field.
2. Nullable reading columns rather than storing 0 for an uncounted meter, so no fake
   zeros reach costs or status.
3. Uncounted intervals are kept, not deleted, so switching meters back is lossless.
4. "€/km" rather than "€/100 km" (matches the money formatter; small numbers read fine).
5. Voice (later) uses the bike's `meters` in its tools and proposals: a log-ride card
   for a km-only bike has no hours field, and the prompt is told which meters each
   bike counts.

## Constraints (from CLAUDE.md, all apply)

`useApi()` only; `validate.ts`; bad-input cases for the new field and the new 400s in
`tests/e2e/bad-input.spec.ts`; `owned.ts`; offline outbox keeps working (queued readings
for a km-only bike carry no hours); English UI; dark tokens; 44 px tap targets; e2e on
the phone project with a km-only bike flow (add bike, log ride, mark done, costs),
screenshots for add-bike with "Km only" and a street bike screen.

## Left to the builder

Exact control for "Counts", migration number, how the formatter helper for
"counted meters" is shaped, and test layout.
