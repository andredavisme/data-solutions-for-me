# Project Hub — Phase 2

Single-project expectation timeline UI with live Supabase Realtime updates.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: sticky header, filter bar (3 groups), timeline canvas, detail card, annotation drawer |
| `styles.css` | Dark-mode design tokens, component styles, dev/test visual treatment |
| `app.js` | Supabase client, state machine, realtime subscription, timeline renderer, filters, nav, annotate flow |

## Running locally

```bash
npx serve project-hub
# or
python3 -m http.server 3000 --directory project-hub
```

Open `http://localhost:3000`. The page connects directly to the Supabase project and opens a realtime channel on load.

## DB migration status

✅ **Already applied** to `hhyhulqngdkwsxhymmcd` as migration `project_events_phase2_realtime`.

## Annotate flow

Automatic events now expose an **Annotate this event** button in the detail card.

- The button appears only when `is_manual = false`.
- Clicking it opens an inline drawer below the detail card body.
- Submit creates a new `project_events` row with:
  - `is_manual = true`
  - `related_event_ids = [sourceEvent.id]`
  - `project_id` copied from the selected automatic event
  - `source_type`, `source_record_id`, and `monitor_event_id` copied forward from the source event
  - `summary`, `narrative`, `author`, `event_kind`, and `context` from the form
- The insert uses `supabase.from('project_events').insert(...).select().single()` and then waits for the realtime insert to auto-select the new annotation.

## Seed data

3 dev-context events were inserted on the first `skunkworks_projects` row to verify timeline rendering.
