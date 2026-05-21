/**
 * Phase 2 — Project Hub UI
 * Expectation timeline for a single project.
 *
 * Data contract:
 *   project_events columns used:
 *     id, project_id, event_kind, source_type, source_record_id,
 *     monitor_event_id, payload, status, notes, created_at,
 *     is_manual (bool, default false),
 *     author    (text, nullable),
 *     summary   (text, nullable),
 *     narrative (text, nullable)
 *
 * Falls back gracefully when is_manual / summary / narrative / author
 * don't exist yet (pre-migration).
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── Supabase client ─────────────────────────────────────────
const SUPABASE_URL = 'https://hhyhulqngdkwsxhymmcd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── State ────────────────────────────────────────────────────
const state = {
  projects:       [],
  activeProjectId: null,
  allEvents:      [],   // raw from DB for active project
  visibleEvents:  [],   // after filters applied
  selectedIndex:  null, // index into visibleEvents
  filters: {
    kinds:   new Set(['insert','update','delete','expectation','deviation','adaptation']),
    sources: new Set(['automatic','manual']),
  },
};

// ─── DOM refs ─────────────────────────────────────────────────
const projectSelect    = document.getElementById('project-select');
const projectTitle     = document.getElementById('project-title');
const projectStatus    = document.getElementById('project-status');
const timelineTrack    = document.getElementById('timeline-track');
const timelineAxis     = document.getElementById('timeline-axis');
const timelineEmpty    = document.getElementById('timeline-empty');
const detailEmpty      = document.getElementById('detail-empty');
const detailCard       = document.getElementById('detail-card');
const navPrev          = document.getElementById('nav-prev');
const navNext          = document.getElementById('nav-next');
const eventNavSelect   = document.getElementById('event-nav-select');
const cardKind         = document.getElementById('card-kind');
const cardSourceBadge  = document.getElementById('card-source-badge');
const cardTime         = document.getElementById('card-time');
const cardSummary      = document.getElementById('card-summary');
const cardMeta         = document.getElementById('card-meta');
const cardBody         = document.getElementById('card-body');
const cardPayloadWrap  = document.getElementById('card-payload-wrapper');
const cardPayload      = document.getElementById('card-payload');
const payloadToggle    = document.getElementById('payload-toggle');

// ─── Boot ─────────────────────────────────────────────────────
async function init() {
  setupFilters();
  setupNavListeners();
  await loadProjects();
}

// ─── Projects ─────────────────────────────────────────────────
async function loadProjects() {
  projectTitle.textContent = 'Loading…';
  const { data, error } = await supabase
    .from('skunkworks_projects')
    .select('id, title, status')
    .order('created_at', { ascending: false });

  if (error) { projectTitle.textContent = 'Error loading projects'; return; }

  state.projects = data ?? [];
  populateProjectSelect();

  // Auto-select first project
  if (state.projects.length > 0) {
    state.activeProjectId = state.projects[0].id;
    projectSelect.value = state.activeProjectId;
    await loadEvents();
  } else {
    projectTitle.textContent = 'No projects found';
  }
}

function populateProjectSelect() {
  projectSelect.innerHTML = '';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    projectSelect.appendChild(opt);
  });
}

projectSelect.addEventListener('change', async () => {
  state.activeProjectId = projectSelect.value;
  state.selectedIndex   = null;
  await loadEvents();
});

// ─── Events ───────────────────────────────────────────────────
async function loadEvents() {
  const project = state.projects.find(p => p.id === state.activeProjectId);
  if (project) {
    projectTitle.textContent = project.title;
    projectStatus.textContent = project.status ?? '';
  }

  renderTimelineSkeleton();

  const { data, error } = await supabase
    .from('project_events')
    .select('*')
    .eq('project_id', state.activeProjectId)
    .order('created_at', { ascending: true });

  if (error) {
    timelineEmpty.hidden = false;
    timelineEmpty.querySelector('p').textContent = 'Failed to load events.';
    clearTimeline();
    return;
  }

  state.allEvents    = data ?? [];
  state.selectedIndex = null;
  applyFiltersAndRender();
}

// ─── Filters ──────────────────────────────────────────────────
function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind   = btn.dataset.filterKind;
      const source = btn.dataset.filterSource;

      if (kind) {
        const active = state.filters.kinds.has(kind);
        active ? state.filters.kinds.delete(kind) : state.filters.kinds.add(kind);
      }
      if (source) {
        const active = state.filters.sources.has(source);
        active ? state.filters.sources.delete(source) : state.filters.sources.add(source);
      }

      btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', !btn.classList.contains('active') ? 'false' : 'true');

      applyFiltersAndRender();
    });
  });
}

function applyFiltersAndRender() {
  state.visibleEvents = state.allEvents.filter(ev => {
    const kindMatch   = state.filters.kinds.has(ev.event_kind);
    const isManual    = ev.is_manual === true;
    const sourceMatch = (isManual && state.filters.sources.has('manual')) ||
                        (!isManual && state.filters.sources.has('automatic'));
    return kindMatch && sourceMatch;
  });

  // Clamp selected index
  if (state.selectedIndex !== null && state.selectedIndex >= state.visibleEvents.length) {
    state.selectedIndex = state.visibleEvents.length > 0 ? state.visibleEvents.length - 1 : null;
  }

  renderTimeline();
  renderDetailNav();
  if (state.selectedIndex !== null) renderDetailCard();
  else showDetailEmpty();
}

// ─── Timeline rendering ───────────────────────────────────────
const TIMELINE_PADDING = 40; // px each side

function clearTimeline() {
  timelineTrack.innerHTML = '';
  timelineAxis.innerHTML  = '';
}

function renderTimelineSkeleton() {
  clearTimeline();
  timelineEmpty.hidden = true;
  // Show a subtle pulse — actual rendering happens after data loads
  timelineTrack.innerHTML = '<div class="skeleton" style="height:14px;width:200px;margin:20px auto"></div>';
}

function renderTimeline() {
  clearTimeline();
  const events = state.visibleEvents;

  if (events.length === 0) {
    timelineEmpty.hidden = false;
    return;
  }
  timelineEmpty.hidden = true;

  // Determine time range
  const times  = events.map(e => new Date(e.created_at).getTime());
  const tMin   = Math.min(...times);
  const tMax   = Math.max(...times);
  const tRange = tMax - tMin || 1; // avoid div-by-zero for single event

  // Figure out wrapper width (minus padding)
  const wrapWidth = document.getElementById('timeline-wrapper').clientWidth - TIMELINE_PADDING * 2;

  // Build axis ticks
  buildAxisTicks(tMin, tMax, wrapWidth);

  // Build event dots
  events.forEach((ev, i) => {
    const t      = new Date(ev.created_at).getTime();
    const leftPx = TIMELINE_PADDING + ((t - tMin) / tRange) * wrapWidth;
    const isManual = ev.is_manual === true;

    const node = document.createElement('div');
    node.className = `timeline-event timeline-event--${isManual ? 'manual' : 'auto'}`;
    node.style.left = `${leftPx}px`;
    node.dataset.index = i;
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', `${ev.event_kind} event at ${formatTime(ev.created_at)}`);

    const dot = document.createElement('div');
    dot.className = `timeline-event__dot timeline-event__dot--${ev.event_kind}`;

    const connector = document.createElement('div');
    connector.className = 'timeline-event__connector';

    // Manual events: dot on top, connector below; auto: connector on top, dot below (sits on axis)
    if (isManual) {
      node.appendChild(dot);
      node.appendChild(connector);
    } else {
      node.appendChild(connector);
      node.appendChild(dot);
    }

    if (i === state.selectedIndex) node.classList.add('selected');

    node.addEventListener('click', () => selectEvent(i));
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectEvent(i); });

    timelineTrack.appendChild(node);
  });

  // Ensure track is wide enough for rightmost dot
  timelineTrack.style.width = `${TIMELINE_PADDING * 2 + wrapWidth}px`;
}

function buildAxisTicks(tMin, tMax, wrapWidth) {
  const MAX_TICKS = 8;
  const range = tMax - tMin;
  // Nice tick intervals: 1min, 5min, 15min, 1h, 6h, 1d, 7d, 30d
  const intervals = [60e3, 5*60e3, 15*60e3, 60*60e3, 6*60*60e3, 86400e3, 7*86400e3, 30*86400e3];
  const interval  = intervals.find(iv => Math.floor(range / iv) <= MAX_TICKS) ?? intervals[intervals.length - 1];

  const firstTick = Math.ceil(tMin / interval) * interval;
  for (let t = firstTick; t <= tMax; t += interval) {
    const leftPx = TIMELINE_PADDING + ((t - tMin) / (tMax - tMin || 1)) * wrapWidth;
    const tick   = document.createElement('div');
    tick.className     = 'timeline-axis__tick';
    tick.style.left    = `${leftPx}px`;
    tick.textContent   = formatAxisTick(t, range);
    timelineAxis.appendChild(tick);
  }
}

function formatAxisTick(ts, range) {
  const d = new Date(ts);
  if (range < 2 * 60 * 60e3)  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range < 48 * 60 * 60e3) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

// ─── Detail card ──────────────────────────────────────────────
function selectEvent(index) {
  state.selectedIndex = index;
  // Update dot selection classes
  document.querySelectorAll('.timeline-event').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });
  renderDetailNav();
  renderDetailCard();
}

function showDetailEmpty() {
  detailEmpty.hidden = false;
  detailCard.hidden  = true;
}

function renderDetailNav() {
  const events = state.visibleEvents;
  // Rebuild dropdown
  eventNavSelect.innerHTML = '';
  events.forEach((ev, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${formatTime(ev.created_at)}  •  ${ev.event_kind}${ev.summary ? '  — ' + ev.summary.slice(0, 60) : ''}`;
    opt.selected = i === state.selectedIndex;
    eventNavSelect.appendChild(opt);
  });

  navPrev.disabled = state.selectedIndex === null || state.selectedIndex === 0;
  navNext.disabled = state.selectedIndex === null || state.selectedIndex === events.length - 1;
}

function renderDetailCard() {
  const ev = state.visibleEvents[state.selectedIndex];
  if (!ev) { showDetailEmpty(); return; }

  detailEmpty.hidden = false; // keep in DOM but hidden
  detailEmpty.hidden = true;
  detailCard.hidden  = false;

  const isManual = ev.is_manual === true;

  // Kind badge
  cardKind.textContent = ev.event_kind;
  cardKind.className   = `detail-card__kind detail-card__kind--${ev.event_kind}`;

  // Source badge
  cardSourceBadge.textContent = isManual ? '✏ Manual' : '⚙ Automatic';
  cardSourceBadge.className   = `detail-card__source-badge${isManual ? ' detail-card__source-badge--manual' : ''}`;

  // Timestamp
  cardTime.textContent = formatTime(ev.created_at);
  cardTime.setAttribute('datetime', ev.created_at);

  // Summary — fall back to source_type + event_kind when summary column absent
  cardSummary.textContent = ev.summary ||
    `${capitalise(ev.event_kind)} on ${ev.source_type}` +
    (ev.source_record_id ? ` (${ev.source_record_id.slice(0,8)}…)` : '');

  // Meta row
  const metaParts = [];
  if (ev.author)      metaParts.push(`<span>✏ <strong>${escHtml(ev.author)}</strong></span>`);
  if (ev.source_type) metaParts.push(`<span>Table: <strong>${escHtml(ev.source_type)}</strong></span>`);
  if (ev.status)      metaParts.push(`<span>Status: <strong>${escHtml(ev.status)}</strong></span>`);
  cardMeta.innerHTML = metaParts.join('');

  // Narrative / notes
  const body = ev.narrative || ev.notes || '';
  cardBody.textContent = body;

  // Payload
  if (ev.payload) {
    cardPayloadWrap.hidden = false;
    cardPayload.textContent = JSON.stringify(ev.payload, null, 2);
  } else {
    cardPayloadWrap.hidden = true;
    cardPayload.hidden     = true;
  }
}

// ─── Nav listeners ────────────────────────────────────────────
function setupNavListeners() {
  navPrev.addEventListener('click', () => {
    if (state.selectedIndex > 0) selectEvent(state.selectedIndex - 1);
  });
  navNext.addEventListener('click', () => {
    if (state.selectedIndex < state.visibleEvents.length - 1) selectEvent(state.selectedIndex + 1);
  });
  eventNavSelect.addEventListener('change', () => {
    selectEvent(Number(eventNavSelect.value));
  });
  payloadToggle.addEventListener('click', () => {
    const open = !cardPayload.hidden;
    cardPayload.hidden = open;
    payloadToggle.textContent = open ? 'Show raw payload ▾' : 'Hide raw payload ▴';
  });
}

// ─── Helpers ──────────────────────────────────────────────────
function formatTime(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Start ────────────────────────────────────────────────────
init();
