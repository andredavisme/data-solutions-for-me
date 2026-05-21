# Project Hub — Phase 3

Single-project expectation timeline UI with live Supabase Realtime updates and a **passphrase-gated write layer**.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: auth gate overlay, sticky header (with Lock button), filter bar, timeline canvas, detail card, annotation/edit drawers |
| `styles.css` | Dark-mode design tokens, component styles, dev/test visual treatment, auth gate overlay styles |
| `app.js` | Auth gate logic (token storage, JWT expiry check, login flow, sign-out), Supabase client factory, state machine, realtime subscription, timeline renderer, filters, nav, annotate/edit/delete flows |

## Running locally

```bash
npx serve project-hub
# or
python3 -m http.server 3000 --directory project-hub
```

Open `http://localhost:3000`. The page shows the passphrase gate first. On success it stores the JWT in `localStorage` and initialises the timeline.

## Auth flow

1. On load, `getStoredToken()` reads `hub_auth_token` from `localStorage` and checks the `exp` field.
2. If valid → `showApp()` + `init()` immediately (no gate shown).
3. If missing/expired → `showGate()` renders the full-screen overlay.
4. On submit, `attemptLogin(passphrase)` POSTs to the `verify-passphrase` Edge Function.
5. On success the returned JWT is stored and injected as `x-hub-token` on every Supabase request.
6. The 🔒 Lock button clears the token and returns to the gate.

## Edge Function: `verify-passphrase`

Expected contract:

```
POST /functions/v1/verify-passphrase
Content-Type: application/json
{ "passphrase": "<user input>" }

→ 200  { "token": "<signed JWT>" }
→ 401  { "error": "Incorrect passphrase" }
```

The function should sign a short-lived JWT (e.g. 8h) with a secret stored in Supabase Vault. RLS policies or function middleware can then verify `x-hub-token` on write operations.

## DB migration status

✅ **Already applied** to `hhyhulqngdkwsxhymmcd` as migration `project_events_phase2_realtime`.

## Annotate flow

Automatic events expose an **Annotate this event** button in the detail card.

- Opens an inline drawer; submit creates a new `project_events` row with `is_manual = true` and `related_event_ids = [sourceEvent.id]`.
- Realtime insert auto-selects the new annotation after confirmation.

## Edit / Delete flow

Manual events expose an **✏ Edit annotation** button.

- Opens an edit drawer pre-populated with current values.
- **Delete** opens a confirm `<dialog>` before executing the delete.

## Seed data

3 dev-context events were inserted on the first `skunkworks_projects` row to verify timeline rendering.
