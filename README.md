# data-solutions-for-me

Data Solutions for ME — Simplifying data communication for businesses, communities, and individuals through relatable, analogous frameworks. Hosted at datasolutionsforme.com

---

## Project hub: expectation timeline

This repository powers a project hub that focuses on **transparent history of expectations, deviations, and adaptations** from the inception of any project.

Each project hub is responsible for one project. A separate, future aggregator hub will be able to read from multiple hubs to provide cross-project views while keeping each hub self-contained.

### Core concepts

- **Expectation**: A documented commitment about scope, timing, budget, or outcomes.
- **Deviation**: A meaningful divergence from an expectation (slip, surprise, risk materialized).
- **Adaptation**: A conscious response to a deviation (re-scoping, resequencing, new approach).

These are recorded as timestamped events and visualized on a timeline.

### Timeline view

The hub exposes a timeline where each point represents an expectation, deviation, or adaptation event. Key behaviors:

- X-axis is calendar time from project inception to now, minute-level granularity for events.
- Multiple events on the same day appear as distinct points, positioned by timestamp.
- Selecting a point highlights it on the timeline and opens a detail card below.
- The detail card shows timestamp, event type (expectation/deviation/adaptation), short summary, and a more complete narrative or diff.
- Users can navigate within the current time window via **next**, **previous**, and a **dropdown** of visible events.

### Automatic vs manual events

Events in the hub come from two sources:

- **Automatic events**: Generated from data changes in watched tables (for example, `analogies` and `datasources`) via Supabase triggers and webhooks.
- **Manual events**: Authored by humans to describe expectations, deviations, or adaptations in narrative form.

Both appear together on the same timeline but are clearly distinguished in the UI:

- Automatic events use a neutral visual style (e.g., smaller, muted points) and show their origin table and change payload.
- Manual events use an accent style (e.g., different shape or color) and highlight the author and intent.

Manual events can reference one or more automatic events for context, effectively annotating the system-level signal with human interpretation.

### Single-project hub, portfolio-ready

This hub is designed to serve **one project** at a time:

- All events are scoped by `project_id`.
- The timeline, filters, and detail views operate within a single project context.

A future aggregator hub can:

- Query events across multiple `project_id` values.
- Build portfolio timelines, deviation heatmaps, and adaptation-lag metrics.
- Keep each project hub independent while offering cross-project insight.

---

## Data architecture

### `monitor_events` (raw instrumentation)

Captures every trigger-fired change from watched tables (`analogies`, `datasources`). Fields include `table_name`, `event_type` (`INSERT` / `UPDATE` / `DELETE`), `payload` (jsonb), and `status` (`pending` → `handled` / `seen`).

### `project_events` (normalized, project-scoped)

The canonical event store consumed by the timeline UI. Created in Phase 1 (May 2026).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `project_id` | `uuid` → `skunkworks_projects` | Scopes every event to a project |
| `event_kind` | enum | `insert` \| `update` \| `delete` \| `expectation` \| `deviation` \| `adaptation` |
| `source_type` | enum | `analogies` \| `datasources` \| `monitor_events` \| `other` |
| `source_record_id` | `uuid` (nullable) | Points to the originating row in the source table |
| `monitor_event_id` | `uuid` → `monitor_events` | Links back to the raw monitor event |
| `payload` | `jsonb` | Snapshot or delta from the originating monitor event |
| `status` | `text` | `pending` \| `processed` \| `ignored` |
| `notes` | `text` | Optional annotation |
| `created_at` | `timestamptz` | Auto-set on insert |

**Promotion rules** (how raw event types map to event kinds):
- `INSERT` → `expectation`
- `UPDATE` with a status field change → `deviation`
- `UPDATE` without a status change → `adaptation`
- `DELETE` → `delete`

### `transform-monitor-events` Edge Function

Background job that drains `monitor_events` (status = `pending`) and writes normalized rows into `project_events`. Marks processed monitor events as `handled`; unresolvable ones (no `project_id`) as `seen`.

- Batches up to 100 events per invocation.
- Returns a JSON summary: `{ total, processed, skipped, errors }`.
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

## Development roadmap

This section outlines an initial roadmap for implementing and iterating on the project hub.

### Phase 1: Instrumentation and storage ✅

- [x] Define and create watched tables for content and sources (e.g., `analogies`, `datasources`).
- [x] Attach triggers and an Edge Function to record change events into a central events table (e.g., `monitor_events`).
- [x] Introduce a normalized `project_events` table that scopes events by `project_id`, event kind, and source type.
- [x] Implement a background job or function to transform raw monitor events into project events (auto expectation/deviation/adaptation candidates).

### Phase 2: Project hub UI (single project)

- [ ] Build a project hub page that:
  - Shows the expectation timeline for a selected project.
  - Renders automatic and manual events with distinct visual treatments.
  - Provides a detail card for the selected event with navigation (next/previous/dropdown).
- [ ] Add filters to toggle visibility of expectations, deviations, and adaptations.
- [ ] Add filters to toggle automatic vs manual events.

### Phase 3: Manual event authoring

- [ ] Add UI controls to create manual events tied to a specific project.
- [ ] Support creating a manual event directly from an automatic event ("Annotate this event").
- [ ] Allow linking a manual event to one or more related automatic events.

### Phase 4: Aggregator-ready patterns

- [ ] Ensure project events include a stable `project_id` reference (e.g., to `skunkworks_projects`).
- [ ] Define queries and API endpoints that:
  - Fetch events for a single project.
  - Fetch events across multiple projects with filters by event kind, source type, and time range.
- [ ] Document expectations for a separate aggregator hub to consume this data.

### Phase 5: Insight layers

- [ ] Derive metrics such as:
  - Time from deviation to adaptation.
  - Frequency and clustering of deviations over time.
  - Distribution of expectation changes by project phase.
- [ ] Surface these metrics alongside the timeline as lightweight overlays or summaries.

---

## Contribution notes

For now, the focus is on getting one project hub fully functional end-to-end. Changes that affect the event schema or the timeline behavior should:

- Preserve the distinction between automatic and manual events.
- Maintain minute-level timestamp accuracy.
- Keep the single-project hub interface intuitive, even as portfolio-level capabilities are added later.
