# Travel Board

Plan a trip with sticky notes inside sticky notes, from packing the bag to the last meal.
Works offline on an iPad once installed. No account, no server, no build step.

## The idea

Everything is a **note**, and any note can hold more notes. A trip, a flight, a suitcase,
a taxi, a hotel and a restaurant are all the same building block. Anything not known yet is
a dashed **placeholder** that turns solid once it is settled or booked.

## Run it

You need only a static file server. From this folder:

    python3 -m http.server 8080

Open http://localhost:8080 in a browser.

## Install on an iPad (works offline)

Service workers (the part that makes offline work) only run over HTTPS or on localhost, so the
folder must be hosted somewhere first. Any free static host works (GitHub Pages, Netlify,
Cloudflare Pages). Then on the iPad:

1. Open the site in Safari once while online.
2. Share button, then Add to Home Screen.
3. Open it from the Home Screen icon. From now on it loads with no connection.

## Tests

    node test.js        # the note model (20 checks)
    node test-ui.js     # smoke test of the screens using a fake DOM (9 steps)

No packages to install. Node 18 or newer.

## Files

| File | Job |
| --- | --- |
| model.js | All the logic: kinds, notes, journeys, nights, clashes, save and load. No browser code. |
| app.js | Screens and storage. Builds the page with safe DOM calls (never innerHTML). |
| index.html | The page shell and iPad install tags. |
| styles.css | Layout and the colour for each kind. |
| sw.js | Caches the app files so it opens offline. Bump CACHE_VERSION when any file changes. |
| manifest.webmanifest | Name, colours and icons for Add to Home Screen. |
| icons/ | App icons (180, 192, 512 px). make_icons.py regenerates them (needs Pillow). |
| test.js, test-ui.js | Tests. |

## Storage

The trip is saved as one JSON document in the browser's localStorage under the key
`travelboard.v1`. The Backup button shows that JSON so it can be copied somewhere safe and
restored later. If the trip ever outgrows localStorage, move storage to IndexedDB inside
`loadState` and `saveState` in app.js; the model does not need to change.

## Rules that must not be broken

- Never invent trip details. Real values come only from the person (or later, a confirmed booking).
- Any field may be blank. Only `id` and `kind` are required.
- Kinds are data in model.js (`KINDS`). New kinds are added there, not coded into the screens.
- Moving a note changes its position only. Dates are never recalculated.
- Nights are always calculated from the two dates, never typed.
- Keep it dependency-free and working on iPad Safari 15 or newer.
