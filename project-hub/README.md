# Project Hub — Phase 2

Single-project expectation timeline UI.

## What's here

| File | Purpose |
|---|---|
| `index.html` | Page shell, filter bar, timeline canvas, detail card |
| `styles.css` | Dark-mode design tokens and component styles |
| `app.js` | Supabase client, state machine, timeline rendering, filters, nav |

## Running locally

Serve with any static server:

```bash
npx serve project-hub
# or
python3 -m http.server 3000 --directory project-hub
```

Then open `http://localhost:3000`.

## Required DB migration

Before manual events show their richer fields, run the migration below once
against `hhyhulqngdkwsxhymmcd`:

```sql
ALTER TABLE public.project_events
  ADD COLUMN IF NOT EXISTS is_manual   boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS author      text,
  ADD COLUMN IF NOT EXISTS summary     text,
  ADD COLUMN IF NOT EXISTS narrative   text,
  ADD COLUMN IF NOT EXISTS related_event_ids uuid[] DEFAULT '{}';

COMMENT ON COLUMN public.project_events.is_manual
  IS 'true = human-authored; false = auto-generated from monitor_events';
```

The UI **degrades gracefully** if these columns don't exist yet — automatic
events are fully functional either way.

## Visual conventions

| Event kind | Colour | Shape |
|---|---|---|
| expectation | Indigo | Circle |
| deviation   | Amber  | Circle |
| adaptation  | Emerald| Circle |
| insert      | Blue   | Circle |
| update      | Violet | Circle |
| delete      | Red    | Circle |

**Manual events** render as **squares** positioned above the axis line.
**Automatic events** render as **circles** sitting on the axis line.

## Filter state

- All event kinds are on by default; click to toggle each off/on.
- Both Automatic and Manual sources are on by default.
- Filters are AND-ed (kind ∩ source).

## Navigation

Selecting any dot opens the detail card below. Navigate with:
- **← Prev / Next →** buttons
- **Dropdown** listing all visible events by timestamp + kind + summary
