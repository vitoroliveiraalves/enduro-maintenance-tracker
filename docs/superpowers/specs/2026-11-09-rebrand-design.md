# Rebrand — Stamped Steel, with an old-school tricolor option

Approved designs: canvas "Enduro Tracker rebrand", direction **B — Stamped Steel** (B-Garage, B-Bike)
and **B × Old-school tricolor** (D-Garage, D-Bike). The rider picks one in Settings.

## Look (both themes)
- Dark ground, square corners (2 px radius; round things stay round), heavy wide uppercase headings
  (Archivo, width 125 %, weight 900), IBM Plex Mono for numbers and small labels. Fonts are
  self-hosted (the app works offline; no Google Fonts requests).
- Line icons instead of emoji (tabs, 🧾, 🔊, 🎤).
- Bottom tabs: icon over a mono label; Garage tab first.
- Status by theme tokens; every screen keeps its token classes (`bg-accent`, `text-danger`, …), so all
  screens follow the theme without per-screen work. Text on an accent/danger/warn fill uses new
  `on-accent`/`on-danger`/`on-warn` tokens.

## Stamped Steel (default) — black and white
ground #0E0E0E, surface #1A1A1A, track #3A3A3A, text #EDEDED, muted #A3A3A3. Accent = white (black text
on it). Status by brightness: overdue = white (overdue rows get the hazard stripe), soon = light grey,
ok = dark grey. Errors use the danger token (white), always with words.

## Old-school tricolor
ground #0F1012, surface #1B1C1F, text #F4F1EA (warm white), muted #A9A69F. Accent = red #D21F2A (white
text), blue #1F3FA8 for "soon" fills and stripes (light blue #8FA6FF for "soon" text on dark), overdue =
red. Slanted (italic) headings, the red/white/blue band under the header, a red top bar on the active tab.

## Calls (mine)
- The choice is per device (localStorage), applied before first paint from a client plugin; default
  Stamped Steel. Not synced to the account.
- Garage cards: a bike with something overdue gets the inverted "tag" card (white card, dark text);
  others are outlined. The number-plate badge and the slanted side stripe appear in tricolor only.
- Other screens are not redrawn; they follow the tokens, fonts, radii and icons.
