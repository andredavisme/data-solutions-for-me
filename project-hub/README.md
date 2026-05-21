# Project Hub — Phase 2

Single-project expectation timeline UI with live Supabase Realtime updates.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: sticky header, filter bar (3 groups), timeline canvas, detail card |
| `styles.css` | Dark-mode design tokens, component styles, dev/test visual treatment |
| `app.js` | Supabase client, state machine, realtime subscription, timeline renderer, filters, nav |

## Running locally

```bash
npx serve project-hub
# or
python3 -m http.server 3000 --directory project-hub
```

Open `http://localhost:3000`. The page connects directly to the Supabase project and opens a realtime channel on load.

## DB migration status

✅ **Already applied** to `hhyhulqngdkwsxhymmcd` as migration `project_events_phase2_realtime`.

Columns added to `public.project_events`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `is_manual` | `boolean` | `false` | `true` = human-authored |
| `author` | `text` | `null` | Author name for manual events |
| `summary` | `text` | `null` | Short label on timeline dropdown and detail card |
| `narrative` | `text` | `null` | Full body shown in detail card |
| `related_event_ids` | `uuid[]` | `{}` | Links to automatic events this manual event annotates |
| `context` | `text` | `'production'` | `production` \| `development` \| `test` |

Realtime publication: `supabase_realtime` now includes `project_events`.

## Seed data

3 dev-context events were inserted on the first `skunkworks_projects` row to verify timeline rendering:

| Summary | Kind | is_manual | context |
|---|---|---|---|
| Phase 2 UI scaffolded | insert | false | development |
| Realtime subscription wired | expectation | false | development |
| Filter bar — all 8 toggles verified | adaptation | true | development |

Toggle the **Dev** context filter off to see what the timeline looks like with production-only events.

## Visual conventions

### Event kind → colour

| Kind | Colour |
|---|---|
| expectation | Indigo `#6366f1` |
| deviation | Amber `#f59e0b` |
| adaptation | Emerald `#10b981` |
| insert | Blue `#3b82f6` |
| update | Violet `#a78bfa` |
| delete | Red `#ef4444` |

### Source → shape & position

| Source | Shape | Axis position |
|---|---|---|
| Automatic | Circle | Sits on the axis line |
| Manual | Square (rounded corners) | Floats above the axis line |

### Context → outline style

| Context | Dot outline | Connector | Label above dot |
|---|---|---|---|
| production | none | solid | none |
| development | amber dashed | dashed | `dev` (amber) |
| test | emerald dashed | dashed | `test` (emerald) |

## Realtime

- Opens a filtered Postgres channel on `project_events` scoped to `project_id=eq.{activeProjectId}`.
- Handles `INSERT` (merges chronologically, preserves `selectedIndex`), `UPDATE` (patches in place), `DELETE` (removes and clamps selection).
- **Live badge** in the header: `● Connecting → ● Live → ● Error`.
- **Flash effect**: timeline border pulses green for 600 ms on each incoming INSERT.
- Channel is torn down and rebuilt when the project picker changes.

## Filters

Three independent filter groups, all AND-ed:

| Group | Buttons | Default |
|---|---|---|
| Kind | expectation · deviation · adaptation · insert · update · delete | all on |
| Source | ⚙ Automatic · ✏ Manual | all on |
| Context | 🟢 Production · 🛠 Dev · 🧪 Test | all on |

Click any button to toggle it. The timeline and detail dropdown re-render immediately.

## Navigation

Click any dot on the timeline to open the detail card.

- **← Prev / Next →** buttons step through visible events.
- **Dropdown** lists every visible event by timestamp + kind + context tag + summary.
- Keyboard: `Enter` or `Space` on a focused dot selects it.

## Detail card fields

| Field | Source |
|---|---|
| Kind badge | `event_kind` |
| Source badge | `is_manual` (⚙ Automatic / ✏ Manual) |
| Context badge | `context` — shown only for dev/test |
| Timestamp | `created_at` |
| Summary | `summary` → falls back to `event_kind + source_type` |
| Author | `author` (meta row) |
| Table | `source_type` (meta row) |
| Status | `status` (meta row) |
| Body | `narrative` → falls back to `notes` |
| Raw payload | `payload` (collapsible JSON) |
