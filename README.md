# Robobox Connect — handover notes

Static front end. No build step, no framework, no npm install: plain HTML,
CSS and JavaScript loaded with `<script>` tags. Whatever serves the files is
all it needs.

## Deploying

Copy the contents of this folder — `index.html`, `assets/`, `robots.txt` — to
the web root. Every path inside the page is relative, so it works at a domain
root or under a sub-path equally.

Nginx, as a sub-path on the existing site:

```nginx
location /connect/ {
    alias /var/www/connect/;
    try_files $uri $uri/ /connect/index.html;
}
```

Serve it from the **same origin as the API** if at all possible. Then nothing
needs CORS. If it has to live on another host, that host must be allowed by
`Access-Control-Allow-Origin` on `/api/`, including the `OPTIONS` preflight.

`tools/` is a test script for the sales targets, run with `node
tools/test_targets.js`. It is not part of the site and does not need to be
deployed.

## What the API has to provide

The base URL is set at the top of `assets/js/store.js`:

```js
var API_BASE = 'https://api2.therobobox.co';
```

**`GET /api/state`** returns the whole dataset as one JSON object:

```json
{ "version": 2, "meta": {}, "users": [], "schools": [], "contacts": [],
  "opportunities": [], "connects": [] }
```

`version` must be `2`, and `users` must not be empty — nobody can sign in
otherwise, and the app now says so rather than showing an empty list.

**`POST /api/sync`** takes `{ "change": { ... } }` and persists it. The
`type` field says what changed: `user`, `user_delete`, `school_add`,
`contact_add`, `opportunity_add`, `connect`. A `connect` change carries both
the connect and the opportunity it moved, and both must be written.

### Columns this version adds

If the sync endpoint writes a fixed list of columns, three fields need adding
or the data will be accepted and silently dropped:

| Table | Field | Type | What it is |
|---|---|---|---|
| `opportunities` | `salesYear` | text, e.g. `26-27` | Which financial year the sale lands in |
| `connects` | `salesYear` | text | Same, as captured on the connect |
| `connects` | `kitBands` | JSON / text | Student counts per standard band on a kit deal |

`opportunities.renamedFrom` may also arrive on deals created before the
products were renamed. Storing it is optional; ignoring it is safe.

## Products

The product list, prices and per-person targets live in
`assets/js/model.js` — `CATALOGUE`, `KIT_BANDS` and `TARGETS`. Prices can
also be edited in the app under Settings, by the CEO, which overrides the
catalogue and is stored with the rest of the state.

Two things are applied to existing data as it loads, in `store.js`, and
neither rewrites anything on the server:

- `OFFERING_ALIAS` maps the old product names to the new ones. STEM Lab,
  Advanced Lab and Kit Class read as their new names everywhere.
- `OFFERING_RETIRED` lists products that are gone. Advanced Lab Pro deals,
  and the connects logged against them, are dropped on load and counted
  nowhere. **The rows are still in the database.** Delete them there if they
  are not wanted at all.

## Checking a build without the server

`assets/js/demo.js` holds a sample dataset that lets the whole app run with
no backend. It is not loaded by `index.html` in this build. To use it while
checking a build, add this line just before the `app.js` script tag and
open `index.html` straight off a disk (or add `?demo` to the address):

```html
<script src="assets/js/demo.js"></script>
```

Take the line out again before deploying.

## Design

`assets/css/app.css` is one design system, mobile first. Colour tokens and the
brand palette are at the top; nothing else in the file defines a colour of
its own.

On a phone (980px and narrower) the app runs as an app:

- an app bar with the brand, search and the theme switch;
- a bottom tab bar (rendered by `tabbar()` in `app.js`): a floating pill of
  frosted glass with the three places each role uses most, Log Connect in
  the middle, and More, which opens the full menu as a sheet. A capsule
  slides to the current tab; the bar settles into a smaller pill while
  scrolling down and steps aside while the keyboard is up;
- every dialog is a bottom sheet; sheets can be pulled down to close
  (`UI.dragToDismiss` in `ui.js`);
- every table turns into a stack of cards. `ui.js` captions each cell from
  its table's header row automatically, so a new table needs no extra work.

