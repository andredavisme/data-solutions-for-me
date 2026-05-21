/**
 * Phase 2 — Project Hub UI
 * Expectation timeline with live Supabase Realtime updates.
 *
 * project_events columns used:
 *   id, project_id, event_kind, source_type, source_record_id,
 *   monitor_event_id, payload, status, notes, created_at,
 *   is_manual  (bool, default false)
 *   author     (text, nullable)
 *   summary    (text, nullable)
 *   narrative  (text, nullable)
 *   context    ('production' | 'development' | 'test', default 'production')
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── Supabase client ─────────────────────────────────────────
const SUPABASE_URL     = 'https://hhyhulqngdkwsxhymmcd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── State ────────────────────────────────────────────────────
const state = {
  projects:        [],
  activeProjectId: null,
  allEvents:       [],   // raw from DB, sorted by created_at asc
  visibleEvents:   [],   // after filters
  selectedIndex:   null, // index into visibleEvents
  realtimeChannel: null, // active Supabase channel
  filters: {
    kinds:    new Set(['insert','update','delete','expectation','deviation','adaptation']),
    sources:  new Set(['automatic','manual']),
    contexts: new Set(['production','development','test']),
  },
};

// ─── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const projectSelect   = $('project-select');
const projectTitle    = $('project-title');
const projectStatus   = $('project-status');
const timelineTrack   = $('timeline-track');
const timelineAxis    = $('timeline-axis');
const timelineEmpty   = $('timeline-empty');
const realtimeBadge   = $('realtime-badge');
const detailEmpty     = $('detail-empty');
const detailCard      = $('detail-card');
const navPrev         = $('nav-prev');
const navNext         = $('nav-next');
const eventNavSelect  = $('event-nav-select');
const cardKind        = $('card-kind');
const cardSourceBadge = $('card-source-badge');
const cardContextBadge= $('card-context-badge');
const cardTime        = $('card-time');
const cardSummary     = $('card-summary');
const cardMeta        = $('card-meta');
const cardBody        = $('card-body');
const cardPayloadWrap = $('card-payload-wrapper');
const cardPayload     = $('card-payload');
const payloadToggle   = $('payload-toggle');

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

  if (state.projects.length > 0) {
    state.activeProjectId = state.projects[0].id;
    projectSelect.value   = state.activeProjectId;
    await loadEvents();
  } else {
    projectTitle.textContent = 'No projects found';
  }
}

function populateProjectSelect() {
  projectSelect.innerHTML = '';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value       = p.id;
    opt.textContent = p.title;
    projectSelect.appendChild(opt);
  });
}

projectSelect.addEventListener('change', async () => {
  state.activeProjectId = projectSelect.value;
  state.selectedIndex   = null;
  unsubscribeRealtime();
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

  state.allEvents     = data ?? [];
  state.selectedIndex = null;
  applyFiltersAndRender();
  subscribeRealtime();
}

// ─── Realtime ──────────────────────────────────────────────────
function subscribeRealtime() {
  if (state.realtimeChannel) unsubscribeRealtime();

  setRealtimeBadge('connecting');

  state.realtimeChannel = supabase
    .channel(`project-events:${state.activeProjectId}`)
    .on(
      'postgres_changes',
      {
        event:  '*',          // INSERT, UPDATE, DELETE
        schema: 'public',
        table:  'project_events',
        filter: `project_id=eq.${state.activeProjectId}`,
      },
      payload => handleRealtimeEvent(payload)
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED')   setRealtimeBadge('live');
      if (status === 'CHANNEL_ERROR') setRealtimeBadge('error');
      if (status === 'TIMED_OUT')     setRealtimeBadge('error');
      if (status === 'CLOSED')        setRealtimeBadge('off');
    });
}

function unsubscribeRealtime() {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  setRealtimeBadge('off');
}

function handleRealtimeEvent({ eventType, new: newRow, old: oldRow }) {
  if (eventType === 'INSERT') {
    // Merge in chronological order
    const insertAt = state.allEvents.findIndex(
      e => new Date(e.created_at) > new Date(newRow.created_at)
    );
    if (insertAt === -1) {
      state.allEvents.push(newRow);
    } else {
      state.allEvents.splice(insertAt, 0, newRow);
      // Shift selectedIndex if needed
      if (state.selectedIndex !== null && insertAt <= state.selectedIndex) {
        state.selectedIndex++;
      }
    }
    flashTimelineIncoming();
  }

  if (eventType === 'UPDATE') {
    const idx = state.allEvents.findIndex(e => e.id === newRow.id);
    if (idx !== -1) state.allEvents[idx] = newRow;
  }

  if (eventType === 'DELETE') {
    const idx = state.allEvents.findIndex(e => e.id === oldRow.id);
    if (idx !== -1) {
      state.allEvents.splice(idx, 1);
      if (state.selectedIndex !== null) {
        if (idx < state.selectedIndex) state.selectedIndex--;
        else if (idx === state.selectedIndex) state.selectedIndex = null;
      }
    }
  }

  applyFiltersAndRender();
  // Re-render detail card if the updated row is currently selected
  if (eventType === 'UPDATE' && state.selectedIndex !== null) {
    const selId = state.visibleEvents[state.selectedIndex]?.id;
    if (selId === newRow.id) renderDetailCard();
  }
  if (state.selectedIndex !== null) renderDetailCard();
  else showDetailEmpty();
}

// Status indicator
function setRealtimeBadge(status) {
  if (!realtimeBadge) return;
  const labels = { connecting: '● Connecting', live: '● Live', error: '● Error', off: '○ Off' };
  realtimeBadge.textContent  = labels[status] ?? '';
  realtimeBadge.dataset.status = status;
}

function flashTimelineIncoming() {
  const wrapper = document.getElementById('timeline-wrapper');
  wrapper.classList.add('timeline-wrapper--incoming');
  setTimeout(() => wrapper.classList.remove('timeline-wrapper--incoming'), 600);
}

// ─── Filters ──────────────────────────────────────────────────
function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind    = btn.dataset.filterKind;
      const source  = btn.dataset.filterSource;
      const context = btn.dataset.filterContext;

      function toggle(set, key) {
        set.has(key) ? set.delete(key) : set.add(key);
      }
      if (kind)    toggle(state.filters.kinds, kind);
      if (source)  toggle(state.filters.sources, source);
      if (context) toggle(state.filters.contexts, context);

      const isNowActive = (
        (kind    && state.filters.kinds.has(kind))    ||
        (source  && state.filters.sources.has(source)) ||
        (context && state.filters.contexts.has(context))
      );
      btn.classList.toggle('active', isNowActive);
      btn.setAttribute('aria-pressed', String(isNowActive));

      applyFiltersAndRender();
    });
  });
}

function applyFiltersAndRender() {
  state.visibleEvents = state.allEvents.filter(ev => {
    const kindOk    = state.filters.kinds.has(ev.event_kind);
    const isManual  = ev.is_manual === true;
    const sourceOk  = (isManual  && state.filters.sources.has('manual')) ||
                      (!isManual && state.filters.sources.has('automatic'));
    const ctx       = ev.context ?? 'production';
    const contextOk = state.filters.contexts.has(ctx);
    return kindOk && sourceOk && contextOk;
  });

  if (state.selectedIndex !== null && state.selectedIndex >= state.visibleEvents.length) {
    state.selectedIndex = state.visibleEvents.length > 0
      ? state.visibleEvents.length - 1
      : null;
  }

  renderTimeline();
  renderDetailNav();
}

// ─── Timeline ──────────────────────────────────────────────────
const TIMELINE_PADDING = 40;

function clearTimeline() {
  timelineTrack.innerHTML = '';
  timelineAxis.innerHTML  = '';
}

function renderTimelineSkeleton() {
  clearTimeline();
  timelineEmpty.hidden = true;
  timelineTrack.innerHTML =
    '<div class="skeleton" style="height:14px;width:200px;margin:20px auto"></div>';
}

function renderTimeline() {
  clearTimeline();
  const events = state.visibleEvents;

  if (events.length === 0) {
    timelineEmpty.hidden = false;
    return;
  }
  timelineEmpty.hidden = true;

  const times    = events.map(e => new Date(e.created_at).getTime());
  const tMin     = Math.min(...times);
  const tMax     = Math.max(...times);
  const tRange   = tMax - tMin || 1;
  const wrapW    = document.getElementById('timeline-wrapper').clientWidth - TIMELINE_PADDING * 2;

  buildAxisTicks(tMin, tMax, wrapW);

  events.forEach((ev, i) => {
    const t        = new Date(ev.created_at).getTime();
    const leftPx   = TIMELINE_PADDING + ((t - tMin) / tRange) * wrapW;
    const isManual = ev.is_manual === true;
    const ctx      = ev.context ?? 'production';
    const isDev    = ctx === 'development' || ctx === 'test';

    const node = document.createElement('div');
    node.className = [
      'timeline-event',
      `timeline-event--${isManual ? 'manual' : 'auto'}`,
      isDev ? `timeline-event--${ctx}` : '',
    ].filter(Boolean).join(' ');
    node.style.left = `${leftPx}px`;
    node.dataset.index = i;
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label',
      `${ev.event_kind} event${isDev ? ` [${ctx}]` : ''} at ${formatTime(ev.created_at)}`);

    const dot = document.createElement('div');
    dot.className = `timeline-event__dot timeline-event__dot--${ev.event_kind}`;

    // Dev/test badge label (tiny, sits above dot)
    if (isDev) {
      const label = document.createElement('span');
      label.className = `timeline-event__ctx-label timeline-event__ctx-label--${ctx}`;
      label.textContent = ctx === 'development' ? 'dev' : 'test';
      node.appendChild(label);
    }

    const connector = document.createElement('div');
    connector.className = 'timeline-event__connector';

    if (isManual) {
      node.appendChild(dot);
      node.appendChild(connector);
    } else {
      node.appendChild(connector);
      node.appendChild(dot);
    }

    if (i === state.selectedIndex) node.classList.add('selected');

    node.addEventListener('click',   () => selectEvent(i));
    node.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') selectEvent(i);
    });

    timelineTrack.appendChild(node);
  });

  timelineTrack.style.width = `${TIMELINE_PADDING * 2 + wrapW}px`;
}

function buildAxisTicks(tMin, tMax, wrapW) {
  const MAX_TICKS = 8;
  const range     = tMax - tMin;
  const intervals = [60e3, 5*60e3, 15*60e3, 60*60e3, 6*3600e3, 86400e3, 7*86400e3, 30*86400e3];
  const interval  = intervals.find(iv => Math.floor(range / iv) <= MAX_TICKS)
    ?? intervals[intervals.length - 1];

  const firstTick = Math.ceil(tMin / interval) * interval;
  for (let t = firstTick; t <= tMax; t += interval) {
    const leftPx = TIMELINE_PADDING + ((t - tMin) / (tMax - tMin || 1)) * wrapW;
    const tick   = document.createElement('div');
    tick.className   = 'timeline-axis__tick';
    tick.style.left  = `${leftPx}px`;
    tick.textContent = formatAxisTick(t, range);
    timelineAxis.appendChild(tick);
  }
}

function formatAxisTick(ts, range) {
  const d = new Date(ts);
  if (range < 2 * 3600e3)   return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range < 48 * 3600e3)  return d.toLocaleString([],   { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

// ─── Detail card ──────────────────────────────────────────────
function selectEvent(index) {
  state.selectedIndex = index;
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
  eventNavSelect.innerHTML = '';
  events.forEach((ev, i) => {
    const ctx = ev.context ?? 'production';
    const opt = document.createElement('option');
    opt.value       = i;
    opt.textContent = [
      formatTime(ev.created_at),
      '•',
      ev.event_kind,
      ctx !== 'production' ? `[${ctx}]` : '',
      ev.summary ? '— ' + ev.summary.slice(0, 55) : '',
    ].filter(Boolean).join('  ');
    opt.selected = i === state.selectedIndex;
    eventNavSelect.appendChild(opt);
  });

  navPrev.disabled = state.selectedIndex === null || state.selectedIndex === 0;
  navNext.disabled = state.selectedIndex === null || state.selectedIndex === events.length - 1;
}

function renderDetailCard() {
  const ev = state.visibleEvents[state.selectedIndex];
  if (!ev) { showDetailEmpty(); return; }

  detailEmpty.hidden = true;
  detailCard.hidden  = false;

  const isManual = ev.is_manual === true;
  const ctx      = ev.context ?? 'production';
  const isDev    = ctx !== 'production';

  // Kind badge
  cardKind.textContent = ev.event_kind;
  cardKind.className   = `detail-card__kind detail-card__kind--${ev.event_kind}`;

  // Source badge
  cardSourceBadge.textContent = isManual ? '✏ Manual' : '⚙ Automatic';
  cardSourceBadge.className   =
    `detail-card__source-badge${isManual ? ' detail-card__source-badge--manual' : ''}`;

  // Context badge (only for dev / test)
  if (isDev) {
    cardContextBadge.textContent = ctx === 'development' ? '🛠 dev' : '🧪 test';
    cardContextBadge.className   = `detail-card__context-badge detail-card__context-badge--${ctx}`;
    cardContextBadge.hidden      = false;
  } else {
    cardContextBadge.hidden = true;
  }

  // Timestamp
  cardTime.textContent = formatTime(ev.created_at);
  cardTime.setAttribute('datetime', ev.created_at);

  // Summary
  cardSummary.textContent = ev.summary ||
    `${capitalise(ev.event_kind)} on ${ev.source_type}` +
    (ev.source_record_id ? ` (${ev.source_record_id.slice(0,8)}…)` : '');

  // Meta
  const meta = [];
  if (ev.author)      meta.push(`<span>✏ <strong>${escHtml(ev.author)}</strong></span>`);
  if (ev.source_type) meta.push(`<span>Table: <strong>${escHtml(ev.source_type)}</strong></span>`);
  if (ev.status)      meta.push(`<span>Status: <strong>${escHtml(ev.status)}</strong></span>`);
  cardMeta.innerHTML = meta.join('');

  // Body
  cardBody.textContent = ev.narrative || ev.notes || '';

  // Payload
  if (ev.payload) {
    cardPayloadWrap.hidden  = false;
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
    if (state.selectedIndex < state.visibleEvents.length - 1)
      selectEvent(state.selectedIndex + 1);
  });
  eventNavSelect.addEventListener('change', () => {
    selectEvent(Number(eventNavSelect.value));
  });
  payloadToggle.addEventListener('click', () => {
    const open = !cardPayload.hidden;
    cardPayload.hidden    = open;
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
function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Start ────────────────────────────────────────────────────
init();
