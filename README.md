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

Open `index.html` straight off a disk and the app loads sample data instead
of calling the API, so the whole thing can be clicked through with no backend.
Sign in as any name; the access code is that name in lower case. Served over
http or https it never does this unless `?demo` is on the address.

The sample lives in `assets/js/demo.js`. Deleting that file and its
`<script>` tag in `index.html` removes the feature entirely.

## Sign-in

Access codes are checked in the browser against the `pin` field on each user,
which means **anyone who can load the page can read them**. That is fine
behind a login on the main site or on an internal network; it is not a
security boundary on the open internet. Moving the check behind the API is
the fix when that matters.