Sizes step with the screen, not one breakpoint: tested on a 280px fold
cover screen, 320-360px Android and iPhone SE, 390-430px flagships, 480px
large phones, a 712px tablet, and phones in landscape. Where a browser cannot
blur, frosted surfaces fall back to solid; where it has no `dvh` or
`color-mix()`, the rules fall back to `vh` and solid colours.
`interactive-widget=resizes-content` in the viewport tag keeps a sheet's
button above the Android keyboard.

Icons are inline SVG from `UI.icon(name)` in `ui.js`. Headings and large
numbers use Bricolage Grotesque, loaded with Inter from Google Fonts.

Motion: dialogs and toasts play a short exit before hiding, and a page
change plays an entrance (`RB.app.go()` marks it), but a save or a filter
does not. All motion is skipped when the system asks for reduced motion.

## Needs attention

`M.needsAttention()` tags each item with the rule that caught it (`kind`:
stuck, overdue, no-next, date-passed, quiet). `ceo.js` shows them as cards
with a breakdown by kind: a grid on Business, a sideways rail on Sales,
Market and Win. A card opens the school; See all opens the full list.

## Upload updated data (Settings)

The one data button besides Download backup. It takes an update file
(`kind: "robobox-updated-data"`) prepared from a backup: records to put back
and records to change, each by id (`assets/js/data-update.js` documents the
format). It previews, saves a full backup to the computer, re-links one
connect as a trial and stops if the server did not update it in place, then
sends the rest through `POST /api/sync` (`user`, `opportunity_add`,
`connect`) and reads everything back. It never deletes. The old Excel import
(`/api/import/business-export`, with its "delete what is not in the file"
option) is no longer called: on 18 Nov it deleted 229 deals and 59 connects.

## Imported deals

Rows from the old sheet arrive without a stage, often without a next-action
date, and sometimes without an owner. `model.js` reads them so they still
count everywhere, without changing the stored records:

- A connect with no `stage` takes one from its response and mode, using the
  same rule that pre-selects the connect form (`connectStage`). It never
  infers Won, Lost or On Hold. A stage a rep chose always wins.
- A deal with no `ownerKey` on it or its school belongs to whoever logged its
  first connect (`loggedBy`).
- Owners whose person was removed from Settings (e.g. `VIKAS`) still show on
  the command centre; add the person back, with the same owner key, to put
  those deals in someone's day.

`node tools/test_imported.js` checks both rules.

## Robobox Caller and Leads

The Robobox Caller (role `caller`) calls new schools only. Her call creates
the school, the contact, and an opportunity with `status: "Lead"` that holds
her calls. `store.js` keeps leads apart from deals, so no deal figure counts
one. Its state is its latest call: Rejected; To confirm in a few days (a
callback, on her own list); anything else goes to the region's salespeople
(`M.LEAD_ROUTE`, matched on first name). Leads, tasks and calendars show it
to all of them; the first to take it gets a New School Connect pre-filled on
the same school, and saving turns the lead into their deal (status `Open`,
owner set), with her calls already on it. The caller sees only My day (her
call-backs), Connects (her calls), the Sales calendar (what the people her
leads go to have booked), My score (conversions) and Settings. The sales team
and the head of sales see none of her work beyond the leads sent to them;
the CEO sees all of it. Sales can no longer pick Call on a
New School Connect. The server's `opportunities.status` must accept `"Lead"`
and `users.role` must accept `"caller"`.

## Dropped deals

A deal with `status: "Dropped"` was never real business. `store.js` leaves it
out as the data loads, and its connects become connects on the school
(`opportunityId` set to null in memory only). The school, its timeline and
every activity count keep them; no pipeline, value, stage or task does. The
server keeps the record as it is, so changing the status back restores the
deal. The server's `opportunities.status` must accept `"Dropped"`.

## Sign-in

Access codes are checked in the browser against the `pin` field on each user,
which means **anyone who can load the page can read them**. That is fine
behind a login on the main site or on an internal network; it is not a
security boundary on the open internet. Moving the check behind the API is
the fix when that matters.
