# data-solutions-for-me

Data Solutions for ME — Simplifying data communication for businesses, communities, and individuals through relatable, analogous frameworks. Hosted at datasolutionsforme.com

**Live hub:** [https://andredavisme.github.io/data-solutions-for-me/project-hub/](https://andredavisme.github.io/data-solutions-for-me/project-hub/)

---

## Project hub: expectation timeline

This repository powers a project hub that focuses on **transparent history of expectations, deviations, and adaptations** from the inception of any project.

Each project hub is responsible for one project. A separate, future aggregator hub will be able to read from multiple hubs to provide cross-project views while keeping each hub self-contained.

### Core concepts

- **Expectation**: A documented commitment about scope, timing, budget, or outcomes.
- **Deviation**: A meaningful divergence from an expectation (slip, surprise, risk materialized).
- **Adaptation**: A conscious response to a deviation (re-scoping, resequencing, new approach).

These are recorded as timestamped events and visualized on a live-updating timeline.

### Timeline view

The hub exposes a timeline where each point represents an event. Key behaviors:

- X-axis is calendar time from project inception to now, minute-level granularity.
- Multiple events on the same day appear as distinct points, positioned by timestamp.
- Selecting a point opens a detail card below.
- The detail card shows timestamp, event kind, source badge, context badge, summary, meta, and a full narrative or diff body.
- Users navigate with **← Prev / Next →** buttons or a **dropdown** of all visible events.
- The timeline updates **live** via Supabase Realtime — no page refresh needed.

### Automatic vs manual events

Events come from two sources:

- **Automatic events**: Generated from data changes in watched tables (`analogies`, `datasources`) via Supabase triggers → `monitor_events` → `project_events`. Rendered as **circles** sitting on the axis line.
- **Manual events**: Authored by humans to document expectations, deviations, or adaptations in narrative form. Rendered as **squares** positioned above the axis line.

Manual events can reference one or more automatic events via `related_event_ids`, effectively annotating system-level signals with human interpretation.

### Event context

Every event carries a `context` field: `production`, `development`, or `test`.

- **Production** events are the canonical record.
- **Development** and **test** events are visible on the timeline but rendered with a dashed outline, a colored label above the dot, and a dashed context badge in the detail card. They can be toggled off via the Context filter group.

### Filters

Three independent filter groups — all AND-ed together:

| Group | Options |
|---|---|
| Kind | expectation · deviation · adaptation · insert · update · delete |
| Source | Automatic · Manual |
| Context | Production · Dev · Test |

### Annotation flow

Selecting an **automatic** event reveals two things in the detail card:

1. **Annotate this event** button — opens a drawer to author a new manual event linked to the automatic one via `related_event_ids`.
2. **Linked annotations panel** — lists all existing manual events that reference the selected automatic event. Clicking a linked annotation jumps to it on the timeline.

Selecting a **manual** event reveals:

1. **✏ Edit annotation** button — opens an edit drawer pre-filled with the event’s current values. Fields: kind, context, author, summary, narrative.
2. **Delete** button inside the edit drawer — opens a confirmation dialog before permanently removing the event.

All mutations (create, update, delete) propagate back to the timeline instantly via Realtime.

### Single-project hub, portfolio-ready

All events are scoped by `project_id`. A future aggregator hub can query across multiple project IDs for portfolio timelines, deviation heatmaps, and adaptation-lag metrics.

---

## Data architecture

### `monitor_events` (raw instrumentation)

Captures every trigger-fired change from watched tables. Fields: `table_name`, `event_type` (`INSERT` / `UPDATE` / `DELETE`), `payload` (jsonb), `status` (`pending` → `handled` / `seen`).

### `project_events` (normalized, project-scoped)

The canonical event store consumed by the timeline UI.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `project_id` | `uuid` → `skunkworks_projects` | Scopes every event to a project |
| `event_kind` | enum | `insert` \| `update` \| `delete` \| `expectation` \| `deviation` \| `adaptation` |
| `source_type` | enum | `analogies` \| `datasources` \| `monitor_events` \| `other` |
| `source_record_id` | `uuid` (nullable) | Points to the originating row in source table |
| `monitor_event_id` | `uuid` → `monitor_events` | Links back to the raw monitor event |
| `payload` | `jsonb` | Snapshot or delta from the originating monitor event |
| `status` | `text` | `pending` \| `processed` \| `ignored` |
| `notes` | `text` | Optional annotation |
| `created_at` | `timestamptz` | Auto-set on insert |
| `is_manual` | `boolean` | `true` = human-authored; `false` = auto-generated |
| `author` | `text` (nullable) | Author name for manual events |
| `summary` | `text` (nullable) | Short summary shown on timeline dropdown and detail card |
| `narrative` | `text` (nullable) | Full narrative body shown in detail card |
| `related_event_ids` | `uuid[]` | UUIDs of automatic events this manual event annotates |
| `context` | `text` | `production` \| `development` \| `test` (default `production`) |

**Promotion rules** (how raw event types map to event kinds):
- `INSERT` → `expectation`
- `UPDATE` with a status field change → `deviation`
- `UPDATE` without a status change → `adaptation`
- `DELETE` → `delete`

### `transform-monitor-events` Edge Function

Background job that drains `monitor_events` (status = `pending`) and writes normalized rows into `project_events`. Marks processed monitor events as `handled`; unresolvable ones as `seen`.

- Batches up to 100 events per invocation.
- Returns `{ total, processed, skipped, errors }`.
- Triggered automatically via `pg_cron` every 5 minutes.

**Manual invocation:**
```bash
curl -X POST https://hhyhulqngdkwsxhymmcd.supabase.co/functions/v1/transform-monitor-events
```

### `pg_cron` schedule

Job name: `transform-monitor-events` | Schedule: `*/5 * * * *`

```sql
-- Check job
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'transform-monitor-events';

-- Check run history
SELECT jobid, status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE job_name = 'transform-monitor-events'
ORDER BY start_time DESC LIMIT 10;

-- Pause / resume
UPDATE cron.job SET active = false WHERE jobname = 'transform-monitor-events'; -- pause
UPDATE cron.job SET active = true  WHERE jobname = 'transform-monitor-events'; -- resume
```

---

## Deployment

The hub is deployed via GitHub Actions to GitHub Pages on every push to `main`.

- Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
- Artifact: repo root (so `project-hub/` is served at `/project-hub/`)
- Root `index.html` redirects `https://andredavisme.github.io/data-solutions-for-me/` → `project-hub/`
- Live URL: [https://andredavisme.github.io/data-solutions-for-me/project-hub/](https://andredavisme.github.io/data-solutions-for-me/project-hub/)

---

## Development roadmap

### Phase 1: Instrumentation and storage ✅

- [x] Define and create watched tables (`analogies`, `datasources`).
- [x] Attach triggers and an Edge Function to record change events into `monitor_events`.
- [x] Introduce `project_events` scoped by `project_id`, event kind, and source type.
- [x] Implement background job (`transform-monitor-events`) to promote raw monitor events to project events.

### Phase 2: Project hub UI (single project) ✅

- [x] Build project hub page (`project-hub/`):
  - [x] Expectation timeline for a selected project.
  - [x] Automatic events (circles on axis) and manual events (squares above axis) with distinct visual treatments.
  - [x] Detail card with kind badge, source badge, context badge, summary, meta, narrative body, and collapsible raw payload.
  - [x] Prev / Next navigation buttons and dropdown jump-to-event selector.
- [x] Filter bar — Kind group (expectation · deviation · adaptation · insert · update · delete).
- [x] Filter bar — Source group (Automatic · Manual).
- [x] Filter bar — Context group (Production · Dev · Test).
- [x] Supabase Realtime subscription — live INSERT / UPDATE / DELETE without page refresh.
- [x] Live status badge (● Connecting → ● Live → ● Error) in header.
- [x] Flash animation on timeline wrapper when a new event arrives via realtime.
- [x] `context` column on `project_events` (`production` | `development` | `test`).
- [x] Dev/test events rendered with dashed outline, color label above dot, dashed connector, and context badge in detail card.
- [x] 3 dev-context seed events inserted to verify timeline rendering out of the box.

### Phase 3: Manual event authoring ✅

- [x] **Annotate this event** button on automatic event cards.
- [x] Annotation drawer (indigo-tinted) with kind, context, author, summary, and narrative fields.
- [x] New manual event written to `project_events` with `is_manual: true` and `related_event_ids` pointing to the source automatic event.
- [x] Realtime round-trip: annotation appears on timeline and detail card auto-navigates to it after insert.

### Phase 4: Annotation management ✅

- [x] **Linked annotations panel** on automatic event detail cards — lists all manual events referencing the selected event; clicking jumps to the annotation.
- [x] **✏ Edit annotation** button on manual event detail cards — opens yellow-tinted edit drawer pre-filled with current values.
- [x] Edit drawer saves `PATCH` (kind, context, author, summary, narrative) via Supabase; auto-closes on success.
- [x] **Delete** button in edit drawer — opens a native `<dialog>` confirmation modal before issuing `DELETE`.
- [x] Realtime DELETE removes the event from the timeline and resets selection gracefully.
- [x] GitHub Pages deployment via Actions workflow; live at [https://andredavisme.github.io/data-solutions-for-me/project-hub/](https://andredavisme.github.io/data-solutions-for-me/project-hub/).

### Phase 5: Aggregator-ready patterns

- [ ] Define queries and API endpoints for single-project and cross-project event fetching.
- [ ] Document expectations for a separate aggregator hub.

### Phase 6: Insight layers

- [ ] Derive metrics: time from deviation to adaptation, deviation frequency, expectation-change distribution.
- [ ] Surface metrics alongside the timeline as lightweight overlays or summaries.

---

## Contribution notes

Changes that affect the event schema or timeline behavior should:

- Preserve the distinction between automatic and manual events.
- Preserve the `context` field — never write `development` or `test` rows to production without intent.
- Maintain minute-level timestamp accuracy.
- Keep the single-project hub interface intuitive, even as portfolio-level capabilities are added later.
